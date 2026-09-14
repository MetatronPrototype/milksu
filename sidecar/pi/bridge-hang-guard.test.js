import assert from "node:assert/strict";
import test from "node:test";
import {
  BULK_COMMAND_PATTERNS,
  DATALESS_EARLY_EXIT_LIMIT,
  DEFAULT_BASH_TIMEOUT_SECONDS,
  MAX_BASH_TIMEOUT_SECONDS,
  applyBashTimeout,
  countDatalessFiles,
  createHangGuardExtension,
  datalessBlockReason,
  datalessUnknownReason,
  hangGuardConfig,
  isBulkCommand,
  isICloudSyncedPath,
} from "./bridge-hang-guard.js";

const baseConfig = {
  defaultTimeoutSeconds: DEFAULT_BASH_TIMEOUT_SECONDS,
  maxTimeoutSeconds: MAX_BASH_TIMEOUT_SECONDS,
};

const FAKE_HOME = "/Users/tester";
const ICLOUD_DIR = "/Users/tester/Documents/repo";
const PLAIN_DIR = "/tmp/repo";

function fakePi() {
  const handlers = new Map();
  const pi = {
    on(name, handler) {
      const list = handlers.get(name) ?? [];
      list.push(handler);
      handlers.set(name, list);
    },
  };
  return { pi, handlers, handler: name => handlers.get(name)?.[0] };
}

function fakeSpawn(stdout, { status = 0, error = undefined, capture } = {}) {
  return (command, args, options) => {
    if (capture) capture.push({ command, args, options });
    return { status, stdout, stderr: "", error };
  };
}

function hangGuard({ environment = {}, spawn, capture } = {}) {
  const { pi, handler, handlers } = fakePi();
  createHangGuardExtension({
    environment,
    platform: "darwin",
    home: FAKE_HOME,
    spawn: spawn ?? fakeSpawn("", { capture }),
  })(pi);
  return { handler, handlers };
}

const manyDataless = Array.from({ length: DATALESS_EARLY_EXIT_LIMIT + 4 }, (_, index) => `.git/${index}`)
  .join("\n") + "\n";

// ───────────────────────── 超时注入 ─────────────────────────

test("missing timeout receives the default", () => {
  const input = { command: "sleep 600" };
  assert.equal(applyBashTimeout(input, baseConfig), DEFAULT_BASH_TIMEOUT_SECONDS);
  assert.equal(input.timeout, DEFAULT_BASH_TIMEOUT_SECONDS);
});

test("explicit reasonable timeout is preserved", () => {
  const input = { command: "ls", timeout: 30 };
  assert.equal(applyBashTimeout(input, baseConfig), undefined);
  assert.equal(input.timeout, 30);
});

test("excessive timeout is clamped to the maximum", () => {
  const input = { command: "ls", timeout: 24 * 24 * 3600 };
  assert.equal(applyBashTimeout(input, baseConfig), MAX_BASH_TIMEOUT_SECONDS);
  assert.equal(input.timeout, MAX_BASH_TIMEOUT_SECONDS);
});

test("invalid timeout values are left untouched", () => {
  for (const value of [0, -5, "abc"]) {
    const input = { command: "ls", timeout: value };
    assert.equal(applyBashTimeout(input, baseConfig), undefined);
    assert.equal(input.timeout, value);
  }
  assert.equal(applyBashTimeout(undefined, baseConfig), undefined);
});

test("null timeout is treated as missing", () => {
  const input = { command: "ls", timeout: null };
  assert.equal(applyBashTimeout(input, baseConfig), DEFAULT_BASH_TIMEOUT_SECONDS);
  assert.equal(input.timeout, DEFAULT_BASH_TIMEOUT_SECONDS);
});

// ───────────────────────── 批量命令识别 ─────────────────────────

test("bulk commands are detected while routine git commands are not", () => {
  assert.equal(isBulkCommand("git fsck --no-progress"), true);
  assert.equal(isBulkCommand("git gc"), true);
  assert.equal(isBulkCommand("git repack -ad"), true);
  assert.equal(isBulkCommand("grep -rn foo ."), true);
  assert.equal(isBulkCommand("find . -name '*.swift'"), true);
  assert.equal(isBulkCommand("xcodebuild -scheme X build"), true);
  assert.equal(isBulkCommand("npm ci"), true);
  assert.equal(isBulkCommand("git status"), false);
  assert.equal(isBulkCommand("git add -A"), false);
  assert.equal(isBulkCommand("git commit -m x"), false);
  assert.equal(isBulkCommand("git log --oneline"), false);
  assert.equal(isBulkCommand("ls -la"), false);
  assert.equal(isBulkCommand("cat README.md"), false);
  assert.equal(isBulkCommand(""), false);
  assert.equal(isBulkCommand(undefined), false);
});

// ───────────────────────── iCloud 路径识别 ─────────────────────────

test("iCloud synced roots are recognised and everything else skipped", () => {
  const options = { platform: "darwin", home: FAKE_HOME };
  assert.equal(isICloudSyncedPath(ICLOUD_DIR, options), true);
  assert.equal(isICloudSyncedPath(`${FAKE_HOME}/Documents`, options), true);
  assert.equal(isICloudSyncedPath(`${FAKE_HOME}/Desktop/x`, options), true);
  assert.equal(isICloudSyncedPath(`${FAKE_HOME}/Library/Mobile Documents/com~apple~CloudDocs`, options), true);
  assert.equal(isICloudSyncedPath(PLAIN_DIR, options), false);
  assert.equal(isICloudSyncedPath(`${FAKE_HOME}/DocumentsBackup`, options), false);
  assert.equal(isICloudSyncedPath(`${FAKE_HOME}/New project`, options), false);
  assert.equal(isICloudSyncedPath("", options), false);
  assert.equal(isICloudSyncedPath(ICLOUD_DIR, { platform: "linux", home: FAKE_HOME }), false);
});

// ───────────────────────── dataless 扫描 ─────────────────────────

test("dataless scan uses an early exit limit and never downloads", () => {
  const calls = [];
  const count = countDatalessFiles(ICLOUD_DIR, {
    platform: "darwin",
    spawn: fakeSpawn("a\nb\nc\n", { capture: calls }),
    limit: 21,
  });
  assert.equal(count, 3);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, "/bin/sh");
  const shell = calls[0].args[1];
  assert.match(shell, /-flags \+dataless/);
  assert.match(shell, /head -n 21/);
  assert.match(shell, /'\/Users\/tester\/Documents\/repo'/);
});

test("dataless scan reports unknown on other platforms or failures", () => {
  assert.equal(countDatalessFiles(ICLOUD_DIR, { platform: "linux", spawn: fakeSpawn("x\n") }), -1);
  assert.equal(
    countDatalessFiles(ICLOUD_DIR, { platform: "darwin", spawn: fakeSpawn("", { status: 1 }) }),
    -1,
  );
  assert.equal(
    countDatalessFiles(ICLOUD_DIR, {
      platform: "darwin",
      spawn: fakeSpawn("", { error: new Error("ETIMEDOUT") }),
    }),
    -1,
  );
  assert.equal(countDatalessFiles("", { platform: "darwin", spawn: fakeSpawn("x\n") }), -1);
});

test("directories with quotes are shell-quoted safely", () => {
  const calls = [];
  countDatalessFiles("/tmp/it's here", {
    platform: "darwin",
    spawn: fakeSpawn("", { capture: calls }),
  });
  assert.match(calls[0].args[1], /'\/tmp\/it'\\''s here'/);
});

// ───────────────────────── 拦截理由 ─────────────────────────

test("block reason states the count, the cost and the options", () => {
  const reason = datalessBlockReason({
    directory: ICLOUD_DIR,
    count: DATALESS_EARLY_EXIT_LIMIT,
    command: "git fsck",
    threshold: 20,
  });
  assert.match(reason, /21\+/);
  assert.match(reason, /only in iCloud/);
  assert.match(reason, /brctl download/);
  assert.match(reason, /explicit timeout/);
});

test("unknown reason explains why it fails closed", () => {
  const reason = datalessUnknownReason({ directory: ICLOUD_DIR, command: "git fsck", scanTimeoutMs: 2500 });
  assert.match(reason, /iCloud-synced/);
  assert.match(reason, /did not finish within 2500ms/);
  assert.match(reason, /fails closed/);
  assert.match(reason, /MILKSU_PI_DATALESS_GUARD=0/);
});

// ───────────────────────── 钩子行为 ─────────────────────────

test("tool_call blocks bulk commands in an evicted iCloud directory", async () => {
  const { handler } = hangGuard({ spawn: fakeSpawn(manyDataless) });

  const input = { command: "git fsck --no-progress" };
  const result = await handler("tool_call")({ toolName: "bash", input }, { cwd: ICLOUD_DIR });
  assert.equal(input.timeout, DEFAULT_BASH_TIMEOUT_SECONDS);
  assert.equal(result?.block, true);
  assert.match(result.reason, /only in iCloud/);
});

test("tool_call skips the scan entirely outside iCloud roots", async () => {
  const calls = [];
  const { handler } = hangGuard({ spawn: fakeSpawn(manyDataless, { capture: calls }) });

  const input = { command: "git fsck --no-progress" };
  const result = await handler("tool_call")({ toolName: "bash", input }, { cwd: PLAIN_DIR });
  assert.equal(result, undefined);
  assert.equal(calls.length, 0, "no scan must run outside iCloud roots");
  assert.equal(input.timeout, DEFAULT_BASH_TIMEOUT_SECONDS);
});

test("tool_call fails closed when the iCloud preflight cannot finish", async () => {
  const { handler } = hangGuard({ spawn: fakeSpawn("", { error: new Error("ETIMEDOUT") }) });

  const input = { command: "grep -rn foo ." };
  const result = await handler("tool_call")({ toolName: "bash", input }, { cwd: ICLOUD_DIR });
  assert.equal(result?.block, true);
  assert.match(result.reason, /fails closed/);
});

test("tool_call leaves routine commands unblocked in iCloud directories", async () => {
  const { handler } = hangGuard({ spawn: fakeSpawn("f1\nf2\n") });

  const input = { command: "git status" };
  const result = await handler("tool_call")({ toolName: "bash", input }, { cwd: ICLOUD_DIR });
  assert.equal(result, undefined);
  assert.equal(input.timeout, DEFAULT_BASH_TIMEOUT_SECONDS);
});

test("tool_call ignores non-bash tools", async () => {
  const { handler } = hangGuard({ spawn: fakeSpawn("") });

  const input = { path: "/tmp/x" };
  assert.equal(await handler("tool_call")({ toolName: "read", input }, { cwd: ICLOUD_DIR }), undefined);
  assert.equal(input.timeout, undefined);
});

test("a clean iCloud directory below the threshold is allowed", async () => {
  const { handler } = hangGuard({ spawn: fakeSpawn("only-one\n") });

  const input = { command: "git fsck" };
  assert.equal(await handler("tool_call")({ toolName: "bash", input }, { cwd: ICLOUD_DIR }), undefined);
  assert.equal(input.timeout, DEFAULT_BASH_TIMEOUT_SECONDS);
});

test("dataless guard can be disabled while the timeout stays active", async () => {
  const calls = [];
  const { handler } = hangGuard({
    environment: { MILKSU_PI_DATALESS_GUARD: "0" },
    spawn: fakeSpawn(manyDataless, { capture: calls }),
  });

  const input = { command: "git fsck" };
  assert.equal(await handler("tool_call")({ toolName: "bash", input }, { cwd: ICLOUD_DIR }), undefined);
  assert.equal(input.timeout, DEFAULT_BASH_TIMEOUT_SECONDS);
  assert.equal(calls.length, 0);
});

test("the whole guard can be disabled", () => {
  const { handlers } = hangGuard({ environment: { MILKSU_PI_HANG_GUARD: "0" } });
  assert.equal(handlers.size, 0);
});

test("tool_result appends diagnostics to timeouts only", async () => {
  const { handler } = hangGuard({ spawn: fakeSpawn(manyDataless) });

  const timeoutResult = await handler("tool_result")(
    { isError: true, content: [{ type: "text", text: "timeout:120" }] },
    { cwd: ICLOUD_DIR },
  );
  assert.match(timeoutResult.content.at(-1).text, /terminated by its timeout/);
  assert.match(timeoutResult.content.at(-1).text, /exist only in iCloud/);

  const otherError = await handler("tool_result")(
    { isError: true, content: [{ type: "text", text: "ENOENT" }] },
    { cwd: ICLOUD_DIR },
  );
  assert.equal(otherError, undefined);
});

test("tool_result skips the scan outside iCloud roots", async () => {
  const calls = [];
  const { handler } = hangGuard({ spawn: fakeSpawn(manyDataless, { capture: calls }) });

  const result = await handler("tool_result")(
    { isError: true, content: [{ type: "text", text: "timeout:120" }] },
    { cwd: PLAIN_DIR },
  );
  assert.match(result.content.at(-1).text, /terminated by its timeout/);
  assert.equal(calls.length, 0);
});

// ───────────────────────── 配置 ─────────────────────────

test("config reads environment overrides and defaults", () => {
  const defaults = hangGuardConfig({});
  assert.equal(defaults.defaultTimeoutSeconds, DEFAULT_BASH_TIMEOUT_SECONDS);
  assert.equal(defaults.maxTimeoutSeconds, MAX_BASH_TIMEOUT_SECONDS);
  assert.equal(defaults.enabled, true);
  assert.equal(defaults.datalessGuardEnabled, true);

  const overridden = hangGuardConfig({
    MILKSU_PI_BASH_DEFAULT_TIMEOUT_SECONDS: "45",
    MILKSU_PI_BASH_MAX_TIMEOUT_SECONDS: "600",
    MILKSU_PI_DATALESS_BLOCK_THRESHOLD: "5",
    MILKSU_PI_HANG_GUARD: "0",
  });
  assert.equal(overridden.defaultTimeoutSeconds, 45);
  assert.equal(overridden.maxTimeoutSeconds, 600);
  assert.equal(overridden.datalessBlockThreshold, 5);
  assert.equal(overridden.enabled, false);

  const invalid = hangGuardConfig({ MILKSU_PI_BASH_DEFAULT_TIMEOUT_SECONDS: "-1" });
  assert.equal(invalid.defaultTimeoutSeconds, DEFAULT_BASH_TIMEOUT_SECONDS);
});

test("bulk patterns stay a non-empty list of regular expressions", () => {
  assert.ok(BULK_COMMAND_PATTERNS.length > 0);
  assert.ok(BULK_COMMAND_PATTERNS.every(pattern => pattern instanceof RegExp));
});
