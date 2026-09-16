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
// Process-lifetime IPC. Do not inject agents/compaction: those services recycle
// with sessions, Cordis unloads this fiber, and ctx.effect / ctx.on then throw
// "cannot create effect on inactive context" into ACP as Internal error.
// optionalInject is not a Cordis API. Read services in dispatch via ctx.get().

// Cordis FiberState.UNLOADING. effect() throws INACTIVE_EFFECT in this state
// even while uid is still set (required inject lost, fiber unloading).
const fiberStateUnloading = 5;

export function isInactiveEffectError(error) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /cannot create effect on inactive context/i.test(message);
}

export function hostContextAcceptsEffect(ctx) {
  if (!ctx) return false;
  const fiber = ctx.fiber;
  if (fiber) {
    if (fiber.uid === null) return false;
    if (fiber.state === fiberStateUnloading) return false;
  }
  return typeof ctx.effect === "function";
}

export function followupHostAgent(agent, text) {
  const prompt = String(text ?? "").trim();
  if (!prompt) throw new Error("prompt is required");
  if (!agent || typeof agent.followup !== "function") {
    throw new Error("DeepSeek Harness followup is unavailable");
  }
  // DSH Agent.followup queues a next-turn user message and wakes the driver.
  // Do not wait for ACP session/prompt: that call settles only after whenIdle,
  // which includes continuable children and would block the parent composer.
  agent.followup({
    content: [{ type: "text", text: prompt }],
    source: { kind: "user" },
  });
}

export function hostService(ctx, name) {
  if (!ctx || !name) return undefined;
  if (typeof ctx.get === "function") {
    try {
      return ctx.get(name);
    } catch {
      return undefined;
    }
  }
  return ctx[name];
}

function registerOwnedEffect(ctx, execute) {
  if (!hostContextAcceptsEffect(ctx)) return;
  try {
    ctx.effect(execute);
  } catch (error) {
    if (!isInactiveEffectError(error)) throw error;
  }
}

function registerOwnedListener(ctx, name, listener) {
  if (typeof ctx?.on !== "function") return;
  if (ctx.fiber && !hostContextAcceptsEffect(ctx)) return;
  try {
    ctx.on(name, listener);
  } catch (error) {
    if (!isInactiveEffectError(error)) throw error;
  }
}

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

  registerOwnedListener(ctx, "subagent/start", (info) => {
    notifyWatchers({
      phase: "start",
      childId: String(info?.id ?? ""),
      runId: String(info?.runId ?? ""),
    });
  });
  registerOwnedListener(ctx, "subagent/end", (info) => {
    notifyWatchers({
      phase: "end",
      childId: String(info?.id ?? ""),
      runId: String(info?.runId ?? ""),
      stopReason: info?.stopReason,
    });
  });

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

  registerOwnedEffect(ctx, () => {
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
  const subagents = hostService(ctx, "subagents");
  const agents = hostService(ctx, "agents");
  if (message.method === "list_subagents") {
    return { subagentTasks: await listHostSubagents(subagents, sessionId) };
  }
  if (message.method === "interrupt_subagent") {
    await interruptHostSubagent(
      subagents,
      agents,
      sessionId,
      message.params?.subagentId,
    );
    return { interrupted: true };
  }
  if (message.method === "interrupt_all_subagents") {
    const ids = await interruptAllHostSubagents(subagents, agents, sessionId);
    return { interrupted: ids };
  }
  const agent = typeof agents?.get === "function" ? agents.get(sessionId) : undefined;
  if (!agent) throw new Error(`DeepSeek Harness session not found: ${sessionId}`);
  if (message.method === "set_approval") {
    const policy = String(message.params?.policy ?? "").trim();
    const presets = hostService(ctx, "permissionPresets");
    const preset = dshPresetForApprovalPolicy(policy);
    if (presets && typeof presets.set === "function") {
      await presets.set(agent, preset);
    }
    return { preset };
  }
  if (message.method === "followup") {
    followupHostAgent(agent, message.params?.prompt);
    return { queued: true };
  }
  if (message.method !== "compact") {
    throw new Error(`Unknown MilkSU host method: ${message.method}`);
  }
  const compaction = hostService(ctx, "compaction");
  if (!compaction || typeof compaction.compactNow !== "function") {
    throw new Error("DeepSeek Harness compaction is unavailable");
  }
  const result = await compaction.compactNow(agent, AbortSignal.timeout(120_000));
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
