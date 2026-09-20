/**
 * 未送达回执的 spool。
 *
 * 今天真实发生过：一条跨会话回执**没送到**，对面看到的是"对方 5 小时没动"，于是重复派单，
 * 白花二三十分钟。所以：出厂消息**没送达**时要把它落到盘上（目标会话、时间、原文），
 * 下一次**成功投递**时自动前置一句"上一条没送到，原文如下"，让信息不再凭空消失。
 *
 * 只记「没送达」（refused / 超时未确认 / 其它非 delivered）✗ —— `queued` 是**已被接收**的
 * 正常状态 ✓，不该算失败（否则会把等待误记成丢失 ✗）。
 */

import * as nodeFs from "node:fs/promises";

const DEFAULT_PREFIX_LIMIT = 3;

/**
 * 这次投递算不算"没送达"（要进 spool）。`delivered` 当然不算；`queued` 也**不算** ——
 * 它表示 host 已经接收、只是在排队等前一个回合结束，把等待误记成丢失会造成错误的补投。
 */
export function shouldSpoolDelivery(status) {
  const value = String(status ?? "").trim();
  return value !== "delivered" && value !== "queued";
}

export function createDeliverySpool({
  dir,
  now = () => Date.now(),
  createID = () => Math.random().toString(36).slice(2, 10),
  // 默认用真实文件系统；测试注入假 fs（不碰磁盘、不用真等）。
  fs = nodeFs,
} = {}) {
  const disabled = !dir || !fs;
  const enabled = !disabled;

  function pathFor(entry) {
    return `${dir}/${entry.at}-${entry.id}.json`;
  }

  return {
    enabled,

    /** 记一条没送达的消息。记不下（禁用/写失败）也不算致命：投递本身的结果不受影响。 */
    async record({ targetConversationId, text, kind, status, detail }) {
      if (disabled) return false;
      const entry = {
        id: createID(),
        at: now(),
        targetConversationId: String(targetConversationId ?? ""),
        kind: kind === "result" ? "result" : "request",
        status: String(status ?? "unknown"),
        detail: String(detail ?? ""),
        text: String(text ?? ""),
      };
      try {
        await fs.mkdir(dir, { recursive: true });
        await fs.writeFile(pathFor(entry), JSON.stringify(entry), "utf8");
        return true;
      } catch {
        return false;
      }
    },

    /** 还没补投的条目，按时间从早到晚（先丢的先补）。读不动就当没有。 */
    async pending() {
      if (disabled) return [];
      let names = [];
      try {
        names = await fs.readdir(dir);
      } catch {
        return [];
      }
      const entries = [];
      for (const name of names) {
        if (!name.endsWith(".json")) continue;
        try {
          entries.push(JSON.parse(await fs.readFile(`${dir}/${name}`, "utf8")));
        } catch {
          // 坏文件跳过（不能因为一条坏文件让补投整个卡住）。
        }
      }
      entries.sort((a, b) => Number(a?.at ?? 0) - Number(b?.at ?? 0));
      return entries;
    },

    /** 已经补投过的条目清掉，避免反复前置同一段。 */
    async clear(entries) {
      if (disabled) return 0;
      let removed = 0;
      for (const entry of entries ?? []) {
        try {
          await fs.unlink(pathFor(entry));
          removed += 1;
        } catch {
          // 已经没了就算了。
        }
      }
      return removed;
    },

    /**
     * 前置说明：说明上一条没送到、原文是什么。中英成对（仓库有 uiLocaleCoverage 会抓）。
     */
    formatPrefix(entries, chinese = false) {
      // 禁用（没配目录）的 spool 从没记过东西 ⇒ 也没有可补投的说明。
      if (!enabled) return "";
      const list = (entries ?? []).filter(Boolean);
      if (!list.length) return "";
      const shown = list.slice(0, DEFAULT_PREFIX_LIMIT);
      const more = list.length - shown.length;
      if (chinese) {
        const body = shown
          .map((entry, index) => `${index + 1}. （→ ${entry.targetConversationId}，${new Date(Number(entry.at)).toISOString()}）\n${entry.text}`)
          .join("\n\n");
        return `（上一条回执 #${shown[0].id} 未送达，摘要与原文如下；这次重投。）\n\n${body}`
          + (more > 0 ? `\n\n（另有 ${more} 条同样未送达，见 spool。）` : "");
      }
      const body = shown
        .map((entry, index) => `${index + 1}. (to ${entry.targetConversationId}, ${new Date(Number(entry.at)).toISOString()})\n${entry.text}`)
        .join("\n\n");
      return `(The previous hand-off #${shown[0].id} was not delivered; its text follows, now resent.)\n\n${body}`
        + (more > 0 ? `\n\n(${more} more are waiting in the spool.)` : "");
    },
  };
}
