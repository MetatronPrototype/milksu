import assert from "node:assert/strict";
import test from "node:test";
import {
  composeMilkSUWorkflowSystemPrompt,
  roleGuidanceForSession,
} from "./bridge-workflow-prompt.js";

test("workflow prompt keeps host facts and omits product-tool essays", () => {
  const prompt = composeMilkSUWorkflowSystemPrompt("You are MilkSU.", {
    sessionRole: "solver",
    policy: {
      workspace: "/workspace",
      uiLocale: "zh-CN",
      codingBrowser: true,
      activeTools: ["subagent", "milksu_workspace", "milksu_ask", "milksu_progress"],
    },
  });
  assert.match(prompt, /You are MilkSU/);
  assert.match(prompt, /Runtime context/);
  assert.match(prompt, /Workspace identity/);
  assert.match(prompt, /falsifiable CTF hypothesis/);
  assert.doesNotMatch(prompt, /at most four subagent tasks/);
  assert.doesNotMatch(prompt, /When the user asks to open a subagent/);
  assert.doesNotMatch(prompt, /built-in isolated browser/);
  assert.doesNotMatch(prompt, /milksu_progress/);
  assert.doesNotMatch(prompt, /milksu_ask/);
  assert.doesNotMatch(prompt, /MUST call/);
  assert.doesNotMatch(prompt, /50KB or 2000 lines/);
  assert.doesNotMatch(prompt, /list_records/);
  assert.doesNotMatch(prompt, /Do not scan the user message/);
});

test("workflow prompt skips optional surfaces that are off", () => {
  const prompt = composeMilkSUWorkflowSystemPrompt("base", {
    sessionRole: "",
    policy: { activeTools: [] },
  });
  assert.equal(roleGuidanceForSession(""), "");
  assert.match(prompt, /^base\n\nRuntime context:/);
  assert.doesNotMatch(prompt, /subagent/);
  assert.doesNotMatch(prompt, /isolated browser/);
});

// 搬运自本地分支：每次工具调用前都必须留可见正文（整条"可见进度"规则）。
// 上游把 subagent / isolated browser 两段引导从系统提示里移除了（上面的 doesNotMatch 就是为此），
// 但"工具调用前先写一句人话"这条是本地新增、且与本基线实现一致，所以保留。
test("workflow prompt asks for visible text before every tool call", () => {
  for (const sessionRole of ["", "solver", "strategist", "tool-builder"]) {
    const prompt = composeMilkSUWorkflowSystemPrompt("base", {
      sessionRole,
      policy: { workspace: "/workspace", uiLocale: "zh-CN" },
    });
    assert.match(prompt, /Before every tool call, write one short sentence of visible text/);
    assert.match(prompt, /thinking is not the answer/);
  }
});
