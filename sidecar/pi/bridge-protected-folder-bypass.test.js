import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import test from "node:test";

import {
  protectedAgentNotice,
  protectedCommandViolation,
  protectedWriteViolation,
} from "./bridge-protected-paths.js";

/**
 * 真机绕过的回归：读者在设置里列的「受限文件夹」**不能被换写法绕过**，而且被拦时要
 * **明确告诉 agent 此路不通**。
 *
 * 现场（用户实测，beta.113）：`write` 工具拦得住 ✓、bash 写字面路径拦得住 ✓，但
 * `TARGET=/受限目录; echo x > "$TARGET/f.txt"` **没被拦** ✗ —— 文件被创建了。
 * 用户的原话：agent 被拦后如果不知道"这条路不允许"，它就会一直换写法找突破口 ✗。
 *
 * 这里钉两件事：① 变量 / cd / ~ / $HOME 这些换写法必须同样判违规（宁严勿松）；
 * ② 拦下时给 **agent** 的提示要含"被拒路径 + 原因 + 不要绕过 + 唯一正确做法"。
 */

// 中性夹具：不放任何读者私有目录名。
const PROTECTED = "/tmp/example-project/out";
const WORKSPACE = "/tmp/example-project";
const USER_PROTECTED_FOLDER_LABEL = "user-protected-folder";

const SHELL_OPTIONS = {
  roots: [],
  enforcedRoots: [{ path: PROTECTED, label: USER_PROTECTED_FOLDER_LABEL }],
  ownWorkspace: WORKSPACE,
  cwd: WORKSPACE,
  env: { HOME: "/tmp/example-home", PWD: WORKSPACE },
};

test("变量拼出来的写目标同样被拦（真机 bug 的原形）", () => {
  for (const command of [
    `TARGET=${PROTECTED}; echo x > "$TARGET/f.txt"`,
    `TARGET=${PROTECTED}; echo x > $TARGET/f.txt`,
    `D=${PROTECTED}; T="$D/f.txt"; printf probe > "$T"`,
    `export TARGET=${PROTECTED}\nprintf probe > "$TARGET/f.txt"`,
    `TARGET=${PROTECTED}; tee "$TARGET/f.txt" <<< probe`,
  ]) {
    const violation = protectedCommandViolation(command, SHELL_OPTIONS);
    assert.equal(
      violation?.label,
      USER_PROTECTED_FOLDER_LABEL,
      `必须拦（变量拼路径）：${command}`,
    );
  }
});

test("cd 进受限目录之后再写同样被拦（相对目标按真实落点判）", () => {
  for (const command of [
    `cd ${PROTECTED} && echo x > f.txt`,
    `cd ${PROTECTED}; touch y.txt`,
    `cd ${PROTECTED} && printf probe >> note.txt`,
  ]) {
    const violation = protectedCommandViolation(command, SHELL_OPTIONS);
    assert.equal(
      violation?.label,
      USER_PROTECTED_FOLDER_LABEL,
      `必须拦（cd 后相对写）：${command}`,
    );
  }
});

test("~ 与 $HOME 展开到受限根里同样被拦", () => {
  const options = {
    ...SHELL_OPTIONS,
    enforcedRoots: [{ path: "/tmp/example-home/MilkSU/notes", label: USER_PROTECTED_FOLDER_LABEL }],
    env: { HOME: "/tmp/example-home", PWD: WORKSPACE },
  };
  for (const command of [
    "echo x > ~/MilkSU/notes/a.txt",
    "echo x > \"$HOME/MilkSU/notes/a.txt\"",
    "echo x > \"${HOME}/MilkSU/notes/a.txt\"",
  ]) {
    const violation = protectedCommandViolation(command, options);
    assert.equal(
      violation?.label,
      USER_PROTECTED_FOLDER_LABEL,
      `必须拦（$HOME/~ 展开）：${command}`,
    );
  }
});

test("字面受限路径仍然被拦（回归保护，别被本次改动弄坏）", () => {
  const violation = protectedCommandViolation(`printf probe > ${PROTECTED}/f.txt`, SHELL_OPTIONS);
  assert.equal(violation?.label, USER_PROTECTED_FOLDER_LABEL);
});

test("没被列进去的路径不误拦，只读也不误拦（不能写成「永远拦」）", () => {
  // 同一个目录，但读者**没有**把它列进受限清单 ⇒ 不许拦。
  const notListed = protectedCommandViolation("echo x > /tmp/example-project/build/f.txt", SHELL_OPTIONS);
  assert.equal(notListed, null, "没列进去的路径不许拦");

  // 只是读：列出来、cat、grep 都必须放过（仓库既有口径：读是正常工作）。
  for (const command of [
    `ls -la ${PROTECTED}`,
    `cat ${PROTECTED}/f.txt`,
    `grep -rn "x" ${PROTECTED}`,
    `ls "${PROTECTED}" 2>/dev/null | head`,
    `head -c 40 ${PROTECTED}/f.txt`,
  ]) {
    assert.equal(
      protectedCommandViolation(command, SHELL_OPTIONS),
      null,
      `只读必须放过：${command}`,
    );
  }

  // 软链解析是**已知限制**（本轮不做）：受限目录的软链别名目前判不出来，报告里要写清。
});

test("拦下时给 agent 的提示：路径 + 原因 + 不要绕过 + 唯一正确做法", () => {
  const violation = protectedCommandViolation(
    `TARGET=${PROTECTED}; echo x > "$TARGET/f.txt"`,
    SHELL_OPTIONS,
  );
  assert.ok(violation, "先得真的拦下来");

  const zh = protectedAgentNotice(violation, "zh");
  assert.ok(zh.includes(violation.path), "要说清哪个路径被拒");
  assert.match(zh, /受限文件夹/, "要说明原因（在读者的受限文件夹列表里）");
  assert.match(zh, /不要绕过/, "要明确禁止绕过");
  assert.match(zh, /设置/, "要指出唯一正确做法是读者去设置里移除");
  assert.match(zh, /shell 变量|cd|别的工具/, "要点名别再换写法");

  const en = protectedAgentNotice(violation, "en");
  assert.ok(en.includes(violation.path), "英文也要说清路径");
  assert.match(en, /protected list/, "英文要说原因");
  assert.match(en, /Do not work around it/, "英文要禁止绕过");
  assert.match(en, /Settings/, "英文要指出读者去设置里处理");
});

test("给 agent 的提示与给读者的提示是两条（读者那条不变）", () => {
  const violation = protectedCommandViolation(`printf probe > ${PROTECTED}/f.txt`, SHELL_OPTIONS);
  const agentNotice = protectedAgentNotice(violation, "zh");
  // 读者侧那条的口径是"已拦截：这个目录在你的设置里被标记为…"（不动它）；
  // agent 侧这条必须**额外**告诉他别绕。
  assert.notEqual(agentNotice, "已拦截：这个目录在你的设置里被标记为「agent 不可改写」。");
  assert.match(agentNotice, /不要绕过/);
});

test("写入工具那条路（protectedWriteViolation）不受本次改动影响", () => {
  const violation = protectedWriteViolation(`${PROTECTED}/note.txt`, {
    roots: [],
    enforcedRoots: SHELL_OPTIONS.enforcedRoots,
    ownWorkspace: WORKSPACE,
  });
  assert.equal(violation?.label, USER_PROTECTED_FOLDER_LABEL);
  // 未列入的路径照旧放过。
  assert.equal(
    protectedWriteViolation(joinTmp("example-project", "build", "note.txt"), {
      roots: [],
      enforcedRoots: SHELL_OPTIONS.enforcedRoots,
      ownWorkspace: WORKSPACE,
    }),
    null,
  );
});

function joinTmp(...parts) {
  return [tmpdir().replace(/[\\/]+$/, ""), ...parts].join("/");
}
