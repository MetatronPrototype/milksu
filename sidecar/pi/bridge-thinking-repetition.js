// 思考（reasoning）复读护栏。
//
// 真机案例：一次思考烧掉 6 分钟 / 23,276 reasoning token，内容全在同一行上打转（`(unchanged)` ×8 连续多行），
// 模型自己停不下来。引擎原有的"不许无进展续跑"护栏是 createToolRepeatGuard（bridge-tool-repeat.js），
// 它只在**工具调用**处被喂数据（bridge.js 的 repeatGuard.inspect(toolName, input)）⇒ reasoning 文本
// **从不经过它** ⇒ 那种复读永远不会被拦。所以这是**思考内容**这一层的第一条护栏。
//
// 只在**真的复读**时触发：判据是"**连续** N 行完全相同"。长但每行都不同的思考必然放行（有测试钉住）。

/** 第一道闸（只提示、不停轮）：连续多少行完全相同就算复读。 */
export const THINKING_REPEAT_LINES = 8;

/** 第二道闸（**会停轮**）：同一行连续这么多次 ⇒ 判为死循环。
 *  读者问过「怎么判定而不误伤」⇒ 三道闸全过才停：①行 trim 后 ≥16 字符、②连续 ≥24 次、
 *  ③到这一步**结束**时仍在重复（中途自己想通的不停）。 */
export const THINKING_REPEAT_STOP_LINES = 24;

/** 第二道闸只认“有内容”的行：挡住 } / - / --- / ``` 这类结构性短行（它们在正常输出里成片出现）。 */
export const THINKING_REPEAT_MIN_LINE_CHARS = 16;

/** 命中时给读者的句子（成对双语，前端按界面语言选一句）。 */
export const THINKING_REPEAT_NOTICE = {
  // 不能说“已跳过”：命中时那行思考**已经进入数据流**了，这里也确实没有任何跳过/中止的代码 ✗。
  // 实话是：发现了复读，但这一步中途掐不断（思考是一整段连续生成、没有钩子）。
  notice:
    "检测到这一步的思考在复读（连续 8 行完全相同）。这一步中途无法中止；如果它继续这样重复，这一步结束时会自动停止本轮。",
  noticeEnglish:
    "This thinking step is repeating itself (8 identical lines in a row). It cannot be stopped mid-step; if it keeps repeating, the turn stops when this step ends.",
};

/**
 * 每个会话一份护栏：吃 thinking 增量，**按行**切段，连续 N 行完全相同即命中一次。
 * 只记内容、不改内容：命中后把事实交给调用方去告诉读者（绝不静默）。
 */
export function createThinkingRepetitionGuard({ threshold = THINKING_REPEAT_LINES } = {}) {
  const states = new Map();

  function stateFor(conversationId) {
    const key = String(conversationId ?? "");
    let state = states.get(key);
    if (!state) {
      state = { buffer: "", previous: "", run: 0, fired: false };
      states.set(key, state);
    }
    return state;
  }

  return {
    /** 新一轮思考开始 ⇒ 清掉这一会话的累积（不跨轮误判）。 */
    reset(conversationId) {
      states.delete(String(conversationId ?? ""));
    },
    /**
     * 喂一个 thinking 增量。返回 null 或 { line, run }（同一会话每个"思考步"只报一次）。
     */
    push(conversationId, delta) {
      const state = stateFor(conversationId);
      state.buffer += String(delta ?? "");
      let hit = null;
      for (let index = state.buffer.indexOf("\n"); index >= 0; index = state.buffer.indexOf("\n")) {
        const line = state.buffer.slice(0, index).trim();
        state.buffer = state.buffer.slice(index + 1);
        if (!line) continue;
        if (line === state.previous) {
          state.run += 1;
        } else {
          state.previous = line;
          state.run = 1;
        }
        if (!state.fired && state.run >= threshold) {
          state.fired = true;
          hit = { line, run: state.run };
        }
      }
      return hit;
    },
    /**
     * 这一步**结束时**问一次：还在重复吗？
     *
     * 三道闸（读者口径：宁可少停，不要误伤）：
     * ① 那一行 trim 后 ≥ THINKING_REPEAT_MIN_LINE_CHARS（挡结构性短行）；
     * ② 连续 ≥ THINKING_REPEAT_STOP_LINES 次；
     * ③ **最后一行仍属于同一个 run** —— 中途换过行就说明它自己想通了，不停 ✗。
     */
    pendingStop(conversationId) {
      const state = states.get(String(conversationId ?? ""));
      if (!state) return null;
      const line = state.previous;
      if (!line || line.length < THINKING_REPEAT_MIN_LINE_CHARS) return null;
      if (state.run < THINKING_REPEAT_STOP_LINES) return null;
      return { line, run: state.run };
    },
  };
}
