import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  destructiveDeleteDecision,
  destructiveJustification,
  expandDeleteTarget,
  recursiveDeleteTargets,
} from "./bridge-destructive-delete.js";

test("recursive deletion parser covers POSIX, PowerShell, Windows, find, and git clean", () => {
  assert.deepEqual(recursiveDeleteTargets('rm -rf -- "$HOME"'), ["$HOME"]);
  assert.deepEqual(
    recursiveDeleteTargets('powershell.exe -Command "Remove-Item -Recurse -Force $env:USERPROFILE"'),
    ["$env:USERPROFILE"],
  );
  assert.deepEqual(recursiveDeleteTargets('rmdir /s /q "%USERPROFILE%"'), ["%USERPROFILE%"]);
  assert.deepEqual(
    recursiveDeleteTargets('rmdir /s /q "C:\\Users\\demo\\large"'),
    ["C:\\Users\\demo\\large"],
  );
  assert.deepEqual(recursiveDeleteTargets("find . -type f -delete"), ["."]);
  assert.deepEqual(recursiveDeleteTargets("git clean -fdx"), ["."]);
  assert.deepEqual(recursiveDeleteTargets("rm -f notes.txt"), []);
});

test("delete target expansion handles home and cross-platform environment forms", () => {
  const options = {
    environment: { HOME: "/users/demo", USERPROFILE: "C:\\Users\\demo" },
    homeDirectory: "/users/demo",
  };
  assert.equal(expandDeleteTarget("~/cache", options).value, "/users/demo/cache");
  assert.equal(expandDeleteTarget("${HOME}/cache", options).value, "/users/demo/cache");
  assert.equal(
    expandDeleteTarget("%USERPROFILE%\\cache", { ...options, platform: "win32" }).value,
    "C:\\Users\\demo\\cache",
  );
  assert.match(expandDeleteTarget("$UNKNOWN/cache", options).error, /无法安全解析/);
});

test("Full Access still asks before deleting home or the conversation workspace", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "milksu-delete-gate-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const home = join(root, "home");
  const workspace = join(home, "project");
  await mkdir(workspace, { recursive: true });
  const policy = {
    approvalPolicy: "full-auto",
    workspace,
    uiLocale: "zh",
  };

  const homeDecision = await destructiveDeleteDecision({
    toolName: "bash",
    input: { command: 'rm -rf "$HOME"' },
    policy,
    environment: { HOME: home },
    homeDirectory: home,
  });
  assert.equal(homeDecision.action, "approval");
  assert.match(homeDecision.content, new RegExp(home.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(homeDecision.content, /用户主目录/);

  const workspaceDecision = await destructiveDeleteDecision({
    toolName: "bash",
    input: { command: "rm -rf ." },
    policy,
    environment: { HOME: home },
    homeDirectory: home,
  });
  assert.equal(workspaceDecision.action, "approval");
  assert.match(workspaceDecision.content, /当前工作区根目录/);
});

test("symlink and glob targets are normalized before the confirmation decision", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "milksu-delete-link-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const home = join(root, "home");
  const workspace = join(root, "workspace");
  const link = join(workspace, "home-link");
  await mkdir(home, { recursive: true });
  await mkdir(workspace, { recursive: true });
  await symlink(home, link, "dir");
  const policy = { workspace, uiLocale: "zh" };
  const decision = await destructiveDeleteDecision({
    toolName: "bash",
    input: { command: `rm -rf '${link}'/*` },
    policy,
    environment: { HOME: home },
    homeDirectory: home,
  });
  assert.equal(decision.action, "approval");
  assert.match(decision.content, /用户主目录/);
  assert.match(decision.content, new RegExp(home.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("small recursive deletes remain automatic while large directories require confirmation", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "milksu-delete-size-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const workspace = join(root, "workspace");
  const small = join(workspace, "small");
  const large = join(workspace, "large");
  await mkdir(small, { recursive: true });
  await mkdir(large, { recursive: true });
  await writeFile(join(small, "one.txt"), "one");
  await Promise.all(Array.from({ length: 1001 }, (_value, index) => (
    writeFile(join(large, `${index}.txt`), "x")
  )));
  const policy = { workspace, uiLocale: "zh" };

  assert.equal(await destructiveDeleteDecision({
    toolName: "bash",
    input: { command: `rm -rf '${small}'` },
    policy,
    environment: {},
    homeDirectory: join(root, "home"),
  }), null);
  const decision = await destructiveDeleteDecision({
    toolName: "bash",
    input: { command: `rm -rf '${large}'` },
    policy,
    environment: {},
    homeDirectory: join(root, "home"),
  });
  assert.equal(decision.action, "approval");
  assert.match(decision.content, /大型目录/);
});

test("unresolved recursive delete targets are blocked instead of being approved ambiguously", async () => {
  const decision = await destructiveDeleteDecision({
    toolName: "bash",
    input: { command: 'rm -rf "$UNKNOWN_ROOT"' },
    policy: { workspace: process.cwd(), uiLocale: "zh" },
    environment: {},
    homeDirectory: "/nonexistent-home",
  });
  assert.equal(decision.action, "block");
  assert.match(decision.reason, /明确的绝对路径/);
});

// A background task must be judged exactly like the foreground call; anything that
// reaches "needs approval" is refused instead, because nobody can approve it.
test("judges a background task like the foreground command", async () => {
  const directory = await mkdtemp(join(tmpdir(), "milksu-bg-guard-"));
  const target = join(directory, "many");
  await mkdir(target, { recursive: true });
  for (let index = 0; index < 1100; index += 1) {
    await writeFile(join(target, `file-${index}.txt`), "x");
  }

  const foreground = await destructiveDeleteDecision({
    toolName: "bash",
    input: { command: `rm -rf ${target}` },
    policy: { workspace: directory },
  });
  for (const input of [
    { action: "spawn", command: `rm -rf ${target}` },
    { action: "resume", argv: ["rm", "-rf", target] },
    { action: "restart", commandText: `rm -rf ${target}` },
  ]) {
    const background = await destructiveDeleteDecision({
      toolName: "bg_task",
      input,
      policy: { workspace: directory },
    });
    assert.deepEqual(
      background?.action ?? null,
      foreground?.action ?? null,
      `bg_task action ${input.action} must match the foreground verdict`,
    );
  }

  const harmless = await destructiveDeleteDecision({
    toolName: "bg_task",
    input: { action: "spawn", command: "echo hello" },
    policy: { workspace: directory },
  });
  assert.equal(harmless, null);
});

// A recursive delete must carry the requester's own reason; a bare rm -rf fails closed
// so the card can never show "the requester did not provide a purpose".
test("requires a purpose and a safety note for a recursive delete", () => {
  const missing = destructiveJustification({ command: "rm -rf /x" });
  assert.equal(missing.ok, false);
  assert.match(missing.reason, /request_destructive_delete/);

  assert.equal(destructiveJustification({ justification: { purpose: " ", safety: "x" } }).ok, false);
  assert.equal(destructiveJustification({ justification: { purpose: "x", safety: "  " } }).ok, false);
  assert.equal(destructiveJustification({ purpose: "", safety: "" }).ok, false);

  const provided = destructiveJustification({
    justification: { purpose: "删除旧备份", safety: "程序副本，可重建" },
  });
  assert.equal(provided.ok, true);
  assert.equal(provided.purpose, "删除旧备份");
  assert.equal(provided.safety, "程序副本，可重建");
});

// A pattern or a heredoc body is data, not a command: searching for "rm -rf" must not be
// treated as deleting, while a delete hidden inside a shell string still must be.
test("the parser ignores quoted text, grep patterns and heredoc bodies", () => {
  assert.deepEqual(recursiveDeleteTargets('grep -rn "rm -rf /" .'), []);
  assert.deepEqual(recursiveDeleteTargets("grep rm -rf ."), []);
  assert.deepEqual(recursiveDeleteTargets('echo "rm -rf /tmp/x"'), []);
  assert.deepEqual(recursiveDeleteTargets("cat <<EOF\nrm -rf /tmp/x\nEOF\n"), []);
  assert.deepEqual(recursiveDeleteTargets("cat <<-\"EOT\"\n\trm -rf /tmp/x\n\tEOT\n"), []);
  // ... but a real delete is still found.
  assert.deepEqual(recursiveDeleteTargets("rm -rf /tmp/x"), ["/tmp/x"]);
  assert.deepEqual(recursiveDeleteTargets('rm -rf "/tmp/a b"'), ["/tmp/a b"]);
  assert.deepEqual(recursiveDeleteTargets('bash -c "rm -rf /tmp/y"'), ["/tmp/y"]);
  assert.deepEqual(recursiveDeleteTargets("sh -c 'rm -rf /tmp/z'"), ["/tmp/z"]);
  assert.deepEqual(recursiveDeleteTargets("find /tmp/x -delete"), ["/tmp/x"]);
  // A pipe into xargs has no visible target, so the working directory is assumed.
  assert.deepEqual(recursiveDeleteTargets("grep x . | xargs rm -rf"), ["."]);
})
