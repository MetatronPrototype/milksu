import {
  createAgentSession,
  DefaultResourceLoader,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import { existsSync } from "node:fs";
import { createInterface } from "node:readline";
import { basename, dirname, join, resolve } from "node:path";
import { readFile, rm, unlink } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Type } from "typebox";
import {
  codingAskToolName,
  formatAskSelection,
  formatAskToolInput,
  normalizeAskOptions,
} from "./bridge-ask.js";
import { contextWindowOverride, registeredContextWindow, registeredMaxTokens } from "./known-context-window.cjs";
import {
  createMcpAdapter,
  listPiBackgroundTaskMetas,
  piBackgroundTasksExtension,
  piGoalExtension,
  piLspExtension,
  piSubAgentExtension,
  readPiBackgroundTaskLog,
  spawnPiBackgroundTask,
  stopPiBackgroundTask,
} from "./reviewed-ts/extensions.js";
import { dropSendAfterAbort } from "./bridge-abort.js";
import {
  createToolRepeatGuard,
  toolBudgetPrompt,
  toolBudgetToolName,
} from "./bridge-tool-repeat.js";
import {
  loadSessionPolicy,
  normalizeCodingProductAction,
} from "./bridge-policy.js";
import { createApprovalBroker } from "./bridge-approval.js";
import { createDeliveryBroker } from "./bridge-delivery.js";
import { isExternalMessagePrompt } from "./bridge-external-content.js";
import { startTurnHeartbeat } from "./bridge-turn-heartbeat.js";
import {
  PROTECTED_ROOTS_ENV,
  dataDirectoryFromEnvironment,
  derivedProtectedRoots,
  mergeProtectedRoots,
  parseProtectedRoots,
  protectedCommandViolation,
  protectedWriteViolation,
} from "./bridge-protected-paths.js";
import {
  codingCollaborationRequiresApproval,
  codingMcpOperationRequiresApproval,
  mcpConversationGrantKey,
  resolveCodingMcpServer,
} from "./bridge-auto-approval.js";
import { createReviewedLspExtension } from "./bridge-lsp.js";
import {
  applyCodingResourcePolicy,
  describeLoadedExtensions,
} from "./bridge-resource-policy.js";
import { preparePromptAttachments } from "./bridge-attachments.js";
import {
  backgroundTaskMetasForSession,
  projectBackgroundTaskMetas,
} from "./bridge-background-view.js";
import {
  goalKeepsSessionRunning,
  projectSessionGoal,
} from "./bridge-goal-view.js";
import {
  browserUseMcpServerName,
  browserUseSelectionChanged,
  codingBrowserMcpServerName,
  codingBrowserSelectionChanged,
  computerUseSelectionChanged,
  ensureMcpMetadataCache,
  loadCodingMcpConfig,
  writeCodingBrowserDescriptor,
  mcpSelectionChanged,
  pluginMcpSessionRequiresReload,
  projectMcpServersFromSelection,
  userMcpSelectionChanged,
} from "./bridge-mcp.js";
import {
  createSecurityToolsExtension,
  normalizeSecurityTools,
  securityToolSelectionChanged,
} from "./bridge-security-tools.js";
import {
  codingBrowserEvidenceFileBlockReason,
  codingBrowserEvidenceRelativePath,
  codingBrowserGuidance,
  codingBrowserToolBlockReason,
  formatCodingBrowserApprovalInput,
} from "./bridge-browser-policy.js";
import { isComputerUseMcpToolName } from "./bridge-computer-use-routing.js";
import { disposeAgentSession } from "./bridge-session-lifecycle.js";
import {
  forkFromMessage,
  lastForkPoint,
  navigateFromUserMessage,
  rewindLastExploration,
} from "./bridge-session-tree.js";
import { createCTFTruncationContinuationExtension } from "./bridge-ctf-continuation.js";
import { createReasoningOnlyRecoveryExtension } from "./bridge-reasoning-recovery.js";
import {
  armAutoCompactionDeadline,
  clearAutoCompactionDeadline,
  compactSession,
  contextUsageSnapshot,
  projectCompactionEvent,
  trackCompaction,
  waitForCompaction,
} from "./bridge-compaction.js";
import {
  codingTurnContractBlocksTool,
  codingTurnContractContext,
  codingTurnContractGuidance,
  codingTurnContractMessageType,
  filterCodingTurnContractMessages,
  normalizeCodingTurnContract,
  withCodingTurnContract,
} from "./bridge-turn-contract.js";
import {
  withVisibleProgressReminder,
} from "./bridge-visible-progress.js";
import {
  codingCollaborationChanged,
  codingCollaborationToolName,
  formatSubagentApproval,
  normalizeCodingCollaboration,
  validateSubagentInput,
} from "./bridge-collaboration.js";
import {
  authorizeImageGenToolCall,
  codingImageGenToolName,
} from "./bridge-imagegen.js";
import {
  resolveWorkflowSessionRole,
  codingWorkspaceToolName,
  createCodingWorkspaceExtension,
  createWorkspaceActionBroker,
  formatCodingWorkspaceInput,
  queueWorkspaceCompaction,
} from "./bridge-workspace.js";
import { composeMilkSUWorkflowSystemPrompt } from "./bridge-workflow-prompt.js";
import { createEnvExtension } from "./bridge-env.js";
import { createComputerUseDriverExtension } from "./bridge-computer-use-driver.js";
import { createComputerUseToolExtension } from "./bridge-computer-use-tool.js";
import { resolveCodingSkillPaths, reviewedCodingSkillPaths } from "./bridge-skills.js";
import { createToolResultBoundExtension } from "./bridge-tool-result-bound.js";
import { createHangGuardExtension } from "./bridge-hang-guard.js";
import {
  registerBackgroundWakeNotifier,
  unregisterBackgroundWakeNotifier,
} from "./bridge-background-wake.js";
import { createDeltaAwareWriter, createStreamDeltaCoalescer } from "./bridge-stream-delta.js";
import {
  createSubagentYieldExtension,
  formatSubagentToolInput,
  projectSubagentRosterEnd,
  projectSubagentRosterStart,
  projectSubagentToolResult,
} from "./bridge-subagent-yield.js";
import {
  projectSteeringQueue,
  removeQueuedMessage,
  steerSession,
} from "./bridge-steering.js";
import {
  commandForTool,
  destructiveDeleteApproval,
  destructiveDeleteDecision,
  destructiveJustification,
  issueDestructiveDeleteCredential,
  recursiveDeleteTargets,
} from "./bridge-destructive-delete.js";
import piWebResearchExtension from "./bridge-web-research.js";
import currentProviderRuntime from "./current-provider-runtime.cjs";
import {
  createModelSourceRouteProvider,
  normalizeModelSourceOrder,
} from "./model-source-routing.js";
import {
  normalizeThinkingProfile,
  withModelThinkingProfile,
  withProviderThinkingProfile,
} from "./bridge-thinking.js";
import { projectAssistantMessageEnd } from "./bridge-message-view.js";
import {
  projectAssistantUsage,
  projectToolModelUsage,
} from "./bridge-usage-view.js";
import { projectSessionContextComposition } from "./bridge-context-composition.js";
import { withTokenFluxModelCompat } from "./tokenflux-model-compat.js";

const {
  currentProviderDefinition,
  tokenfluxAccountModelAvailability,
  tokenfluxModelIDForProvider,
} = currentProviderRuntime;

const relayKey = process.env.MILKSU_RELAY_KEY;
const relayUrl = process.env.MILKSU_RELAY_URL || "https://tokenflux.dev/v1";
const relayEnabled = process.env.MILKSU_RELAY_ENABLED === "1" && Boolean(relayKey);
const configuredModelSourceOrder = normalizeModelSourceOrder(
  process.env.MILKSU_MODEL_SOURCE_ORDER,
);
const modelSourceFallbackEnabled = process.env.MILKSU_MODEL_SOURCE_FALLBACK === "1";

const sessions = new Map();
const sessionPolicies = new Map();
const sessionPolicyControllers = new Map();
const backgroundTaskControllers = new Map();
const promptQueues = new Map();
const compactionRuns = new Map();
const compactionRequestIds = new Map();
const autoCompactionDeadlines = new Map();
const suppressedQueueUpdates = new Set();
const sessionTurnContracts = new Map();
const reasoningOnlyRecovered = new Map();
const reasoningOnlyPreviousTools = new Map();
// Set while a turn runs when its prompt was a cross-conversation delivery, so the tool guard
// can require the user's own approval instead of trusting the policy's auto modes.
const sessionExternalTurns = new Map();
const sessionModelSources = new Map();
const sessionConfiguredProviders = new Map();
const abortedSessions = new Set();
const sessionSubagentTasks = new Map();
const sessionCreateCommands = new Map();
function ignorePipeError(stream, label) {
  stream?.on("error", error => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`MilkSU sidecar ${label} error: ${message}\n`);
  });
}

ignorePipeError(process.stdin, "stdin");
ignorePipeError(process.stdout, "stdout");
const input = createInterface({ input: process.stdin });
input.on("error", error => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`MilkSU sidecar input error: ${message}\n`);
});
let commandQueue = Promise.resolve();
let steeringCommandQueue = Promise.resolve();
const bridgeDirectory = dirname(fileURLToPath(import.meta.url));
const sidecarResourceDirectory = existsSync(join(bridgeDirectory, "skills"))
  ? bridgeDirectory
  : resolve(bridgeDirectory, "..", "..");
const approvalRequiredCodingTools = new Set(["bash", "edit", "write"]);
// Streaming deltas are coalesced into ~60ms batches: one desktop event per batch instead
// of one per token, for both answer text and thinking. Every event goes through one writer
// that flushes the pending batch first, so a tool call can never overtake (or drop) the
// paragraph that came before it.
function writeEngineEvent(conversationId, type, data) {
  process.stdout.write(`${JSON.stringify({ type, id: conversationId ?? null, ...data })}\n`);
}

const streamDeltas = createStreamDeltaCoalescer({
  onFlush: batches => {
    for (const { type, id, delta } of batches) {
      writeEngineEvent(id, type, { delta });
    }
  },
});

const emit = createDeltaAwareWriter({ coalescer: streamDeltas, write: writeEngineEvent });

/**
 * The delivery tool must report what the host confirmed - never a bare "handed over".
 * A queued delivery names the conversation it waits behind, so the caller knows the wait
 * is real work in progress and not a lost message.
 */
function formatDeliveryOutcome(outcome, target) {
  const status = String(outcome?.status ?? "").trim();
  const detail = String(outcome?.detail ?? "").trim();
  if (status === "queued") {
    const behind = detail ? ` behind ${detail}` : " behind another running conversation";
    return `Queued: MilkSU accepted the message for ${target}, but another conversation in`
      + ` the same workspace is running, so it waits${behind} and starts by itself when`
      + " that turn ends.";
  }
  if (status === "delivered") {
    return `Delivered: MilkSU accepted the message for ${target} and dispatched it.`;
  }
  if (status === "refused") {
    return `Refused: MilkSU did not deliver the message to ${target}:`
      + ` ${detail || "no reason given"}.`;
  }
  return `Unconfirmed: MilkSU received the request for ${target} but did not report the`
    + " outcome before the wait timed out. It may still be queued; the outcome is also"
    + " written to this conversation.";
}

function applyWorkerModelOverride(worker) {
  const provider = String(worker?.provider ?? "").trim();
  const model = String(worker?.model ?? "").trim();
  if (!provider || !model) {
    delete process.env.MILKSU_WORKER_MODEL;
    delete process.env.MILKSU_WORKER_THINKING;
    return;
  }
  const source = String(worker?.source ?? "").trim();
  const spec = source === "account" ? `milksu-route/${model}` : `${provider}/${model}`;
  const thinking = worker?.thinking && typeof worker.thinking === "object"
    ? worker.thinking
    : {};
  const level = thinking.enabled && String(thinking.level ?? "").trim()
    ? String(thinking.level).trim()
    : "";
  process.env.MILKSU_WORKER_MODEL = spec;
  if (/^(off|minimal|low|medium|high|xhigh|max)$/.test(level)) {
    process.env.MILKSU_WORKER_THINKING = level;
  } else {
    delete process.env.MILKSU_WORKER_THINKING;
  }
}

function billedPromptTokensFor(conversationId) {
  const stored = sessionContextUsage.get(conversationId);
  return Math.max(0, Number(stored?.inputTokens ?? 0))
    + Math.max(0, Number(stored?.cacheReadTokens ?? 0));
}

function emitContextComposition(conversationId) {
  const id = String(conversationId ?? "").trim();
  if (!id) return;
  const session = sessions.get(id);
  if (!session) return;
  try {
    const stored = sessionContextUsage.get(id);
    const composition = projectSessionContextComposition(session, {
      billedPromptTokens: billedPromptTokensFor(id),
      contextWindow: session.model?.contextWindow ?? stored?.contextWindow,
    });
    if (!composition) return;
    emit(id, "context_composition", { contextComposition: composition });
  } catch (error) {
    console.error("MilkSU could not project context composition", error);
  }
}

function emitBackgroundTasks(conversationId) {
  try {
    emit(conversationId, "background_tasks", {
      tasks: projectedBackgroundTasks(conversationId),
    });
  } catch (error) {
    console.error("MilkSU could not read Pi background task state", error);
    emit(conversationId, "background_tasks", {
      tasks: [],
      error: describeError(error),
    });
  }
}

function projectedBackgroundTasks(conversationId) {
  return projectBackgroundTaskMetas(
    backgroundTaskMetasForSession(
      listPiBackgroundTaskMetas(),
      conversationId,
    ),
    Date.now(),
    readPiBackgroundTaskLog,
  );
}

function createReviewedBackgroundTasksExtension(conversationId) {
  return (pi) => {
    backgroundTaskControllers.set(conversationId, pi);
    registerBackgroundWakeNotifier(pi, (payload) => {
      const tasks = Array.isArray(payload?.tasks)
        ? payload.tasks.map(task => ({
          id: String(task?.id ?? ""),
          name: String(task?.name ?? ""),
          status: String(task?.status ?? ""),
          endedAt: Number(task?.endedAt ?? 0),
        })).filter(task => task.id)
        : [];
      if (!tasks.length) return;
      emit(conversationId, "background.wake", { tasks, wakeAt: Number(payload?.at ?? Date.now()) });
    });
    pi.on("session_shutdown", () => {
      if (backgroundTaskControllers.get(conversationId) === pi) {
        backgroundTaskControllers.delete(conversationId);
      }
      unregisterBackgroundWakeNotifier(pi);
    });
    piBackgroundTasksExtension(pi);
  };
}

function emitSubagentTasks(conversationId, tasks) {
  const next = Array.isArray(tasks) ? tasks : [];
  if (next.length) sessionSubagentTasks.set(conversationId, next);
  else sessionSubagentTasks.delete(conversationId);
  emit(conversationId, "subagent_tasks", {
    subagentTasks: next.map(task => ({
      id: task.id,
      role: task.role,
      status: task.status,
      toolCallId: task.toolCallId,
      durationMs: task.durationMs,
      exitCode: task.exitCode,
      yield: task.yield,
    })),
  });
}

function emitGoalState(conversationId, session) {
  const goal = projectSessionGoal(session?.sessionManager);
  emit(conversationId, "goal_state", {
    goal,
  });
  return goal;
}

const approvalBroker = createApprovalBroker(emit);

// The protected roots an agent may never write to. Resolved once: one sidecar serves one
// workspace, and the host's list is fixed for its lifetime.
let protectedRootsCache;
function sessionProtectedRoots(workspace) {
  if (!protectedRootsCache) {
    protectedRootsCache = mergeProtectedRoots(
      parseProtectedRoots(process.env[PROTECTED_ROOTS_ENV]),
      derivedProtectedRoots({
        workspace,
        userHome: process.env.MILKSU_USER_HOME,
        dataDirectory: dataDirectoryFromEnvironment(process.env),
      }),
    );
  }
  return protectedRootsCache;
}

function protectedViolationFor(event, workspace) {
  const roots = sessionProtectedRoots(workspace);
  if (event.toolName === "bash") {
    return protectedCommandViolation(event.input?.command, {
      roots,
      ownWorkspace: workspace,
      // The shell runs in the session's own workspace, so a relative write target resolves
      // against it - exactly where the shell would put the file.
      cwd: workspace,
    });
  }
  if (event.toolName === "edit" || event.toolName === "write") {
    const target = typeof event.input?.path === "string" ? event.input.path : "";
    return protectedWriteViolation(target, { roots, ownWorkspace: workspace });
  }
  return null;
}

function protectedAlarmNotice(violation, locale) {
  const label = violation?.label ?? "protected";
  return String(locale ?? "") === "en"
    ? `Blocked: the agent tried to write a protected path (rule: ${label}). The turn was stopped and the attempt was logged.`
    : `已拦截：Agent 试图写入受保护路径（命中规则：${label}）。本轮已停止，并已记入审计。`;
}
// Settles the delivery tool's own request/response round trip with the host.
const deliveryBroker = createDeliveryBroker(emit);
const workspaceActionBroker = createWorkspaceActionBroker(emit);
const pendingWorkspaceCompaction = new Set();
const sessionContextUsage = new Map();
const backgroundEffectfulActions = new Set(["spawn", "watch", "stop", "clear"]);

function backgroundToolAction(toolName, input) {
  if (toolName !== "bg_task" && toolName !== "bg_status") return "";
  return String(input?.action ?? "").trim();
}

function backgroundToolRequiresApproval(toolName, input) {
  return backgroundEffectfulActions.has(backgroundToolAction(toolName, input));
}

function describeError(error) {
  if (!(error instanceof Error)) return String(error);
  const resource = error.resource ? `\nresource: ${error.resource}` : "";
  return `${error.stack || error.message}${resource}`;
}

function extractToolResultContent(result) {
  if (typeof result === "string") return result;
  if (!Array.isArray(result?.content)) return "";
  return result.content
    .filter((item) => item.type === "text")
    .map((item) => item.text)
    .join("\n");
}

function isComputerUseMcpResult(event) {
  if (event?.toolName !== "mcp") return false;
  const inputServer = String(event.input?.server ?? event.input?.connect ?? "").trim();
  const inputTool = String(event.input?.tool ?? "").trim();
  const detailServer = String(event.details?.server ?? "").trim();
  const detailTool = String(event.details?.tool ?? "").trim();
  return (inputServer === "milksu-computer-use" || detailServer === "milksu-computer-use")
    && (isComputerUseMcpToolName(inputTool) || isComputerUseMcpToolName(detailTool));
}

async function summarizeComputerUseToolImages(event, session) {
  if (!isComputerUseMcpResult(event)) return undefined;
  // Screenshots stay image blocks. The current model or provider decides
  // whether it can read them; MilkSU does not OCR because a catalog said
  // the model is text-only.
  void session;
  return undefined;
}

function truncate(value, limit = 60000) {
  if (value.length <= limit) return value;
  return `${value.slice(0, limit)}\n\n…output truncated by MilkSU`;
}

function createMilkSUWorkflowExtension(sessionRole, getPolicy, getSession, conversationId) {
  return (pi) => {
    let latestPlan = [];
    pi.registerTool({
      name: codingAskToolName,
      label: "MilkSU ask",
      description: "Show a tappable choice card with 2-6 options. Use when asking a multiple-choice question or when the user asks you to present options. Wait for the selected option; do not write the choices as a numbered or bulleted list.",
      parameters: Type.Object({
        question: Type.String({ minLength: 1, maxLength: 200 }),
        options: Type.Array(Type.Object({
          id: Type.Optional(Type.String({ minLength: 1, maxLength: 32 })),
          label: Type.String({ minLength: 1, maxLength: 80 }),
          detail: Type.Optional(Type.String({ minLength: 1, maxLength: 160 })),
        }), { minItems: 2, maxItems: 6 }),
      }),
      async execute(_toolCallId, params) {
        const options = normalizeAskOptions(params.options);
        const question = String(params.question ?? "").trim();
        if (!question) throw new Error("milksu_ask needs a question");
        if (options.length < 2) throw new Error("milksu_ask needs at least two options");
        const picked = await approvalBroker.requestChoice({
          conversationId,
          question,
          options,
        });
        if (!picked) {
          return {
            content: [{ type: "text", text: formatAskSelection(null) }],
          };
        }
        return {
          content: [{
            type: "text",
            text: formatAskSelection(picked),
          }],
          details: { question, selected: picked },
        };
      },
    });
    pi.registerTool({
      name: "request_destructive_delete",
      label: "MilkSU destructive delete",
      description: "Ask the user before deleting something recursively. Fill in purpose (why this deletion is needed) and safety (what it is and whether it can be restored). A recursive delete that does not go through this tool is refused, so use it whenever you need to remove a tree.",
      parameters: Type.Object({
        path: Type.String({ minLength: 1, maxLength: 4096 }),
        purpose: Type.String({ minLength: 1, maxLength: 2000 }),
        safety: Type.String({ minLength: 1, maxLength: 2000 }),
      }),
      async execute(_toolCallId, params) {
        const target = String(params.path ?? "").trim();
        const purpose = String(params.purpose ?? "").trim();
        const safety = String(params.safety ?? "").trim();
        if (!target || !purpose || !safety) {
          throw new Error("path, purpose and safety are all required");
        }
        const policy = await loadSessionPolicy(process.cwd(), "", {});
        const decision = await destructiveDeleteDecision({
          toolName: "bash",
          input: { command: `rm -rf ${JSON.stringify(target)}` },
          policy,
        });
        if (decision?.action === "block") {
          emit(conversationId, "destructive.blocked", { notice: decision.reason });
          throw new Error(decision.reason);
        }
        const approved = await approvalBroker.request({
          conversationId,
          toolName: "destructive-delete",
          content: decision?.content ?? target,
          input: truncate(decision?.input ?? target, 16000),
          justification: { purpose, safety },
        });
        if (!approved) {
          return { content: [{ type: "text", text: "MilkSU user denied this deletion." }] };
        }
        await rm(target, { recursive: true, force: true });
        return {
          content: [{ type: "text", text: `Deleted ${target}` }],
          details: { path: target, purpose, safety },
        };
      },
    });
    pi.registerTool({
      name: "deliver_to_conversation",
      label: "MilkSU cross-conversation delivery",
      description: "Hand a message to another conversation. Use it to let a sibling task know something instead of asking the user to copy it over. The target receives it in its own schedule; the user is not moved to that conversation. MilkSU stamps the message with its real source conversation and agent, so do not describe where it came from in the text. Use kind=\"result\" when you are answering a request another conversation sent you; a result reply needs no allow list entry of your own if that conversation granted replies.",
      parameters: Type.Object({
        targetConversationId: Type.String({ minLength: 1, maxLength: 128 }),
        text: Type.String({ minLength: 1, maxLength: 4000 }),
        kind: Type.Optional(Type.Union([
          Type.Literal("request"),
          Type.Literal("result"),
        ])),
      }),
      async execute(_toolCallId, params) {
        const target = String(params.targetConversationId ?? "").trim();
        const body = String(params.text ?? "").trim();
        const kind = params.kind === "result" ? "result" : "request";
        if (!target || !body) throw new Error("targetConversationId and text are required");
        if (target === conversationId) throw new Error("a conversation cannot deliver to itself");
        // The host owns the verdict: it alone knows the project boundary, the rate limit
        // and whether the target is queued behind a running sibling. Wait for it instead
        // of claiming success up front. The source id is the only provenance sent: the
        // host resolves the title and agent from the conversation record.
        const outcome = await deliveryBroker.request({
          conversationId,
          targetConversationId: target,
          text: body,
          kind,
          origin: { conversationId: conversationId ?? "" },
        });
        return {
          content: [{
            type: "text",
            text: formatDeliveryOutcome(outcome, target),
          }],
          details: {
            targetConversationId: target,
            status: outcome.status || "unknown",
            ...(outcome.detail ? { queuedBehind: outcome.detail } : {}),
          },
        };
      },
    });
    pi.registerTool({
      name: "request_destructive_delete",
      label: "MilkSU destructive delete",
      description: "Ask the user before deleting something recursively. Fill in purpose (why this deletion is needed) and safety (what it is and whether it can be restored). A recursive delete that does not go through this tool is refused, so use it whenever you need to remove a tree.",
      parameters: Type.Object({
        path: Type.String({ minLength: 1, maxLength: 4096 }),
        purpose: Type.String({ minLength: 1, maxLength: 2000 }),
        safety: Type.String({ minLength: 1, maxLength: 2000 }),
      }),
      async execute(_toolCallId, params) {
        const target = String(params.path ?? "").trim();
        const purpose = String(params.purpose ?? "").trim();
        const safety = String(params.safety ?? "").trim();
        if (!target || !purpose || !safety) {
          throw new Error("path, purpose and safety are all required");
        }
        const policy = await loadSessionPolicy(process.cwd(), "", {});
        const decision = await destructiveDeleteDecision({
          toolName: "bash",
          input: { command: `rm -rf ${JSON.stringify(target)}` },
          policy,
        });
        if (decision?.action === "block") {
          emit(conversationId, "destructive.blocked", { notice: decision.reason });
          throw new Error(decision.reason);
        }
        // The card judges a *delete*, so the approval always carries the delete in the shape
        // the guard uses (see destructiveDeleteApproval).
        const approval = destructiveDeleteApproval({
          target,
          decision,
          chinese: policy?.uiLocale !== "en",
        });
        const approved = await approvalBroker.request({
          conversationId,
          toolName: "destructive-delete",
          content: approval.content,
          input: truncate(approval.input, 16000),
          justification: { purpose, safety },
        });
        if (!approved) {
          return { content: [{ type: "text", text: "MilkSU user denied this deletion." }] };
        }
        await rm(target, { recursive: true, force: true });
        return {
          content: [{ type: "text", text: `Deleted ${target}` }],
          details: { path: target, purpose, safety },
        };
      },
    });
    pi.registerTool({
      name: "milksu_progress",
      label: "MilkSU progress",
      description: "Publish or update a short execution plan (summary + up to 8 steps) when the task has more than one concrete step. Skip one-shot replies. Keep the in-progress step updated.",
      parameters: Type.Object({
        summary: Type.String({ minLength: 1, maxLength: 240 }),
        steps: Type.Array(Type.Object({
          text: Type.String({ minLength: 1, maxLength: 180 }),
          status: Type.Union([
            Type.Literal("pending"),
            Type.Literal("in_progress"),
            Type.Literal("completed"),
          ]),
        }), { minItems: 1, maxItems: 8 }),
      }),
      async execute(_toolCallId, params) {
        const inProgress = params.steps.filter((step) => step.status === "in_progress").length;
        if (inProgress > 1) {
          throw new Error("MilkSU progress accepts at most one in-progress step");
        }
        latestPlan = params.steps.map((step) => ({ ...step }));
        return {
          content: [{
            type: "text",
            text: `${params.summary}\n${latestPlan.map((step) => (
              `[${step.status === "completed" ? "x" : step.status === "in_progress" ? ">" : " "}] ${step.text}`
            )).join("\n")}`,
          }],
          details: {
            summary: params.summary,
            steps: latestPlan,
          },
        };
      },
    });

    pi.on("before_agent_start", async (event) => {
      const policy = getPolicy?.();
      return {
        systemPrompt: composeMilkSUWorkflowSystemPrompt(event.systemPrompt, {
          sessionRole,
          policy,
        }),
      };
    });
  };
}

function createCodingPermissionExtension(
  conversationId,
  getPolicy,
  getTurnContract,
  registerController,
  getExternalTurn = () => false,
) {
  return (pi) => {
    const repeatGuard = createToolRepeatGuard();
    registerController({
      setActiveTools: names => pi.setActiveTools(names),
    });
    pi.on("before_agent_start", () => {
      repeatGuard.reset();
    });
    pi.on("context", async (event) => {
      const filtered = filterCodingTurnContractMessages(
        event.messages,
        getTurnContract(),
      );
      // The reader sees text blocks, not thinking. When the model's last step called a tool with
      // no visible text, it gets a reminder injected into its own context before the next
      // request - request-scoped and not displayed. Nothing is blocked: beta.15 tried blocking
      // the call and the step then reached the reader with no text at all, which is the very
      // defect this contract exists to prevent.
      const messages = withVisibleProgressReminder(filtered) ?? filtered;
      if (
        messages.length === event.messages.length
        && messages.every((message, index) => message === event.messages[index])
      ) {
        return undefined;
      }
      return { messages };
    });

    pi.on("tool_call", async (event) => {
      const policy = getPolicy();
      if (!policy) return undefined;
      // A turn triggered by another conversation may not inherit auto-approval or a grant
      // the user gave for their own work: every dangerous tool has to come back to them.
      const externalTurn = getExternalTurn() === true;
      const externalApprovalNotice = () => (
        policy.uiLocale === "en"
          ? "This request came from another conversation, not from you. Confirm you want it run:\n\n"
          : "这条请求来自另一个会话（跨会话消息），不是用户本人的操作。请确认你本人要执行：\n\n"
      );
      // A write to a protected path is never an approval question: it stops the turn, tells
      // the reader, and leaves an audit line. The session is marked aborted so nothing queued
      // runs after it.
      const protectedViolation = protectedViolationFor(event, policy.workspace);
      if (protectedViolation) {
        const reason = `MilkSU blocked a write to a protected path (${protectedViolation.label}): `
          + protectedViolation.path;
        emit(conversationId, "guard.alarm", {
          toolName: event.toolName,
          reason,
          notice: protectedAlarmNotice(protectedViolation, policy.uiLocale),
        });
        abortedSessions.add(conversationId);
        return { block: true, terminate: true, reason };
      }
      if (codingTurnContractBlocksTool(getTurnContract())) {
        return {
          block: true,
          reason: "MilkSU blocked Agent tools for this explicitly no-tools turn",
        };
      }
      if (!policy.activeTools.includes(event.toolName)) {
        return {
          block: true,
          reason: `MilkSU Coding policy blocked ${event.toolName}: `
          + `${policy.executionMode}/${policy.approvalPolicy}`,
        };
      }
      let destructiveDeleteApproved = false;
      const deleteDecision = await destructiveDeleteDecision({
        toolName: event.toolName,
        input: event.input,
        policy,
      });
      if (deleteDecision?.action === "block") {
        // A blocked deletion is a decision the reader must be able to see: the guard never
        // asks, so without this notice the command simply appears to do nothing.
        emit(conversationId, "destructive.blocked", { notice: deleteDecision.reason });
        return {
          block: true,
          reason: deleteDecision.reason,
        };
      }
      if (deleteDecision?.action === "approval") {
        // A recursive delete must carry the requester's own purpose and safety note;
        // without it the card would only ever say "not provided". A background task
        // cannot show a card at all, so both cases fail closed.
        const justification = destructiveJustification(event.input);
        if (event.toolName === "bg_task" || !justification.ok) {
          const blockReason = event.toolName === "bg_task"
            ? "MilkSU refused this deletion: a background task cannot be approved "
              + "interactively. Run it in the foreground so it can be reviewed."
            : justification.reason;
          emit(conversationId, "destructive.blocked", { notice: blockReason });
          return {
            block: true,
            reason: blockReason,
          };
        }
        const approved = await approvalBroker.request({
          conversationId,
          toolName: "destructive-delete",
          content: externalTurn
            ? `${externalApprovalNotice()}${deleteDecision.content}`
            : deleteDecision.content,
          input: truncate(deleteDecision.input, 16000),
          justification: {
            purpose: justification.purpose,
            safety: justification.safety,
          },
        });
        if (!approved) {
          return {
            block: true,
            reason: "MilkSU user denied broad recursive deletion",
          };
        }
        destructiveDeleteApproved = true;
        // The approval is spent here: it authorises exactly this command against exactly
        // these targets in this conversation, once. Re-running it needs a new review.
        const approvedCommand = commandForTool(event.toolName, event.input);
        issueDestructiveDeleteCredential({
          command: approvedCommand,
          conversationId,
          targets: recursiveDeleteTargets(approvedCommand),
        });
      }
      if (event.toolName === "mcp") {
        const serverName = selectedMcpServer(policy, event.input);
        const browserBlockReason = codingBrowserToolBlockReason(
          event.input,
          serverName,
        );
        const evidenceBlockReason = codingBrowserEvidenceFileBlockReason(
          event.input,
          serverName,
          serverName === browserUseMcpServerName
            ? policy.browserUse?.sessionId
            : policy.codingBrowser?.sessionId,
        );
        if (browserBlockReason || evidenceBlockReason) {
          return {
            block: true,
            reason: browserBlockReason || evidenceBlockReason,
          };
        }
      }
      const imageGenDecision = await authorizeImageGenToolCall({
        conversationId,
        event,
        approvalBroker,
      });
      if (imageGenDecision) return imageGenDecision;
      if (event.toolName === codingCollaborationToolName) {
        try {
          validateSubagentInput(
            event.input,
            policy.codingCollaboration,
            policy.workspace,
          );
        } catch (error) {
          return {
            block: true,
            reason: error instanceof Error ? error.message : String(error),
          };
        }
        if (codingCollaborationRequiresApproval(policy.approvalPolicy) || externalTurn) {
          const approved = await approvalBroker.request({
            conversationId,
            toolName: codingCollaborationToolName,
            content: externalTurn
              ? `${externalApprovalNotice()}${formatSubagentApproval(
                event.input,
                policy.codingCollaboration,
                policy.workspace,
              )}`
              : formatSubagentApproval(
                event.input,
                policy.codingCollaboration,
                policy.workspace,
              ),
            input: truncate(JSON.stringify(event.input ?? {}, null, 2), 16000),
            // No grant reuse on an external turn: the user must answer each time.
            ...(externalTurn ? {} : { grantKey: codingCollaborationToolName }),
          });
          if (!approved) {
            return {
              block: true,
              reason: "MilkSU user denied subagent delegation",
            };
          }
        }
      }
      const backgroundEffect = backgroundToolRequiresApproval(event.toolName, event.input);
      if (
        backgroundEffect
        && (
          policy.executionMode !== "go"
          || policy.approvalPolicy === "read-only"
        )
      ) {
        return {
          block: true,
          reason: `MilkSU Coding policy blocked ${event.toolName}/${backgroundToolAction(
            event.toolName,
            event.input,
          )}: ${policy.executionMode}/${policy.approvalPolicy}`,
        };
      }
      // A turn started by another conversation used to force every bash/edit/write through the
      // user. That made dispatch-driven work unusable: a single cross-conversation delivery
      // produced dozens of approval prompts for ordinary in-workspace work. The protections
      // that matter are kept without the blanket rule - a write to a protected path still stops
      // the turn, a recursive delete still asks, no grant is ever reused on an external turn,
      // and any card that does appear says the request came from another conversation.
      if (
        policy.approvalPolicy === "ask"
        && !destructiveDeleteApproved
        && (
          approvalRequiredCodingTools.has(event.toolName)
          || backgroundEffect
        )
      ) {
        const approved = await approvalBroker.request({
          conversationId,
          toolName: event.toolName,
          content: externalTurn
            ? `${externalApprovalNotice()}${formatToolInput(event.toolName, event.input)}`
            : formatToolInput(event.toolName, event.input),
          input: truncate(JSON.stringify(event.input ?? {}, null, 2), 16000),
          // No grant reuse or remembering on an external turn.
          ...(externalTurn ? {} : { grantKey: event.toolName }),
        });
        if (!approved) {
          return {
            block: true,
            reason: `MilkSU user denied ${event.toolName}`,
          };
        }
      }
      if (
        event.toolName === "mcp"
        && (
          externalTurn
          || codingMcpOperationRequiresApproval(
            event.input,
            policy.approvalPolicy,
            selectedMcpServer(policy, event.input),
          )
        )
      ) {
        const serverName = selectedMcpServer(policy, event.input);
        const approved = await approvalBroker.request({
          conversationId,
          toolName: `mcp:${serverName}`,
          content: externalTurn
            ? `${externalApprovalNotice()}${formatMcpApprovalInput(event.input, serverName)}`
            : formatMcpApprovalInput(event.input, serverName),
          input: truncate(JSON.stringify(event.input ?? {}, null, 2), 16000),
          ...(externalTurn ? {} : { grantKey: mcpConversationGrantKey(event.input, serverName) }),
        });
        if (!approved) {
          return {
            block: true,
            reason: `MilkSU user denied MCP server ${serverName}`,
          };
        }
      }
      const repeat = repeatGuard.inspect(event.toolName, event.input);
      if (repeat?.ask) {
        const approved = await approvalBroker.request({
          conversationId,
          toolName: toolBudgetToolName,
          content: toolBudgetPrompt(repeat.count),
          input: String(repeat.count),
        });
        if (!approved) {
          return {
            block: true,
            terminate: true,
            reason: "本轮已停止。",
          };
        }
        return undefined;
      }
      if (repeat) return repeat;
      return undefined;
    });

    pi.on("before_agent_start", async (event) => {
      const turnGuidance = codingTurnContractGuidance(getTurnContract());
      if (!turnGuidance) return undefined;
      const result = {
        systemPrompt: `${event.systemPrompt}`
          + `\n\nMilkSU per-turn contract:\n${turnGuidance}`,
      };
      if (turnGuidance) {
        result.message = {
          customType: codingTurnContractMessageType,
          content: codingTurnContractContext(getTurnContract()),
          display: false,
          details: {
            scope: "current-turn",
            reason: getTurnContract()?.reason,
          },
        };
      }
      return result;
    });
  };
}

function createComputerUseVisionResultExtension(getSession) {
  return (pi) => {
    pi.on("tool_result", async (event) => {
      const session = getSession();
      if (!session) return undefined;
      try {
        return await summarizeComputerUseToolImages(event, session);
      } catch (error) {
        if (!isComputerUseMcpResult(event) || !Array.isArray(event.content)) {
          return undefined;
        }
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [
            ...event.content,
            {
              type: "text",
              text: "\n\n[MilkSU Computer Use visual evidence]\n"
                + `local OCR unavailable: ${message}`,
            },
          ],
        };
      }
    });
  };
}

function selectedMcpServer(policy, input) {
  return resolveCodingMcpServer(input, policy) || "已选择的 MCP 服务器";
}

function formatMcpApprovalInput(input, serverName) {
  const browserApproval = formatCodingBrowserApprovalInput(input, serverName);
  if (browserApproval) return browserApproval;
  const tool = String(input?.tool ?? "").trim();
  const action = String(input?.action ?? input?.connect ?? "").trim();
  return [
    `服务器 ${serverName}`,
    tool ? `工具 ${tool}` : "",
    action ? `操作 ${action}` : "",
  ].filter(Boolean).join(" · ");
}

function formatToolInput(toolName, args) {
  if (!args || typeof args !== "object") return "";
  if (toolName === "ctf_request_endpoint") {
    const protocol = String(args.protocol ?? "").trim().toLowerCase();
    let endpoint = "";
    if (["http", "https"].includes(protocol)) {
      try {
        endpoint = new URL(String(args.endpoint ?? "")).origin;
      } catch {
        endpoint = "[invalid endpoint omitted]";
      }
    } else {
      const candidate = String(args.endpoint ?? "").trim();
      try {
        const parsed = new URL(`tcp://${candidate}`);
        const port = Number(parsed.port);
        endpoint = parsed.hostname
          && Number.isInteger(port)
          && port >= 1
          && port <= 65535
          && parsed.username === ""
          && parsed.password === ""
          && parsed.pathname === ""
          && parsed.search === ""
          && parsed.hash === ""
          ? `${parsed.hostname}:${port}`
          : "[invalid endpoint omitted]";
      } catch {
        endpoint = "[invalid endpoint omitted]";
      }
    }
    return [protocol, endpoint].filter(Boolean).join(" · ");
  }
  if (toolName === "bash" && typeof args.command === "string") {
    return `$ ${args.command}`;
  }
  if (toolName === codingImageGenToolName) {
    const mode = args.mode === "edit" ? "编辑图片" : "生成图片";
    return [
      mode,
      args.outputPath,
      args.size || "1024x1024",
      args.quality || "low",
    ].map(value => String(value ?? "").trim()).filter(Boolean).join(" · ");
  }
  if (toolName === "bg_task") {
    const action = String(args.action ?? "").trim();
    const name = String(args.name ?? "").trim();
    const command = typeof args.command === "string"
      ? args.command
      : Array.isArray(args.argv)
        ? args.argv.join(" ")
        : "";
    return [action, name, command].filter(Boolean).join(" · ");
  }
  if (toolName === "bg_status") {
    return [args.action, args.id].map(value => String(value ?? "").trim())
      .filter(Boolean)
      .join(" · ");
  }
  if (toolName === codingWorkspaceToolName) {
    return formatCodingWorkspaceInput(args);
  }
  if (toolName === codingAskToolName) {
    const question = String(args.question ?? "").trim();
    const options = normalizeAskOptions(args.options);
    return formatAskToolInput(question, options);
  }
  if (toolName === codingCollaborationToolName) {
    return formatSubagentToolInput(args);
  }
  if (toolName === "milksu_progress") {
    // Same checklist shape as the tool result so the UI can project a live plan
    // before the call settles.
    const summary = String(args.summary ?? "").trim();
    const steps = Array.isArray(args.steps) ? args.steps : [];
    const lines = steps.map((step) => {
      const status = step?.status === "completed"
        ? "x"
        : step?.status === "in_progress"
          ? ">"
          : " ";
      const text = String(step?.text ?? "").trim();
      return text ? `[${status}] ${text}` : "";
    }).filter(Boolean);
    return [summary, ...lines].filter(Boolean).join("\n");
  }
  const path = typeof args.path === "string" ? args.path : "";
  if (toolName === "read") {
    const range = [
      Number.isInteger(args.offset) ? `offset=${args.offset}` : "",
      Number.isInteger(args.limit) ? `limit=${args.limit}` : "",
    ].filter(Boolean).join(" ");
    return [path, range].filter(Boolean).join(" · ");
  }
  if (["edit", "write"].includes(toolName) && path) {
    if (toolName === "write" && typeof args.content === "string") {
      const lines = args.content.length ? args.content.split("\n").length : 0;
      return lines ? `${path} +${lines}` : path;
    }
    if (toolName === "edit" && Array.isArray(args.edits)) {
      let add = 0;
      let del = 0;
      for (const edit of args.edits) {
        const oldText = String(edit?.oldText ?? "");
        const newText = String(edit?.newText ?? "");
        if (oldText) del += oldText.split("\n").length;
        if (newText) add += newText.split("\n").length;
      }
      if (add || del) return `${path} +${add} -${del}`;
    }
    return path;
  }
  if (toolName === "grep" && typeof args.pattern === "string") {
    return `${args.pattern}${path ? ` · ${path}` : ""}`;
  }
  if (["find", "ls"].includes(toolName) && path) return path;
  return truncate(JSON.stringify(args, null, 2), 4000);
}

function registerAccountModel(session, provider, model, thinking) {
  const accountModelID = tokenfluxModelIDForProvider(provider, model);
  const availability = tokenfluxAccountModelAvailability(accountModelID);
  if (availability.authoritative && !availability.model) {
    return { id: accountModelID, model: undefined, unavailable: true };
  }
  const accountDefinition = currentProviderDefinition("tokenflux", accountModelID, {
    TOKENFLUX_API_KEY: relayKey,
    TOKENFLUX_BASE_URL: relayUrl,
    MILKSU_MODEL_CATALOG_PATH: process.env.MILKSU_MODEL_CATALOG_PATH,
  });
  const source = accountDefinition?.models?.find(item => item.id === accountModelID);
  // Account keys may be single-model or composite; rewrite the request model id
  // only after TokenFlux rejects the catalog shape.
  session.modelRuntime.registerProvider("milksu-account", withTokenFluxModelCompat({
    name: "MilkSU 账户分配模型",
    baseUrl: relayUrl,
    apiKey: relayKey,
    api: "openai-completions",
    models: [withModelThinkingProfile({
      ...source,
      id: accountModelID,
      name: source?.name ?? accountModelID,
      reasoning: source?.reasoning ?? false,
      input: source?.input ?? ["text"],
      cost: source?.cost ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: registeredContextWindow(
        accountModelID,
        source?.contextWindow,
        contextWindowOverride("tokenflux", accountModelID),
      ),
      maxTokens: registeredMaxTokens(accountModelID, source?.maxTokens),
    }, thinking)],
  }));
  return {
    id: accountModelID,
    model: session.modelRuntime.getModel("milksu-account", accountModelID),
    unavailable: false,
  };
}

function normalizeCommandModelSourceOrder(value) {
  const source = Array.isArray(value) ? value : configuredModelSourceOrder;
  return [...new Set(source.filter(id => id === "account" || id === "personal"))];
}

function configureRuntimeModel(
  session,
  provider,
  model,
  conversationId,
  sourceOrder,
  thinking,
) {
  sessionConfiguredProviders.set(conversationId, String(provider ?? "").trim());
  const definition = currentProviderDefinition(provider, model);
  if (definition) {
    // Personal TokenFlux keys may be single-model (bare id) or composite
    // (prefix/model). Official providers keep their native ids unchanged.
    session.modelRuntime.registerProvider(
      provider,
      withProviderThinkingProfile(
        provider === "tokenflux" ? withTokenFluxModelCompat(definition) : definition,
        model,
        thinking,
      ),
    );
  }
  const personalModel = session.modelRuntime.getModel(provider, model);
  const account = relayEnabled
    ? registerAccountModel(session, provider, model, thinking)
    : { id: "", model: undefined, unavailable: false };
  const available = new Map([
    ["account", account.model],
    ["personal", personalModel && session.modelRuntime.hasConfiguredAuth(provider)
      ? personalModel
      : undefined],
  ]);
  const requestedOrder = normalizeCommandModelSourceOrder(sourceOrder);
  const sources = requestedOrder.flatMap(id => {
    const sourceModel = available.get(id);
    return sourceModel ? [{ id, model: sourceModel }] : [];
  });
  if (sources.length === 0) {
    if (account.unavailable && requestedOrder.includes("account")) {
      throw new Error(
        `账户分配模型不支持 ${account.id}，且没有可用的个人 API Key`,
      );
    }
    sessionModelSources.set(conversationId, "personal");
    return { provider, model };
  }
  if (sources.length === 1) {
    sessionModelSources.set(conversationId, sources[0].id);
    if (
      account.unavailable
      && requestedOrder[0] === "account"
      && sources[0].id === "personal"
    ) {
      emit(conversationId, "model_source_fallback", {
        from: "account", to: "personal", reason: "model",
      });
    }
    emit(conversationId, "model_source_selected", { source: sources[0].id });
    return { provider: sources[0].model.provider, model: sources[0].model.id };
  }

  const source = personalModel ?? account.model;
  session.modelRuntime.registerProvider("milksu-route", createModelSourceRouteProvider({
    source,
    model,
    sources,
    autoFallback: modelSourceFallbackEnabled,
    openSource: (selected, context, options) => session.modelRuntime.streamSimple(
      selected.model,
      context,
      options,
    ),
    onSource: selected => {
      sessionModelSources.set(conversationId, selected);
      emit(conversationId, "model_source_selected", { source: selected });
    },
    onFallback: fallback => emit(conversationId, "model_source_fallback", fallback),
  }));
  return { provider: "milksu-route", model };
}

async function setSessionModel(conversationId, session, provider, model, thinking) {
  if (!provider || !model) return;

  const desired = session.modelRuntime.getModel(provider, model);
  if (!desired) {
    throw new Error(`Model not found: ${provider}/${model}`);
  }
  await session.setModel(desired);
  const profile = normalizeThinkingProfile(thinking);
  session.setThinkingLevel(profile.enabled ? profile.level : "off");
  emit(conversationId, "model_selected", { provider, model });
  emit(conversationId, "thinking_level_selected", {
    enabled: profile.enabled,
    levels: profile.levels,
    level: session.thinkingLevel,
  });
}

function subscribeSession(
  conversationId,
  session,
  maxToolEventOutputBytes,
  usageModule,
) {
  let assistantTextStreamed = false;
  let thinkingStreamed = false;
  const thinkingStartedAt = new Map();
  const toolStartedAt = new Map();

  session.subscribe((event) => {
    if (
      event.type === "compaction_start"
      || event.type === "compaction_end"
    ) {
      const requestId = event.reason === "manual"
        ? compactionRequestIds.get(conversationId)
        : undefined;
      if (event.type === "compaction_start" && event.reason !== "manual") {
        armAutoCompactionDeadline(autoCompactionDeadlines, conversationId, () => {
          try {
            session.abortCompaction?.();
          } catch {
            // Pi may have settled between the deadline and this cancellation.
          }
        });
      } else {
        clearAutoCompactionDeadline(autoCompactionDeadlines, conversationId);
      }
      const projected = projectCompactionEvent(event, requestId);
      if (event.type === "compaction_end" && requestId) {
        compactionRequestIds.delete(conversationId);
      }
      if (
        event.type === "compaction_end"
        && !event.aborted
        && event.result
      ) {
        recordSessionContextUsage(conversationId, {
          inputTokens: Number(event.result.estimatedTokensAfter ?? 0),
          cacheReadTokens: 0,
        }, session.model?.contextWindow);
      }
      if (projected) {
        emit(conversationId, projected.type, projected.data);
      }
      emitContextComposition(conversationId);
      return;
    }

    if (event.type === "agent_start") {
      emit(conversationId, "turn_started");
      return;
    }

    if (event.type === "entry_appended") {
      if (
        event.entry?.type === "custom"
        && event.entry.customType === "goal-state"
      ) {
        emitGoalState(conversationId, session);
      }
      return;
    }

    if (event.type === "agent_settled") {
      const goal = emitGoalState(conversationId, session);
      if (!goalKeepsSessionRunning(goal)) {
        emit(conversationId, "turn_settled");
      }
      return;
    }

    if (event.type === "queue_update") {
      if (suppressedQueueUpdates.has(conversationId)) return;
      emit(conversationId, "queue_update", projectSteeringQueue(event));
      return;
    }

    if (event.type === "message_update" && event.assistantMessageEvent) {
      const update = event.assistantMessageEvent;
      if (update.type === "thinking_start") {
        thinkingStreamed = true;
        if (!thinkingStartedAt.has(conversationId)) {
          thinkingStartedAt.set(conversationId, Date.now());
        }
        emit(conversationId, "thinking_start", {});
      } else if (update.type === "thinking_delta") {
        thinkingStreamed = true;
        streamDeltas.queue("thinking_delta", conversationId, update.delta);
      } else if (update.type === "thinking_end") {
        thinkingStreamed = true;
        const startedAt = thinkingStartedAt.get(conversationId);
        thinkingStartedAt.delete(conversationId);
        emit(conversationId, "thinking_done", {
          content: update.content ?? "",
          durationMs: startedAt === undefined ? undefined : Math.max(0, Date.now() - startedAt),
        });
      } else if (update.type === "text_delta") {
        assistantTextStreamed = true;
        streamDeltas.queue("text_delta", conversationId, update.delta);
      }
      return;
    }

    if (event.type === "message_end" && event.message?.role === "assistant") {
      for (const projected of projectAssistantMessageEnd(event.message, {
        textStreamed: assistantTextStreamed,
        thinkingStreamed,
      })) {
        emit(conversationId, projected.type, projected.data);
      }
      const usage = projectAssistantUsage(event.message, {
        conversationId,
        module: usageModule,
        provider: sessionConfiguredProviders.get(conversationId),
        source: sessionModelSources.get(conversationId),
      });
      if (usage) {
        recordSessionContextUsage(conversationId, usage, session.model?.contextWindow);
        emit(conversationId, "usage_recorded", { usage, module: usageModule });
        emitContextComposition(conversationId);
      }
      assistantTextStreamed = false;
      thinkingStreamed = false;
      thinkingStartedAt.delete(conversationId);
      return;
    }

    if (event.type === "tool_execution_start") {
      toolStartedAt.set(event.toolCallId, Date.now());
      if (event.toolName === codingCollaborationToolName) {
        const policy = sessionPolicies.get(conversationId);
        emitSubagentTasks(conversationId, [
          ...(sessionSubagentTasks.get(conversationId) ?? []),
          ...projectSubagentRosterStart(event.args, {
            toolCallId: event.toolCallId,
            workspace: policy?.workspace,
            worktrees: policy?.codingCollaboration?.worktrees,
          }),
        ]);
      }
      emit(conversationId, "tool_call_start", {
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        content: formatToolInput(event.toolName, event.args),
        module: usageModule,
      });
      return;
    }

    if (event.type === "tool_execution_update") {
      // Progress is an activity heartbeat only. Child tool output stays inside Pi
      // and is emitted once, through the bounded tool_execution_end projection.
      emit(conversationId, "tool_call_progress", {
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        module: usageModule,
      });
      return;
    }

    if (event.type === "tool_execution_end") {
      const startedAt = toolStartedAt.get(event.toolCallId);
      toolStartedAt.delete(event.toolCallId);
      if (event.toolName === "bg_task" || event.toolName === "bg_status") {
        emitBackgroundTasks(conversationId);
      }
      if (event.toolName === codingCollaborationToolName) {
        const policy = sessionPolicies.get(conversationId);
        const current = sessionSubagentTasks.get(conversationId) ?? [];
        const owned = current.filter(task => task.toolCallId === event.toolCallId);
        const others = current.filter(task => task.toolCallId !== event.toolCallId);
        const wrapped = projectSubagentToolResult({
          ...event.result,
          toolName: event.toolName,
          input: event.args ?? event.input,
          details: event.result?.details,
          content: event.result?.content,
        }, {
          workspace: policy?.workspace,
          collaboration: policy?.codingCollaboration,
          worktrees: policy?.codingCollaboration?.worktrees,
        });
        emitSubagentTasks(conversationId, [
          ...others,
          ...projectSubagentRosterEnd(owned, wrapped, {
            toolCallId: event.toolCallId,
            durationMs: startedAt === undefined
              ? undefined
              : Math.max(0, Date.now() - startedAt),
            isError: event.isError,
          }),
        ]);
      }
      for (const usage of projectToolModelUsage(event.result, {
        conversationId,
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        module: usageModule,
        provider: sessionConfiguredProviders.get(conversationId),
        source: sessionModelSources.get(conversationId),
      })) {
        emit(conversationId, "usage_recorded", { usage, module: usageModule });
        emitContextComposition(conversationId);
      }
      emit(conversationId, "tool_call_end", {
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        content: truncate(extractToolResultContent(event.result), maxToolEventOutputBytes),
        durationMs: startedAt === undefined
          ? undefined
          : Math.max(0, Date.now() - startedAt),
        isError: event.isError,
        module: usageModule,
      });
    }
  });
}

async function createSessionManager(cwd, agentDir, conversationId) {
  const sessionDir = join(agentDir, "sessions");
  const existing = (await SessionManager.list(cwd, sessionDir))
    .find((value) => value.id === conversationId);
  if (existing) {
    return SessionManager.open(existing.path, sessionDir, cwd);
  }
  return SessionManager.create(cwd, sessionDir, { id: conversationId });
}

async function loadProjectInstructions(cwd) {
  try {
    const content = await readFile(join(cwd, "AGENTS.md"), "utf8");
    return `Project instructions from ${join(cwd, "AGENTS.md")}:\n\n${truncate(content, 64000)}`;
  } catch (error) {
    if (error?.code === "ENOENT") return undefined;
    throw error;
  }
}

function createMilkSUResourceLoader(
  cwd,
  agentDir,
  systemPrompt,
  sessionRole,
  codingSkillPaths,
  conversationId,
  getPolicy,
  registerPolicyController,
  mcpConfig,
  securityTools,
  getSession,
) {
  // Skills and extensions may execute instructions supplied by third parties.
  // Keep Pi's ambient discovery disabled and load only MilkSU-reviewed resources.
  const extensionFactories = [
    createMilkSUWorkflowExtension(sessionRole, getPolicy, getSession, conversationId),
    createReasoningOnlyRecoveryExtension({
      isAborted: () => abortedSessions.has(conversationId),
      wasRecovered: () => reasoningOnlyRecovered.get(conversationId) === true,
      markRecovered: () => reasoningOnlyRecovered.set(conversationId, true),
      applyNoTools: () => {
        const session = sessions.get(conversationId);
        const tools = typeof session?.getActiveToolNames === "function"
          ? session.getActiveToolNames()
          : [];
        reasoningOnlyPreviousTools.set(conversationId, tools);
        sessionTurnContracts.set(conversationId, {
          toolAccess: "none",
          reason: "text_projection",
        });
        sessionPolicyControllers.get(conversationId)?.setActiveTools([]);
      },
      restoreTools: () => {
        const previous = reasoningOnlyPreviousTools.get(conversationId);
        sessionTurnContracts.delete(conversationId);
        if (previous) {
          sessionPolicyControllers.get(conversationId)?.setActiveTools(previous);
        }
        reasoningOnlyPreviousTools.delete(conversationId);
      },
    }),
  ];
  if (sessionRole) {
    extensionFactories.push(createCTFTruncationContinuationExtension(sessionRole));
  }
  extensionFactories.push(
      piGoalExtension,
      createReviewedBackgroundTasksExtension(conversationId),
      piWebResearchExtension,
      createCodingPermissionExtension(
        conversationId,
        getPolicy,
        () => sessionTurnContracts.get(conversationId),
        registerPolicyController,
        () => sessionExternalTurns.get(conversationId) === true,
      ),
      createReviewedLspExtension(
        piLspExtension,
        {
          conversationId,
          getPolicy,
          approvalBroker,
        },
      ),
      createComputerUseVisionResultExtension(getSession),
      createSecurityToolsExtension(cwd, securityTools),
      createCodingWorkspaceExtension(
        conversationId,
        getPolicy,
        request => workspaceActionBroker.request(request),
        id => queueWorkspaceCompaction(pendingWorkspaceCompaction, id),
        id => ({
          usage: sessionContextUsage.get(id),
          contextWindow: sessions.get(id)?.model?.contextWindow
            ?? sessionContextUsage.get(id)?.contextWindow,
        }),
      ),
      createEnvExtension(
        conversationId,
        sessionRole,
        getPolicy,
        request => workspaceActionBroker.request(request),
      ),
      createComputerUseDriverExtension(
        conversationId,
        getPolicy,
        request => workspaceActionBroker.request(request),
      ),
      createComputerUseToolExtension(getPolicy),
      piSubAgentExtension,
      createSubagentYieldExtension(() => {
        const policy = getPolicy?.();
        return {
          workspace: policy?.workspace || cwd,
          collaboration: policy?.codingCollaboration,
          worktrees: policy?.codingCollaboration?.worktrees,
        };
      }),
  );
  if (mcpConfig) {
    extensionFactories.push(createMcpAdapter({ config: mcpConfig }));
  }
  // Bash safety: default timeout for every bash call, plus a preflight that refuses
  // bulk scans inside iCloud-evicted directories (files present only in the cloud).
  extensionFactories.push(createHangGuardExtension());
  // Last: Pi tool_result middleware. Every tool, including MCP, is clipped to
  // Pi's 50KB/2000-line contract before the result enters model context.
  extensionFactories.push(createToolResultBoundExtension());
  return new DefaultResourceLoader({
    cwd,
    agentDir,
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    systemPrompt,
    additionalSkillPaths: codingSkillPaths,
    extensionFactories,
  });
}

function reviewedCodingResourceRoots(
  sessionRole = "",
  disabledSkills = [],
  extraSkillPaths = [],
) {
  void sessionRole;
  const attachmentRoot = process.env.MILKSU_CODING_ATTACHMENT_ROOT;
  return [
    ...resolveCodingSkillPaths(
      sidecarResourceDirectory,
      sessionRole,
      disabledSkills,
      extraSkillPaths,
    ),
    attachmentRoot,
  ].filter((path) => path && existsSync(path));
}

function requestedBrowserUseDescriptor(command) {
  if (
    command.executionMode !== "go"
    || command.approvalPolicy === "read-only"
    || !Array.isArray(command.mcpServers)
    || !command.mcpServers.includes(browserUseMcpServerName)
  ) return undefined;
  const conversationId = String(command.conversationId ?? "").trim();
  if (!/^[A-Za-z0-9-]{8,120}$/u.test(conversationId)) {
    throw new Error("MilkSU rejected Browser Use for an invalid conversation id");
  }
  return { sessionId: `browser_user-${conversationId}` };
}

async function loadRuntimeSessionPolicy(cwd, command) {
  const productAction = normalizeCodingProductAction(cwd, command.productAction);
  if (command.productAction !== undefined && !productAction) {
    throw new Error("MilkSU rejected an invalid typed Coding product action");
  }
  const codingCollaboration = normalizeCodingCollaboration(
    command.codingCollaboration,
    command.conversationId,
    cwd,
  );
  const browserUse = requestedBrowserUseDescriptor(command);
  const securityTools = await normalizeSecurityTools(command.securityTools);
  const extraSkillPaths = Array.isArray(command.userSkillPaths)
    ? command.userSkillPaths
    : [];
  const selectedMcp = await loadCodingMcpConfig(
    cwd,
    command.mcpServers,
    command.mcpConfigDigest,
    command.codingBrowser,
    command.computerUse,
    browserUse,
    securityTools,
    command.userMcpServers,
    command.recoveryPurpose !== "background-tasks",
    {
      conversationId: command.conversationId,
      reserveCodingBrowser: command.executionMode === "go"
        && command.approvalPolicy !== "read-only"
        && command.recoveryPurpose !== "background-tasks",
    },
  );
  let policy = await loadSessionPolicy(cwd, command.sessionRole, {
    executionMode: command.executionMode,
    approvalPolicy: command.approvalPolicy,
    productAction,
    mcpServers: selectedMcp.selected,
    projectMcpServers: selectedMcp.projectSelected,
    mcpConfigDigest: command.mcpConfigDigest,
    codingBrowser: selectedMcp.codingBrowser,
    computerUse: selectedMcp.computerUse,
    browserUse: selectedMcp.browserUse,
    codingCollaboration,
    imageGenConfigured: Boolean(String(process.env.OPENAI_API_KEY ?? "").trim()),
  });
  const effectiveSessionRole = resolveWorkflowSessionRole(
    command.sessionRole,
    policy.ctf,
  );
  const disabledSkills = Array.isArray(command.disabledSkills)
    ? command.disabledSkills
    : [];
  const codingSkillPaths = resolveCodingSkillPaths(
    sidecarResourceDirectory,
    effectiveSessionRole,
    disabledSkills,
    extraSkillPaths,
  );
  const codingResourceRoots = reviewedCodingResourceRoots(
    effectiveSessionRole,
    disabledSkills,
    extraSkillPaths,
  );
  if (codingResourceRoots.length) {
    policy = await loadSessionPolicy(cwd, command.sessionRole, {
      executionMode: command.executionMode,
      approvalPolicy: command.approvalPolicy,
      productAction,
      mcpServers: selectedMcp.selected,
      projectMcpServers: selectedMcp.projectSelected,
      mcpConfigDigest: command.mcpConfigDigest,
      codingBrowser: selectedMcp.codingBrowser,
      computerUse: selectedMcp.computerUse,
      browserUse: selectedMcp.browserUse,
      codingCollaboration,
      imageGenConfigured: Boolean(String(process.env.OPENAI_API_KEY ?? "").trim()),
      readOnlyResourceRoots: codingResourceRoots,
    });
  }
  policy.skillNames = codingSkillPaths.map(path => basename(path));
  policy.userMcpServers = command.userMcpServers && typeof command.userMcpServers === "object"
    ? command.userMcpServers
    : {};
  policy.securityTools = securityTools;
  if (securityTools.some(tool => tool.id === "capa")) {
    if (!policy.activeTools.includes("capa_analyze")) {
      policy.activeTools.push("capa_analyze");
    }
  }
  policy.uiLocale = command.locale === "en" ? "en" : "zh";
  return {
    policy,
    effectiveSessionRole,
    codingSkillPaths,
    mcpConfig: selectedMcp.config,
    securityTools,
  };
}

function configureSubagentRuntime(cwd, collaboration) {
  const launcher = join(bridgeDirectory, "pi-subagent-launcher.sh");
  const runner = join(bridgeDirectory, "pi-subagent-runner.cjs");
  const packagedCLI = join(bridgeDirectory, "pi-subagent-cli.cjs");
  const developmentCLI = join(
    sidecarResourceDirectory,
    "node_modules",
    "@earendil-works",
    "pi-coding-agent",
    "dist",
    "cli.js",
  );
  const packagedAgents = join(bridgeDirectory, "subagents", "agents");
  const developmentAgents = join(
    sidecarResourceDirectory,
    "node_modules",
    "pi-sub-agent",
    "extensions",
    "agents",
  );
  const cli = existsSync(packagedCLI) ? packagedCLI : developmentCLI;
  const agents = existsSync(packagedAgents) ? packagedAgents : developmentAgents;
  for (const [label, path] of [
    ["launcher", launcher],
    ["runner", runner],
    ["Pi CLI", cli],
    ["agent prompts", agents],
  ]) {
    if (!existsSync(path)) {
      throw new Error(`MilkSU subagent ${label} is unavailable: ${path}`);
    }
  }
  process.env.MILKSU_PI_SUBAGENT_LAUNCHER = launcher;
  process.env.MILKSU_PI_SUBAGENT_RUNNER = runner;
  process.env.MILKSU_PI_SUBAGENT_CLI = cli;
  process.env.MILKSU_PI_SUBAGENT_AGENTS_DIR = agents;
  process.env.MILKSU_PI_SUBAGENT_BUNDLED_ONLY = "1";
}

async function createSession(command) {
  const conversationId = command.conversationId;
  if (!conversationId) throw new Error("conversationId is required");
  applyWorkerModelOverride(command.workerModel);

  const existing = sessions.get(conversationId);
  if (existing) {
    // Re-enable on every reuse. A persisted Pi settings file can leave
    // compaction off; Coding / CTF / CVE / lab sessions must never run without it.
    if (typeof existing.setAutoCompactionEnabled === "function") {
      existing.setAutoCompactionEnabled(true);
    }
    sessionCreateCommands.set(conversationId, command);
    return existing;
  }

  const cwd = process.cwd();
  const agentDir = process.env.MILKSU_PI_AGENT_DIR || join(cwd, ".milksu", "pi");
  const projectInstructions = await loadProjectInstructions(cwd);
  const {
    policy: sessionPolicy,
    effectiveSessionRole,
    codingSkillPaths,
    mcpConfig,
    securityTools,
  } = await loadRuntimeSessionPolicy(cwd, command);
  applyCodingResourcePolicy();
  configureSubagentRuntime(cwd, sessionPolicy.codingCollaboration);
  sessionPolicies.set(conversationId, sessionPolicy);
  if (mcpConfig) {
    await ensureMcpMetadataCache(agentDir);
  }
  let session;
  const resourceLoader = createMilkSUResourceLoader(
    cwd,
    agentDir,
    projectInstructions,
    effectiveSessionRole,
    codingSkillPaths,
    conversationId,
    () => sessionPolicies.get(conversationId),
    controller => sessionPolicyControllers.set(conversationId, controller),
    mcpConfig,
    securityTools,
    () => session,
  );
  // MilkSU performs its own explicit, reviewed resource loading. Mark the
  // project untrusted at Pi's package-manager layer so it does not walk parent
  // directories looking for ambient .agents/.pi resources.
  await resourceLoader.reload({
    resolveProjectTrust: async () => false,
  });

  try {
    ({ session } = await createAgentSession({
      cwd,
      agentDir,
      sessionManager: await createSessionManager(cwd, agentDir, conversationId),
      resourceLoader,
      tools: [...new Set([
        ...sessionPolicy.activeTools,
        codingCollaborationToolName,
        "computer_use",
        ...(sessionPolicy.mcpServers?.length || sessionPolicy.codingBrowser
          || sessionPolicy.computerUse || sessionPolicy.browserUse ? ["mcp"] : []),
        ...(sessionPolicy.securityTools?.some(tool => tool.id === "capa")
          ? ["capa_analyze"]
          : []),
      ])],
      customTools: sessionPolicy.customTools,
    }));
    // Pi's SDK constructs the extension runner but deliberately leaves
    // lifecycle binding to embedders. Without this call extension tools appear
    // available, while session_start handlers never run. Durable extensions
    // such as background tasks then cannot reconcile processes after a
    // Sidecar restart.
    await session.bindExtensions({ mode: "print" });
    // Pi owns auto-compaction. Never leave it off for Coding, CTF, CVE, or lab.
    if (typeof session.setAutoCompactionEnabled === "function") {
      session.setAutoCompactionEnabled(true);
    }
    const controller = sessionPolicyControllers.get(conversationId);
    if (!controller) {
      throw new Error("MilkSU Coding permission controller is unavailable");
    }
    controller.setActiveTools(sessionPolicy.activeTools);
    subscribeSession(
      conversationId,
      session,
      sessionPolicy.maxToolEventOutputBytes,
      sessionPolicy.ctf ? "ctf" : "coding",
    );

    const effectiveModel = configureRuntimeModel(
      session,
      command.provider,
      command.model,
      conversationId,
      command.modelSourceOrder,
      command.thinking,
    );
    await setSessionModel(
      conversationId,
      session,
      effectiveModel.provider,
      effectiveModel.model,
      command.thinking,
    );

    sessions.set(conversationId, session);
    sessionCreateCommands.set(conversationId, command);
    promptQueues.set(conversationId, Promise.resolve());
    const loadedExtensions = describeLoadedExtensions(resourceLoader);
    emit(conversationId, "ready", {
      workspace: cwd,
      tools: session.getActiveToolNames(),
      extensions: loadedExtensions.names,
      extensionErrors: loadedExtensions.errors,
      skills: resourceLoader.getSkills().skills.map((skill) => skill.name),
      executionMode: sessionPolicy.executionMode,
      approvalPolicy: sessionPolicy.approvalPolicy,
      capabilities: sessionPolicy.capabilities,
      resumed: session.messages.length > 0,
    });
    emitContextComposition(conversationId);
    emitBackgroundTasks(conversationId);
    emitGoalState(conversationId, session);
    return session;
  } catch (error) {
    await disposeAgentSession(session, "create_failed");
    sessionPolicies.delete(conversationId);
    sessionPolicyControllers.delete(conversationId);
    sessionModelSources.delete(conversationId);
    sessionConfiguredProviders.delete(conversationId);
    throw error;
  }
}

async function sendMessage(command) {
  const conversationId = command.conversationId;
  if (!conversationId) throw new Error("conversationId is required");
  applyWorkerModelOverride(command.workerModel);
  // abort_session is handled immediately, while send_message is queued.
  // A stop click right after Send can therefore arrive before createSession.
  if (dropSendAfterAbort(abortedSessions, sessions, conversationId)) {
    emit(conversationId, "turn_settled");
    return;
  }
  reasoningOnlyRecovered.delete(conversationId);

  let existing = sessions.get(conversationId);
  const previousPolicy = sessionPolicies.get(conversationId);
  const requestedFullAccess = command.approvalPolicy === "full-auto";
  const requestedProductAction = normalizeCodingProductAction(
    process.cwd(),
    command.productAction,
  );
  if (command.productAction !== undefined && !requestedProductAction) {
    throw new Error("MilkSU rejected an invalid typed Coding product action");
  }
  const previousProductAction = previousPolicy?.productAction;
  const productActionChanged = JSON.stringify(previousProductAction)
    !== JSON.stringify(requestedProductAction);
  const requestedMcpServers = command.mcpServers;
  const requestedProjectMcpServers = projectMcpServersFromSelection(requestedMcpServers);
  const requestedCodingBrowser = command.codingBrowser;
  const requestedComputerUse = command.computerUse;
  const requestedBrowserUse = requestedBrowserUseDescriptor(command);
  const requestedCodingCollaboration = command.codingCollaboration;
  if (
    existing
    && previousPolicy
    && (
      (previousPolicy.approvalPolicy === "full-auto") !== requestedFullAccess
      || productActionChanged
      || mcpSelectionChanged(previousPolicy.projectMcpServers, requestedProjectMcpServers)
      || userMcpSelectionChanged(previousPolicy.userMcpServers, command.userMcpServers)
      || pluginMcpSessionRequiresReload(
        previousPolicy.mcpServers,
        command.recoveryPurpose,
      )
      || String(previousPolicy.mcpConfigDigest ?? "")
        !== String(command.mcpConfigDigest ?? "")
      || codingBrowserSelectionChanged(
        previousPolicy.codingBrowser,
        requestedCodingBrowser,
      )
      || computerUseSelectionChanged(
        previousPolicy.computerUse,
        requestedComputerUse,
      )
      || browserUseSelectionChanged(
        previousPolicy.browserUse,
        requestedBrowserUse,
      )
      || previousPolicy.codingCollaborationToolScopeStale === true
      || codingCollaborationChanged(
        previousPolicy.codingCollaboration,
        requestedCodingCollaboration,
      )
      || securityToolSelectionChanged(
        previousPolicy.securityTools,
        command.securityTools,
      )
      || JSON.stringify(previousPolicy.skillNames ?? [])
        !== JSON.stringify(
          resolveCodingSkillPaths(
            sidecarResourceDirectory,
            "",
            command.disabledSkills,
            command.userSkillPaths,
          ).map(path => basename(path)),
        )
    )
  ) {
    await disposeAgentSession(existing, "reload");
    sessions.delete(conversationId);
    sessionPolicies.delete(conversationId);
    sessionPolicyControllers.delete(conversationId);
    sessionModelSources.delete(conversationId);
    sessionConfiguredProviders.delete(conversationId);
    existing = undefined;
  }
  const session = existing ?? await createSession(command);
  if (abortedSessions.delete(conversationId)) {
    try {
      await session.abort();
    } catch {
      // The desktop run clock still has to settle after a cancelled create.
    }
    emit(conversationId, "turn_settled");
    return;
  }
  if (existing) {
    if (typeof session.setAutoCompactionEnabled === "function") {
      session.setAutoCompactionEnabled(true);
    }
    const { policy: sessionPolicy } = await loadRuntimeSessionPolicy(process.cwd(), command);
    sessionPolicies.set(conversationId, sessionPolicy);
    const controller = sessionPolicyControllers.get(conversationId);
    if (!controller) {
      throw new Error("MilkSU Coding permission controller is unavailable");
    }
    controller.setActiveTools(sessionPolicy.activeTools);
    const effectiveModel = configureRuntimeModel(
      session,
      command.provider,
      command.model,
      conversationId,
      command.modelSourceOrder,
      command.thinking,
    );
    await setSessionModel(
      conversationId,
      session,
      effectiveModel.provider,
      effectiveModel.model,
      command.thinking,
    );
    emit(conversationId, "policy_updated", {
      tools: session.getActiveToolNames(),
      executionMode: sessionPolicy.executionMode,
      approvalPolicy: sessionPolicy.approvalPolicy,
      capabilities: sessionPolicy.capabilities,
    });
    emitContextComposition(conversationId);
  }

  const previous = promptQueues.get(conversationId) ?? Promise.resolve();
  const next = previous.then(async () => {
    if (abortedSessions.delete(conversationId)) {
      try {
        await session.abort();
      } catch {
        // Queued prompt was cancelled before session.prompt.
      }
      return;
    }
    // A manual compaction in flight for this conversation must finish before
    // the next prompt so Pi never runs a prompt against a session that is
    // mid-compaction. Compaction is bounded, so this wait cannot hang forever.
    await waitForCompaction(compactionRuns, conversationId);
    if (command.branchFromUserOccurrence !== undefined) {
      try {
        await session.abort();
      } catch {
        // Restarting from an earlier user message should not fail because the
        // previous turn was already idle.
      }
      await navigateFromUserMessage(session, Number(command.branchFromUserOccurrence));
    }
    await compactIfContextNearLimit(conversationId, session);
    const attachmentRoot = process.env.MILKSU_CODING_ATTACHMENT_ROOT;
    const prepared = await preparePromptAttachments(
      command.attachments,
      attachmentRoot,
    );
    const contract = normalizeCodingTurnContract(command.turnPolicy);
    const prompt = `${command.prompt ?? ""}${prepared.context}`;
    const controller = sessionPolicyControllers.get(conversationId);
    if (contract && !controller) {
      throw new Error("MilkSU Coding permission controller is unavailable");
    }
    // A turn driven by a cross-conversation delivery must not be able to auto-approve the
    // dangerous tools; the permission extension reads this while the turn runs.
    const externalTurn = isExternalMessagePrompt(prompt);
    // A turn that is alive keeps saying so; without this the UI could not tell a busy engine
    // from one that never picked the turn up, and it guessed "not responding".
    const stopHeartbeat = startTurnHeartbeat({ emit, conversationId });
    sessionExternalTurns.set(conversationId, externalTurn);
    try {
      await withCodingTurnContract({
        contracts: sessionTurnContracts,
        conversationId,
        contract,
        getActiveTools: () => session.getActiveToolNames(),
        setActiveTools: tools => {
          if (controller) controller.setActiveTools(tools);
        },
        onApplied: tools => emit(conversationId, "turn_policy", {
          tools,
          reason: contract?.reason,
        }),
        onRestored: tools => emit(conversationId, "turn_policy_cleared", {
          tools,
        }),
      }, () => session.prompt(
        prompt,
        prepared.images.length ? { images: prepared.images } : undefined,
      ));
    } finally {
      stopHeartbeat();
      sessionExternalTurns.delete(conversationId);
    }
    await compactIfContextNearLimit(conversationId, session);
  });
  promptQueues.set(conversationId, next.catch(() => undefined));
  try {
    await next;
  } catch (error) {
    if (abortedSessions.delete(conversationId)) return;
    throw error;
  }
}

// Drop every pending steering message Pi still holds for a conversation. A queue that
// was restored from disk must never be consumed as a fresh turn on its own.
async function clearQueuedMessages(command) {
  const conversationId = String(command?.conversationId ?? "").trim();
  if (!conversationId) throw new Error("conversationId is required");
  const session = sessions.get(conversationId);
  if (!session) return;
  try {
    session.clearQueue?.();
  } catch {
    // Older Pi builds may not expose clearQueue; the renderer keeps its own queue.
  }
  emit(conversationId, "queue_update", { steering: [], followUp: [] });
}

async function abortSession(command) {
  const conversationId = command.conversationId;
  if (!conversationId) throw new Error("conversationId is required");
  abortedSessions.add(conversationId);
  approvalBroker.cancelConversation(conversationId, "turn aborted");
  deliveryBroker.cancelConversation(conversationId);
  workspaceActionBroker.cancelConversation(conversationId, "turn aborted");
  pendingWorkspaceCompaction.delete(conversationId);
  const session = sessions.get(conversationId);
  if (!session) {
    emit(conversationId, "turn_settled");
    return;
  }
  // session.abort() only interrupts the agent loop. A compaction is a separate
  // Pi controller, so without this the stop button cannot end a compaction the
  // user is waiting on. Pi emits its own aborted compaction_end in response.
  clearAutoCompactionDeadline(autoCompactionDeadlines, conversationId);
  try {
    session.abortCompaction?.();
  } catch {
    // Nothing was compacting, or Pi already settled it.
  }
  await session.abort();
  // The turn was stopped deliberately: pi must not keep steering messages it could
  // later consume as a fresh turn. Leaving them queued is what made a stopped
  // conversation keep sending its queued messages on its own.
  try {
    session.clearQueue?.();
  } catch {
    // Older pi builds may not expose clearQueue; aborting is still the main path.
  }
  // Do not synthesize empty message_done (it became a blank assistant bubble).
  // If Pi already emitted agent_settled, a second turn_settled is harmless in
  // the UI (finishRun is idempotent). If abort raced past agent_settled, this
  // closes the desktop run clock without inventing assistant text.
  emit(conversationId, "turn_settled");
}

async function forkSessionCommand(command) {
  const conversationId = String(command.conversationId ?? "").trim();
  const requestId = String(command.requestId ?? "").trim();
  try {
    if (!conversationId) throw new Error("conversationId is required");
    if (!requestId) throw new Error("requestId is required");
    const session = sessions.get(conversationId) ?? await createSession(command);
    const forked = forkFromMessage(
      session,
      command.role === "assistant" ? "assistant" : "user",
      Number(command.occurrence ?? 0),
    );
    emit(conversationId, "session_forked", {
      requestId,
      forkedSessionId: forked.sessionId,
      path: forked.path,
    });
  } catch (error) {
    emit(conversationId || null, "session_forked", {
      requestId,
      error: describeError(error),
    });
  }
}

async function destroySession(command) {
  const conversationId = command.conversationId;
  if (!conversationId) throw new Error("conversationId is required");

  const session = sessions.get(conversationId);
  let sessionFile = session?.sessionFile;
  if (!sessionFile && command.deletePersisted) {
    const cwd = process.cwd();
    const agentDir = process.env.MILKSU_PI_AGENT_DIR || join(cwd, ".milksu", "pi");
    const sessionDir = join(agentDir, "sessions");
    const persisted = (await SessionManager.list(cwd, sessionDir))
      .find((value) => value.id === conversationId);
    sessionFile = persisted?.path;
  }
  const compactionRequestId = compactionRequestIds.get(conversationId);
  if (compactionRequestId) {
    emit(conversationId, "compaction_end", {
      requestId: compactionRequestId,
      reason: "manual",
      aborted: true,
      error: "Coding session was destroyed during context compaction",
    });
  }
  // Cancel manual and Pi-initiated compaction alike; either one holds an open
  // summarization request that disposal would otherwise wait on.
  try {
    session?.abortCompaction?.();
  } catch {
    // Disposal below still terminates the session.
  }
  const backgroundController = backgroundTaskControllers.get(conversationId) ?? {
    sendUserMessage: async () => undefined,
  };
  for (const task of backgroundTaskMetasForSession(
    listPiBackgroundTaskMetas(),
    conversationId,
  )) {
    if (task.status === "running") {
      stopPiBackgroundTask(backgroundController, task.id, () => undefined);
    }
  }
  approvalBroker.cancelConversation(conversationId, "session destroyed");
  approvalBroker.clearConversationGrants(conversationId);
  deliveryBroker.cancelConversation(conversationId);
  workspaceActionBroker.cancelConversation(conversationId, "session destroyed");
  pendingWorkspaceCompaction.delete(conversationId);
  sessionContextUsage.delete(conversationId);
  compactionRuns.delete(conversationId);
  compactionRequestIds.delete(conversationId);
  clearAutoCompactionDeadline(autoCompactionDeadlines, conversationId);
  sessionTurnContracts.delete(conversationId);
  reasoningOnlyRecovered.delete(conversationId);
  reasoningOnlyPreviousTools.delete(conversationId);
  sessionExternalTurns.delete(conversationId);
  await disposeAgentSession(session);
  sessions.delete(conversationId);
  sessionPolicies.delete(conversationId);
  sessionPolicyControllers.delete(conversationId);
  sessionModelSources.delete(conversationId);
  sessionConfiguredProviders.delete(conversationId);
  sessionSubagentTasks.delete(conversationId);
  backgroundTaskControllers.delete(conversationId);
  promptQueues.delete(conversationId);
  abortedSessions.delete(conversationId);
  sessionCreateCommands.delete(conversationId);
  if (command.deletePersisted && sessionFile) {
    try {
      await unlink(sessionFile);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
  emit(conversationId, "session_destroyed");
}

function respondToolApproval(command) {
  const conversationId = command.conversationId;
  const requestId = command.requestId;
  if (!conversationId) throw new Error("conversationId is required");
  if (!requestId) throw new Error("requestId is required");
  approvalBroker.respond({
    conversationId,
    requestId,
    approved: command.approved === true,
    scope: command.scope,
    choice: command.choice,
  });
}

/**
 * The host answers an outstanding deliver_to_conversation call. A late or unknown answer
 * is dropped: the tool already returned its own "unconfirmed" outcome.
 */
function respondAgentDelivery(command) {
  const conversationId = String(command.conversationId ?? "").trim();
  const requestId = String(command.requestId ?? "").trim();
  if (!conversationId) throw new Error("conversationId is required");
  if (!requestId) throw new Error("requestId is required");
  deliveryBroker.respond({
    conversationId,
    requestId,
    status: command.status,
    detail: command.detail,
  });
}

async function attachCodingBrowserDescriptor(command) {
  const conversationId = String(command.conversationId ?? "").trim();
  if (!conversationId || command.codingBrowser == null) return;
  const attached = await writeCodingBrowserDescriptor(
    conversationId,
    command.codingBrowser,
  );
  if (!attached) return;
  const policy = sessionPolicies.get(conversationId);
  if (!policy) return;
  policy.codingBrowser = attached.browser;
  if (!Array.isArray(policy.mcpServers)) policy.mcpServers = [];
  if (!policy.mcpServers.includes(codingBrowserMcpServerName)) {
    policy.mcpServers.push(codingBrowserMcpServerName);
  }
}

function respondWorkspaceAction(command) {
  const requestId = String(command.requestId ?? "").trim();
  if (!requestId) throw new Error("requestId is required");
  workspaceActionBroker.respond({
    requestId,
    ok: command.ok !== false,
    result: command.result,
    error: command.error,
  });
}

function terminalCommandName(value, command) {
  const explicit = String(value ?? "")
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .trim();
  if (explicit) return explicit.slice(0, 120);
  const firstLine = String(command ?? "").split(/\r?\n/, 1)[0].trim();
  return (firstLine || "终端命令").slice(0, 120);
}

function recordSessionContextUsage(conversationId, usage, contextWindow) {
  const id = String(conversationId ?? "").trim();
  if (!id) return;
  sessionContextUsage.set(id, {
    inputTokens: Number(usage?.inputTokens ?? 0),
    cacheReadTokens: Number(usage?.cacheReadTokens ?? 0),
    contextWindow: Number(contextWindow ?? usage?.contextWindow ?? 0),
  });
}

async function compactIfContextNearLimit(conversationId, session) {
  if (!session) return;
  if (typeof session.setAutoCompactionEnabled === "function") {
    session.setAutoCompactionEnabled(true);
  }
  if (session.isCompacting) return;
  const stored = sessionContextUsage.get(conversationId);
  const snapshot = contextUsageSnapshot(
    stored,
    session.model?.contextWindow || stored?.contextWindow,
  );
  const forced = pendingWorkspaceCompaction.has(conversationId);
  if (!snapshot.shouldCompact && !forced) return;
  pendingWorkspaceCompaction.delete(conversationId);
  try {
    const result = await compactSession(session);
    recordSessionContextUsage(conversationId, {
      inputTokens: Number(result?.estimatedTokensAfter ?? 0),
      cacheReadTokens: 0,
    }, session.model?.contextWindow || stored?.contextWindow);
    emitContextComposition(conversationId);
  } catch (error) {
    emit(conversationId, "compaction_end", {
      reason: "auto",
      aborted: /cancelled|timed out|aborted/i.test(describeError(error)),
      error: describeError(error),
    });
  }
}

async function rewindSessionCommand(command) {
  const conversationId = String(command.conversationId ?? "").trim();
  const requestId = String(command.requestId ?? "").trim();
  try {
    if (!conversationId) throw new Error("conversationId is required");
    if (!requestId) throw new Error("requestId is required");
    const session = sessions.get(conversationId);
    if (!session) {
      throw new Error(`Coding session not found: ${conversationId}`);
    }
    const result = await rewindLastExploration(session);
    emit(conversationId, "session_rewound", {
      requestId,
      keptEntryId: result.keptEntryId,
    });
  } catch (error) {
    emit(conversationId || null, "session_rewound", {
      requestId,
      error: describeError(error),
    });
  }
}

async function handoffSessionCommand(command) {
  const conversationId = String(command.conversationId ?? "").trim();
  const requestId = String(command.requestId ?? "").trim();
  try {
    if (!conversationId) throw new Error("conversationId is required");
    if (!requestId) throw new Error("requestId is required");
    const session = sessions.get(conversationId);
    if (!session) {
      throw new Error(`Coding session not found: ${conversationId}`);
    }
    const parentCommand = sessionCreateCommands.get(conversationId);
    if (!parentCommand) {
      throw new Error("Wait for the first assistant response before handing off");
    }
    const point = lastForkPoint(session);
    if (!point) {
      throw new Error("Nothing to hand off");
    }
    if (typeof session.abort === "function") {
      await session.abort();
    }
    const forked = forkFromMessage(session, point.role, point.occurrence);
    const forkedSession = await createSession({
      ...parentCommand,
      conversationId: forked.sessionId,
      requestId,
    });
    const compaction = await compactSession(forkedSession);
    emit(conversationId, "session_handoff", {
      requestId,
      forkedSessionId: forked.sessionId,
      compaction: {
        tokensBefore: compaction?.tokensBefore,
        estimatedTokensAfter: compaction?.estimatedTokensAfter,
        summary: compaction?.summary || "",
      },
    });
  } catch (error) {
    emit(conversationId || null, "session_handoff", {
      requestId,
      error: describeError(error),
    });
  }
}

async function compactSessionCommand(command) {
  const conversationId = String(command.conversationId ?? "").trim();
  const requestId = String(command.requestId ?? "").trim();
  try {
    if (!conversationId) throw new Error("conversationId is required");
    if (!requestId) throw new Error("requestId is required");
    if (compactionRuns.has(conversationId)) {
      throw new Error("Coding session is already compacting");
    }
    const session = sessions.get(conversationId);
    if (!session) {
      throw new Error(`Coding session not found: ${conversationId}`);
    }
    if (!sessionPolicies.get(conversationId)) {
      throw new Error(`Coding session is not ready: ${conversationId}`);
    }
    compactionRequestIds.set(conversationId, requestId);
    const run = (async () => {
      try {
        const result = await compactSession(session);
        recordSessionContextUsage(conversationId, {
          inputTokens: Number(result?.estimatedTokensAfter ?? 0),
          cacheReadTokens: 0,
        }, session.model?.contextWindow);
        emitContextComposition(conversationId);
      } catch (error) {
        // AgentSession.compact normally emits Pi's native compaction_end even
        // on failure. Keep a fallback only for wrapper validation/runtime
        // failures that happen before that native event.
        if (compactionRequestIds.get(conversationId) === requestId) {
          compactionRequestIds.delete(conversationId);
          const message = describeError(error);
          emit(conversationId, "compaction_end", {
            requestId,
            reason: "manual",
            aborted: /cancelled|timed out|aborted/i.test(message),
            error: message,
          });
        }
      } finally {
        if (compactionRequestIds.get(conversationId) === requestId) {
          compactionRequestIds.delete(conversationId);
        }
      }
    })();
    await trackCompaction(compactionRuns, conversationId, run);
  } catch (error) {
    // Validation failures that happen before a run exists still surface as an
    // explicit compaction_end so the Supervisor waiter never hangs.
    emit(conversationId || null, "compaction_end", {
      requestId,
      reason: "manual",
      aborted: false,
      error: describeError(error),
    });
  }
}

function currentSessionQueue(session) {
  if (!session) return { steering: [], followUp: [] };
  return projectSteeringQueue({
    steering: session.getSteeringMessages?.(),
    followUp: session.getFollowUpMessages?.(),
  });
}

async function removeQueuedMessageCommand(command) {
  const conversationId = String(command.conversationId ?? "").trim();
  const requestId = String(command.requestId ?? "").trim();
  try {
    if (!conversationId) throw new Error("conversationId is required");
    if (!requestId) throw new Error("requestId is required");
    suppressedQueueUpdates.add(conversationId);
    const queue = await removeQueuedMessage(sessions, command);
    suppressedQueueUpdates.delete(conversationId);
    emit(conversationId, "queued_message_removed", {
      requestId,
      ...projectSteeringQueue(queue),
    });
  } catch (error) {
    suppressedQueueUpdates.delete(conversationId);
    const queue = currentSessionQueue(sessions.get(conversationId));
    // A stale index can mean Pi already consumed a message. Re-project the
    // restored live queue so the renderer does not keep stale controls.
    if (conversationId && sessions.has(conversationId)) {
      emit(conversationId, "queue_update", queue);
    }
    emit(conversationId || null, "queued_message_removed", {
      requestId,
      ...queue,
      error: describeError(error),
    });
  }
}

async function controlBackgroundTask(command) {
  const conversationId = String(command.conversationId ?? "").trim();
  const requestId = String(command.requestId ?? "").trim();
  try {
    if (!conversationId) throw new Error("conversationId is required");
    if (!requestId) throw new Error("requestId is required");
    const control = String(command.control ?? "").trim();
    if (control === "list") {
      emit(conversationId, "background_task_controlled", {
        requestId,
        tasks: projectedBackgroundTasks(conversationId),
      });
      return;
    }
    if (control === "spawn") {
      const commandText = String(command.command ?? "").trim();
      if (!commandText) throw new Error("terminal command is required");
      if (commandText.includes("\u0000")) {
        throw new Error("terminal command contains an invalid null byte");
      }
      if (commandText.length > 16_000) {
        throw new Error("terminal command must be at most 16000 characters");
      }
      const policy = await loadSessionPolicy(process.cwd(), "", {
        executionMode: command.executionMode,
        approvalPolicy: command.approvalPolicy,
      });
      if (
        policy.executionMode !== "go"
        || policy.approvalPolicy === "read-only"
      ) {
        throw new Error(
          `MilkSU Coding policy blocked terminal command: `
          + `${policy.executionMode}/${policy.approvalPolicy}`,
        );
      }
      const input = {
        command: commandText,
        cwd: policy.workspace,
        shell: true,
        callback: false,
        name: terminalCommandName(command.name, commandText),
      };
      const pi = backgroundTaskControllers.get(conversationId) ?? {
        sendUserMessage: async () => undefined,
      };
      spawnPiBackgroundTask(
        pi,
        input,
        policy.workspace,
        { cwd: policy.workspace, sessionId: conversationId },
        () => ({ cwd: policy.workspace, sessionId: conversationId }),
      );
      emit(conversationId, "background_task_controlled", {
        requestId,
        tasks: projectedBackgroundTasks(conversationId),
      });
      return;
    }
    if (control !== "stop") {
      throw new Error(`unsupported background task control: ${control}`);
    }
    const taskId = String(command.taskId ?? "").trim();
    if (!/^bg_[a-z0-9_]+$/i.test(taskId)) {
      throw new Error("invalid background task id");
    }
    const metas = backgroundTaskMetasForSession(
      listPiBackgroundTaskMetas(),
      conversationId,
    );
    const meta = metas.find(task => task.id === taskId);
    if (!meta) throw new Error(`background task not found: ${taskId}`);
    const pi = backgroundTaskControllers.get(conversationId) ?? {
      sendUserMessage: async () => undefined,
    };
    stopPiBackgroundTask(pi, taskId, () => undefined);
    emit(conversationId, "background_task_controlled", {
      requestId,
      tasks: projectedBackgroundTasks(conversationId),
    });
  } catch (error) {
    emit(conversationId || null, "background_task_controlled", {
      requestId,
      error: describeError(error),
      tasks: projectedBackgroundTasks(conversationId),
    });
  }
}

async function handleCommand(command) {
  switch (command.action) {
    case "create_session":
      await createSession(command);
      break;
    case "send_message":
      await sendMessage(command);
      break;
    case "steer_message":
      await steerSession(sessions, command);
      break;
    case "remove_queued_message":
      await removeQueuedMessageCommand(command);
      break;
    case "clear_queued_messages":
      await clearQueuedMessages(command);
      break;
    case "abort_session":
      await abortSession(command);
      break;
    case "approval_response":
      respondToolApproval(command);
      break;
    case "delivery_response":
      respondAgentDelivery(command);
      break;
    case "workspace_action_response":
      respondWorkspaceAction(command);
      break;
    case "background_task_control":
      await controlBackgroundTask(command);
      break;
    case "compact_session":
      await compactSessionCommand(command);
      break;
    case "destroy_session":
      await destroySession(command);
      break;
    case "fork_session":
      await forkSessionCommand(command);
      break;
    case "rewind_session":
      await rewindSessionCommand(command);
      break;
    case "handoff_session":
      await handoffSessionCommand(command);
      break;
    default:
      throw new Error(`Unknown action: ${command.action}`);
  }
}

input.on("line", (line) => {
  if (!line.trim()) return;
  let command;
  try {
    command = JSON.parse(line);
  } catch (error) {
    emit(null, "error", { error: describeError(error) });
    return;
  }
  if (command.action === "abort_session") {
    void abortSession(command).catch((error) => {
      emit(command.conversationId ?? null, "error", { error: describeError(error) });
    });
    return;
  }
  if (command.action === "steer_message") {
    steeringCommandQueue = steeringCommandQueue
      .then(() => steerSession(sessions, command))
      .catch((error) => {
        emit(command.conversationId ?? null, "steer_rejected", {
          error: describeError(error),
        });
      });
    return;
  }
  if (command.action === "remove_queued_message") {
    steeringCommandQueue = steeringCommandQueue
      .then(() => removeQueuedMessageCommand(command))
      .catch((error) => {
        emit(command.conversationId ?? null, "queued_message_removed", {
          requestId: String(command.requestId ?? "").trim(),
          error: describeError(error),
        });
      });
    return;
  }
  if (command.action === "approval_response") {
    try {
      respondToolApproval(command);
    } catch (error) {
      emit(command.conversationId ?? null, "error", { error: describeError(error) });
    }
    return;
  }
  if (command.action === "workspace_action_response") {
    void attachCodingBrowserDescriptor(command)
      .catch((error) => {
        console.error("MilkSU could not attach Coding Browser MCP", error);
      })
      .finally(() => {
        try {
          respondWorkspaceAction(command);
        } catch (error) {
          emit(command.conversationId ?? null, "error", { error: describeError(error) });
        }
      });
    return;
  }
  if (command.action === "background_task_control") {
    if (sessions.has(command.conversationId)) {
      void controlBackgroundTask(command);
      return;
    }
  }
  if (command.action === "compact_session") {
    void compactSessionCommand(command);
    return;
  }
  if (command.action === "rewind_session") {
    void rewindSessionCommand(command);
    return;
  }
  if (command.action === "handoff_session") {
    void handoffSessionCommand(command);
    return;
  }
  commandQueue = commandQueue
    .then(() => handleCommand(command))
    .catch((error) => {
      console.error("MilkSU Pi Sidecar command failed", error);
      emit(command.conversationId ?? null, "error", { error: describeError(error) });
    });
});

async function disposeAllSessions() {
  approvalBroker.cancelAll("Sidecar stopped");
  compactionRuns.clear();
  compactionRequestIds.clear();
  suppressedQueueUpdates.clear();
  sessionTurnContracts.clear();
  reasoningOnlyRecovered.clear();
  reasoningOnlyPreviousTools.clear();
  sessionExternalTurns.clear();
  await Promise.all(
    [...sessions.values()].map(session => disposeAgentSession(session)),
  );
  sessions.clear();
  sessionCreateCommands.clear();
  backgroundTaskControllers.clear();
  promptQueues.clear();
  abortedSessions.clear();
}

let shutdownPromise;

function shutdown() {
  if (shutdownPromise) return shutdownPromise;
  shutdownPromise = disposeAllSessions()
    .catch(error => {
      console.error("MilkSU Pi Sidecar shutdown failed", error);
    })
    .finally(() => {
      input.close();
      process.exit(0);
    });
  return shutdownPromise;
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
