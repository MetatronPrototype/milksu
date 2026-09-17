import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  codingBrowserDescriptorFile,
  codingBrowserDescriptorKey,
  computerUseSocket,
  dshProductIpc,
  ephemeralRoot,
  playwrightSocketRoot,
  unixComputerUseSocket,
  unixDshProductIpc,
  playwrightProcessSocketRoot,
  playwrightProcessTempRoot,
} from "./hostpath.js";

test("ephemeral root uses XDG_RUNTIME_DIR on Linux and os.tmpdir otherwise", () => {
  assert.equal(
    ephemeralRoot({ XDG_RUNTIME_DIR: "/run/user/1000" }, "linux"),
    "/run/user/1000",
  );
  assert.equal(ephemeralRoot({}, "linux"), tmpdir());
  assert.equal(ephemeralRoot({ XDG_RUNTIME_DIR: "/run/user/1000" }, "darwin"), tmpdir());
});

test("Playwright process sockets stay short enough for sockaddr_un", () => {
  if (process.platform === "win32") {
    assert.equal(playwrightProcessSocketRoot({}, "win32"), "");
    return;
  }
  const root = playwrightProcessSocketRoot();
  assert.ok(root);
  assert.ok(Buffer.byteLength(join(root, "playwright-xxxx.sock")) <= 103);
  assert.ok(Buffer.byteLength(join(root, "s-12345-abcdef.sock")) <= 103);
  const tempRoot = playwrightProcessTempRoot();
  assert.ok(tempRoot);
  assert.notEqual(tempRoot, root);
  assert.ok(Buffer.byteLength(join(tempRoot, "playwright-xxxx.sock")) <= 103);
  assert.doesNotMatch(root, /^\/tmp(?:\/|$)/);
  assert.doesNotMatch(root, /^\/private\/tmp(?:\/|$)/);
});

test("DSH product IPC stays under the ephemeral root and short enough for sockaddr_un", () => {
  if (process.platform === "win32") {
    assert.match(dshProductIpc("conversation-1"), /^\\\\\.\\pipe\\milksu-dsh-/);
    return;
  }
  const path = dshProductIpc("conversation-1");
  assert.ok(Buffer.byteLength(path) <= 103);
  const root = ephemeralRoot();
  if (Buffer.byteLength(join(root, "dsh-conversation-1.sock")) <= 103) {
    assert.ok(path.startsWith(root));
  }
});

test("DSH product IPC relocates when the root is a product workspace tmp", () => {
  if (process.platform === "win32") return;
  const root = join("/", "d".repeat(107));
  const path = unixDshProductIpc(root, "bridge-123456");
  assert.ok(Buffer.byteLength(path) <= 103);
  assert.equal(path.startsWith(root), false);
});

test("Computer Use unix sockets stay short and land under a bindable root", () => {
  const sessionId = "computer_0123456789abcdef0123456789abcdef";
  if (process.platform === "win32") {
    assert.equal(
      computerUseSocket(sessionId),
      `\\\\.\\pipe\\milksu-computer-use-${sessionId}`,
    );
    return;
  }
  const path = computerUseSocket(sessionId);
  // The socket has to live under one of the two roots we can bind in. A long temporary
  // directory (this machine: a workspace path with non-ASCII characters) simply cannot hold
  // a socket, so the fallback root is the correct answer there, not a longer path.
  assert.ok(
    path.startsWith(ephemeralRoot()) || path.includes(join(".cache", "milksu-ipc")),
    `unexpected socket root: ${path}`,
  );
  assert.ok(Buffer.byteLength(path) <= 103, `socket too long (${Buffer.byteLength(path)}): ${path}`);
  assert.equal(path.includes(`${join("milksu-computer-use", sessionId)}`), false);

  // A deliberately huge, non-ASCII root must still yield a bindable path.
  const hugeRoot = join("/tmp", "无项目任务-98f6f306".repeat(6));
  const fallback = unixComputerUseSocket(hugeRoot, sessionId);
  assert.equal(fallback, "", "a root with no room must report that it cannot hold a socket");
});

test("Coding Browser descriptor file stays under the playwright ephemeral root", () => {
  const conversationId = "conversation-coding-browser-1";
  const env = { TMPDIR: "/runtime" };
  const file = codingBrowserDescriptorFile(conversationId, env, "darwin");
  const key = codingBrowserDescriptorKey(conversationId);
  assert.equal(key.length, 16);
  assert.equal(file, join(playwrightSocketRoot(env, "darwin"), key, "cdp.json"));
  assert.equal(codingBrowserDescriptorFile(" "), "");
});

test("Computer Use unix sockets hash the session id when the root is long", () => {
  const root = join("/", "d".repeat(69));
  const sessionId = "computer_0123456789abcdef0123456789abcdef";
  const path = unixComputerUseSocket(root, sessionId);
  assert.ok(Buffer.byteLength(path) <= 103);
  assert.notEqual(path, join(root, "mcu-0123456789abcdef0123456789abcdef.sock"));
});
