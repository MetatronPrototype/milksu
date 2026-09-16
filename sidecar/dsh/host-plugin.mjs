import { createServer } from "node:net";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { dshPresetForApprovalPolicy } from "./permission.js";
import {
  interruptAllHostSubagents,
  interruptHostSubagent,
  listHostSubagents,
} from "./host-subagents.js";

export const name = "milksu-dsh-host";
export const inject = ["compaction", "agents"];
export const optionalInject = ["permissionPresets", "subagents"];

export function apply(ctx) {
  const path = String(process.env.MILKSU_DSH_HOST_IPC ?? "").trim();
  if (!path) return;

  try {
    mkdirSync(dirname(path), { mode: 0o700, recursive: true });
  } catch {
    // Named pipes have no parent directory.
  }

  const watchers = new Set();

  function notifyWatchers(payload) {
    const line = `${JSON.stringify({ method: "subagent_event", params: payload })}\n`;
    for (const socket of watchers) {
      try {
        socket.write(line);
      } catch {
        watchers.delete(socket);
      }
    }
  }

  if (ctx.subagents) {
    ctx.on("subagent/start", (info) => {
      notifyWatchers({
        phase: "start",
        childId: String(info?.id ?? ""),
        runId: String(info?.runId ?? ""),
      });
    });
    ctx.on("subagent/end", (info) => {
      notifyWatchers({
        phase: "end",
        childId: String(info?.id ?? ""),
        runId: String(info?.runId ?? ""),
        stopReason: info?.stopReason,
      });
    });
  }

  const server = createServer(socket => {
    let buffer = "";
    socket.on("close", () => watchers.delete(socket));
    socket.on("data", chunk => {
      buffer += chunk.toString("utf8");
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        void handleLine(ctx, socket, watchers, line);
      }
    });
  });

  ctx.effect(() => {
    server.listen(path);
    return () => {
      server.close();
    };
  });
}

async function handleLine(ctx, socket, watchers, line) {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return;
  }
  try {
    const result = await dispatch(ctx, watchers, socket, message);
    socket.write(`${JSON.stringify({ id: message.id, result })}\n`);
  } catch (error) {
    socket.write(`${JSON.stringify({
      id: message.id,
      error: { message: error instanceof Error ? error.message : String(error) },
    })}\n`);
  }
}

export async function dispatch(ctx, watchers, socket, message) {
  if (message.method === "watch") {
    watchers.add(socket);
    return { watching: true };
  }
  const sessionId = String(message.params?.sessionId ?? "").trim();
  if (!sessionId) throw new Error("sessionId is required");
  if (message.method === "list_subagents") {
    return { subagentTasks: await listHostSubagents(ctx.subagents, sessionId) };
  }
  if (message.method === "interrupt_subagent") {
    await interruptHostSubagent(
      ctx.subagents,
      ctx.agents,
      sessionId,
      message.params?.subagentId,
    );
    return { interrupted: true };
  }
  if (message.method === "interrupt_all_subagents") {
    const ids = await interruptAllHostSubagents(ctx.subagents, ctx.agents, sessionId);
    return { interrupted: ids };
  }
  const agent = ctx.agents.get(sessionId);
  if (!agent) throw new Error(`DeepSeek Harness session not found: ${sessionId}`);
  if (message.method === "set_approval") {
    const policy = String(message.params?.policy ?? "").trim();
    const presets = ctx.permissionPresets;
    const preset = dshPresetForApprovalPolicy(policy);
    if (presets && typeof presets.set === "function") {
      await presets.set(agent, preset);
    }
    return { preset };
  }
  if (message.method !== "compact") {
    throw new Error(`Unknown MilkSU host method: ${message.method}`);
  }
  const result = await ctx.compaction.compactNow(agent, AbortSignal.timeout(120_000));
  if (result == null) {
    return { compacted: false, tokensBefore: 0, estimatedTokensAfter: 0 };
  }
  return {
    compacted: true,
    tokensBefore: Number(result.shadowedTokenCount ?? 0),
    estimatedTokensAfter: 0,
    summarySeq: result.summarySeq,
  };
}
