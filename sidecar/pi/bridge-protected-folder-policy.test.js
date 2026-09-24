import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { loadSessionPolicy } from "./bridge-policy.js";

/**
 * 真机 bug 的回归：读者在设置里列的「受限文件夹」**必须进到会话策略里**。
 *
 * 现场形状（已实测）：宿主（Go）把 `protectedFolders` 发给了侧车 ✓，侧车的写入守卫也读
 * `policy.protectedFolders` ✓，但**中间那步**（`bridge.js` 的 `loadRuntimeSessionPolicy` 构造
 * 策略时）没把它转发给 `loadSessionPolicy` ✗ ⇒ 存进 `sessionPolicies` 的策略里永远是空列表
 * ⇒ 守卫读到空 ⇒ **写入不被拦**（用户实测：往受限目录写文件成功 ✗）。
 *
 * 这里钉两件事：① 策略层确实会带上并归一化这份列表；② `bridge.js` 那处转发**真的存在**
 * （第 ② 条是源码守卫：把转发删掉就会红 —— 这正是当初漏掉的那一行）。
 */

const SIDECAR_PI = dirname(fileURLToPath(import.meta.url));

test("a session policy carries the reader's protected folders, normalized", async () => {
  const policy = await loadSessionPolicy(tmpdir(), "", {
    protectedFolders: [" /tmp/example-project/out ", "", "/tmp/example-project/out", "  "],
  });

  assert.deepEqual(
    policy.protectedFolders,
    ["/tmp/example-project/out"],
    "列表必须落进策略（去空白、去空项、去重）",
  );
});

test("a session policy without the list stays empty (nothing is protected by accident)", async () => {
  const policy = await loadSessionPolicy(tmpdir(), "", {});

  assert.deepEqual(policy.protectedFolders, []);
});

test("bridge.js forwards the command's protected folders into the session policy", () => {
  const source = readFileSync(join(SIDECAR_PI, "bridge.js"), "utf8");
  const call = source.indexOf("await loadSessionPolicy(cwd, command.sessionRole, {");

  assert.notEqual(call, -1, "找不到 loadRuntimeSessionPolicy 里的 loadSessionPolicy 调用（结构变了就更新这条测试）");

  const options = source.slice(call, source.indexOf("});", call));

  // ⚠️ 正则必须要求**行首就是** `protectedFolders:` —— 否则“被注释掉的那一行”也会匹配
  // （实测：把转发注释掉，守卫仍绿 ⇒ 假守卫 ✗）。
  assert.match(
    options,
    /^\s*protectedFolders:\s*Array\.isArray\(command\.protectedFolders\)/m,
    "少了这一处转发，读者的受限文件夹就不会进守卫那份策略（真机 bug 的原形）",
  );
});
