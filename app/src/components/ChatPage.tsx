import WindowFileDrop from '@/components/WindowFileDrop'
import {
  approvalBarIsDestructive as approvalBarIsDestructiveFor,
  approvalCanAllow as approvalCanAllowFrom,
  approvalSubmitAllowed,
  approvalTimeoutOutcome,
} from '@/lib/approvalBar'
import {
  forwardRef,
  lazy,
  Suspense,
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import {
  Badge,
  Button,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '@/components/ui'
import {
  Activity,
  ArrowLeft,
  ArrowRight,
  CircleDot,
  ExternalLink,
  FileDiff,
  FileImage,
  Flag,
  FolderOpen,
  GitBranch,
  Globe2,
  LoaderCircle,
  MousePointer2,
  Minimize2,
  PanelRightClose,
  PanelRightOpen,
  Plus,
  RefreshCw,
  RotateCcw,
  Route,
  SquareTerminal,
  Wrench,
  X,
} from 'lucide-react'
import { invokeCommand, listenEvent } from '@/desktop'
import { toastError } from '@/lib/appToast'
import { isAskMessage } from '@/lib/agentAsk'
import { chatNeedsAnotherFollowScroll, nextChatAutoScrollPinned } from '@/lib/chatAutoScroll'
import { assessApprovalRequest, effectiveProtectedFolders } from '@/lib/destructiveTarget'
import { isGeneratedScratchWorkspace } from '@/lib/codingConversationGroups'
import {
  computeTranscriptWindow,
  TRANSCRIPT_MOUNT_CAP,
  TRANSCRIPT_OLDER_CHUNK,
} from '@/lib/transcriptWindow'
import AgentPixelLoader from '@/components/AgentPixelLoader'
import AkLoadingMark from '@/components/AkLoadingMark'
import ChatActivityGroup from '@/components/ChatActivityGroup'
import ChatProcessFold from '@/components/ChatProcessFold'
import ChatComposer, { type ChatComposerHandle } from '@/components/ChatComposer'
import { BackgroundTaskStrip } from '@/components/BackgroundTaskStrip'
import AgentDecisionMark from '@/components/AgentDecisionMark'
import { ConversationQuoteMenu, selectedTextIn } from '@/components/ConversationQuoteMenu'
import WorkingTray from '@/components/WorkingTray'
import ChatMessageItem from '@/components/ChatMessageItem'
import CodingArtifactPreviewPanel, {
  type CodingArtifactPreviewPanelHandle,
} from '@/components/CodingArtifactPreviewPanel'
import CodingChangesPanel from '@/components/CodingChangesPanel'
import CodingComputerUsePanel from '@/components/CodingComputerUsePanel'
import CodingComputerUsePermissionDialog from '@/components/CodingComputerUsePermissionDialog'
import CodingMCPReviewCard from '@/components/CodingMCPReviewCard'
import { CrossConversationNotice } from '@/components/CrossConversationNotice'
import MarkdownContent from '@/components/MarkdownContent'
import ContextRail from '@/components/ContextRail'
import WorkspaceModuleTopBar from '@/components/WorkspaceModuleTopBar'
import type {
  CodingArtifactPreview,
  CodingBrowserStatus,
  CodingComputerUsePermission,
  CodingComputerUseStatus,
  CodingComputerUseTarget,
  CodingDiffSnapshot,
  CodingEnvironmentSnapshot,
  CodingGitActionResult,
  CodingMCPConfigSnapshot,
  CodingProjectMemory,
} from '@/codingEnvironmentTypes'
import { normalizeCodingBrowserAddress } from '@/codingBrowserAddress'
import {
  codingBrowserAddressFromStatus,
  codingBrowserViewportSyncKey,
} from '@/lib/codingBrowserTabs'
import { readCodingRailWidth, writeCodingRailWidth } from '@/lib/codingRailWidth'
import {
  clampCodingTerminalHeight,
  readCodingTerminalHeight,
  writeCodingTerminalHeight,
} from '@/lib/codingTerminalHeight'
import {
  codingWorkspaceLabel,
  isGenericWorkspaceLabel,
  LOCAL_CODING_SHELL_ID,
  shouldRememberCodingProject,
} from '@/lib/codingProjectMemory'
import { buildChatActivityEntries, buildChatTranscript, hasEmptyVisibleReply, type ChatTranscriptBlock, latestFinishedThinkingId } from '@/lib/chatActivity'
import { agentFileDiffChips, formatDemoElapsed } from '@/lib/agentConversation'
import { latestCodingPlan } from '@/lib/codingPlan'
import {
  chatActivityGroupOpen,
  chatActivityOpenEntryIds,
  createChatActivityExpansionState,
  pruneChatActivityExpansion,
  setChatActivityEntryOpen,
  setChatActivityGroupOpen,
  type ChatActivityExpansionState,
} from '@/lib/chatActivityExpansion'
import { chatTopbarPresentation } from '@/lib/chatTopbar'
import { modelContextWindowOverride, resolveModelContextWindow } from '@/lib/knownContextWindow'
import {
  effectiveModelThinkingLevel,
  resolveModelThinking,
} from '@/lib/modelThinking'
import {
  applySessionContextWindow,
  presentContextUsage,
  presentRunTiming,
  type SessionTurnSnapshot,
} from '@/lib/sessionTurnStatus'
import AgentChangeSummary from '@/components/AgentChangeSummary'
import AgentExecutionPlan from '@/components/AgentExecutionPlan'
import ContextUsageMeter from '@/components/ContextUsageMeter'
import {
  agentRecoveryPrompt,
  emptyVisibleReplyRecoveryPrompt,
  recoverableAgentFailureId,
} from '@/lib/agentRecovery'
import {
  codingProductAction,
  codingReviewPrompt,
  type CodingProductActionKind,
} from '@/lib/codingProductActions'
import { extractLatestComputerUseOperationEvidence } from '@/lib/codingComputerUseEvidence'
import { requestComputerUseReveal, takeComputerUseReveal } from '@/lib/computerUseHandoff'
import {
  computerUseTargetKey,
  computerUseStartArgs,
  describeActiveComputerUseCapability,
  describePendingComputerUseCapability,
  isEmulatorComputerUseTarget,
  nextComputerUseTargetKey,
  normalizeCodingApprovalPolicy,
  normalizeCodingExecutionMode,
  previewCodingCapabilities,
  selectedComputerUseTarget as resolveSelectedComputerUseTarget,
} from '@/lib/codingPolicy'
import { codingContinuityPresentation } from '@/lib/codingContinuityPresentation'
import { codingAskToolName, pendingAskMessage } from '@/lib/agentAsk'
import type {
  CTFAgentBudgetStatus,
  CTFAgentRunCheckpoint,
  CTFProjection,
  CTFToolWorkshopState,
} from '@/ctfTypes'
import type {
  AppSettings,
  CodingApprovalPolicy,
  CodingAttachment,
  CodingExecutionMode,
  CodingProductActionRequest,
  Conversation,
  CTFChatAction,
  ModelThinkingLevel,
} from '@/types'
import {
  lastRewindableUserMessageId,
  type CodingMessageQueue,
} from '@/composables/useConversations'
import { useConversations } from '@/stores/conversationsStore'
import { composerDraftKey } from '@/lib/composerDraftStore'
import { conversationWorkspaceHome } from '@/lib/workspaceSessionRouting'
import {
  liveWorkingItems,
  workingItemsForConversation,
  workingRootConversation,
} from '@/lib/workingRoster'
import {
  composerRunPhase,
  parentHasActiveTurnResidue,
} from '@/lib/composerRunState'
import {
  encodeComposerModelKey,
  modelServiceSourceLabel,
  parseComposerModelKey,
  providerModelLabel,
  useLiveModelCatalog,
} from '@/modelCatalog'
import { enabledCodingSkillNames } from '@/codingSkills'
import type { AgentResourceCatalog, AgentResourceSkill } from '@/agentResourceTypes'
import { useT } from '@/hooks/useUiLocale'
import { cn } from '@/lib/cn'

const CodingTerminalPanel = lazy(() => import('@/components/CodingTerminalPanel'))

const contextPanelValues = [
  'domain',
  'environment',
  'changes',
  'artifacts',
  'browser',
  'browser-use',
  'computer-use',
  'collaboration',
  'evidence',
] as const
type ContextPanel = typeof contextPanelValues[number]

const TRANSCRIPT_INITIAL_BLOCKS = 60
const TRANSCRIPT_REFILL_CHUNK = 150
const TRANSCRIPT_TOP_REFILL_CHUNK = 300

// 同屏最多摊开多少段（超出的收成一行「更早的 N 段」）。
// 实测：不设上限时，一个 3781 轮的对话会挂 224,550 个节点 ⇒ 输出/滚动时每秒 2~3 次 50ms 级长任务。
function transcriptMountLimit(total: number) {
  return Math.min(total, TRANSCRIPT_MOUNT_CAP)
}
const emptyActivityExpansion = createChatActivityExpansionState()

export type ChatPageProps = {
  className?: string
  conversation: Conversation | null
  settings: AppSettings | null
  workspacePath: string
  running: boolean
  aborting: boolean
  abortStalled?: boolean
  messageQueue?: CodingMessageQueue
  sessionReady: boolean
  resumed: boolean
  compacting: boolean
  compactedAt?: number
  compactionError?: string
  turnStatus?: SessionTurnSnapshot
  /** 后台任务的事实（由持有 runtime 的那一层经 props 传进来 —— 与 `running` 同一条路线）。
      不要在这里调 `useConversations()` 工厂：那会拿到**另一份新 store**，事实永远是空的 ✗（真机教训 ✓）。 */
  backgroundTasks?: Array<{ id?: unknown; name?: unknown; status?: unknown }>
  /** 窄带专用的终态（只增不改）：跑完那一刻算出来，窄带据此显示 15 秒。 */
  backgroundTaskOutcome?: { kind: 'failed' | 'cancelled' | 'completed'; count: number; firstName: string; at: number } | null
  ctfSession: boolean
  vulnerabilitySession?: boolean
  ctfMode?: 'coach' | 'copilot' | 'delegate'
  ctfRole?: 'solver' | 'tool-builder' | 'strategist'
  kernel?: 'pi' | 'dsh'
  modelMode?: 'auto' | 'manual'
  modelId?: string
  modelProvider?: string
  thinkingLevel?: ModelThinkingLevel
  modelSourcePreference?: 'auto' | 'account' | 'personal'
  executionMode?: CodingExecutionMode
  approvalPolicy?: CodingApprovalPolicy
  mcpServers?: string[]
  mcpConfigDigest?: string
  ensureConversation: (title?: string) => string
  pendingComposerDraft?: { prompt: string; visibleText: string } | null
  conversationDrawerOpen?: boolean
  engineNotice?: string
  engineNoticeRepeat?: number
  restorable?: boolean
  surface?: 'page' | 'dock'
  onSend?: (
    text: string,
    visibleText?: string,
    attachments?: CodingAttachment[],
    scopeToken?: 'browser-use' | 'computer-use',
    productAction?: CodingProductActionRequest,
  ) => void
  onCtfAction?: (action: CTFChatAction) => void
  onAbort?: () => void
  onChooseWorkspace?: () => void
  onChooseWorkspaceForNewTask?: () => void
  onSelectWorkspace?: (path: string) => void
  onForgetWorkspace?: (path: string) => void
  onClearWorkspace?: () => void
  onCancelQueuedGuidance?: (index: number) => void
  onEditQueuedGuidance?: (index: number) => void
  onChangeModel?: (mode: 'auto' | 'manual', provider?: string, model?: string) => void
  onChangeThinkingLevel?: (level: ModelThinkingLevel) => void
  onChangeKernel?: (kernel: 'pi' | 'dsh') => void
  onMigrateKernel?: (kernel: 'pi' | 'dsh') => void
  onChangeModelSource?: (preference: 'auto' | 'account' | 'personal') => void
  onChangeCodingPolicy?: (
    executionMode: CodingExecutionMode,
    approvalPolicy: CodingApprovalPolicy,
  ) => void
  onChangeMcpServers?: (servers: string[], configDigest: string) => void
  onRespondApproval?: (requestId: string, approved: boolean, scope?: 'once' | 'conversation', choice?: string) => void
  onEditUser?: (messageId: string, content: string) => void
  onBranchAssistant?: (messageId: string) => void
  onCompactContext?: () => void
  onRewindContext?: () => void
  onHandoffContext?: () => void
  onNewConversation?: () => void
  onControlGoal?: (action: 'pause' | 'resume' | 'clear') => void
  onOpenSettings?: () => void
  onOpenConversation?: (conversationId: string) => void
  onReturnCtf?: () => void
  onReturnVuln?: () => void
  onReturnLab?: () => void
  onSwitchCtfAgent?: (role: 'solver' | 'tool-builder' | 'strategist') => void
  onConsumePendingDraft?: () => void
  onToggleConversationDrawer?: () => void
  onExpand?: () => void
  onRestore?: () => void
}

export type ChatPageHandle = {
  focusComposer: () => Promise<void>
  revealTranscriptMessage: (messageId: string) => Promise<boolean>
}

const ChatPage = forwardRef<ChatPageHandle, ChatPageProps>(function ChatPage({
  className,
  conversation,
  settings,
  workspacePath,
  running,
  aborting,
  abortStalled,
  messageQueue,
  sessionReady,
  resumed,
  compacting,
  compactedAt,
  compactionError,
  turnStatus,
  backgroundTasks,
  backgroundTaskOutcome,
  ctfSession,
  vulnerabilitySession,
  ctfMode,
  ctfRole,
  kernel,
  modelMode,
  modelProvider,
  modelId,
  thinkingLevel,
  executionMode,
  approvalPolicy,
  mcpServers,
  mcpConfigDigest,
  ensureConversation,
  pendingComposerDraft,
  engineNotice,
  engineNoticeRepeat,
  restorable,
  surface,
  onSend,
  onCtfAction,
  onAbort,
  onChooseWorkspace,
  onChooseWorkspaceForNewTask,
  onSelectWorkspace,
  onForgetWorkspace,
  onClearWorkspace,
  onCancelQueuedGuidance,
  onEditQueuedGuidance,
  onChangeModel,
  onChangeThinkingLevel,
  onChangeKernel,
  onMigrateKernel,
  onChangeModelSource,
  onChangeCodingPolicy,
  onChangeMcpServers,
  onRespondApproval,
  onEditUser,
  onBranchAssistant,
  onCompactContext,
  onRewindContext,
  onHandoffContext,
  onNewConversation,
  onControlGoal,
  onSwitchCtfAgent,
  onConsumePendingDraft,
  onExpand,
  onRestore,
}: ChatPageProps, ref) {
  const t = useT()
  const conversations = useConversations()
  const dockSurface = surface === 'dock'
  const catalog = useLiveModelCatalog()
  const pickerGroups = catalog.pickerGroups
  const modelCatalogSnapshot = catalog.snapshot

  const [goalMode, setGoalMode] = useState(false)
  const [stagedComposerPrompt, setStagedComposerPrompt] = useState<{
    conversationId: string
    prompt: string
  } | null>(null)
  const composer = useRef<ChatComposerHandle | null>(null)
  // The right-click menu only exists while the reader has text selected in the transcript.
  const [quoteSelection, setQuoteSelection] = useState<{ text: string; x: number; y: number } | null>(null)

  function openQuoteMenu(event: {
    currentTarget: HTMLDivElement
    clientX: number
    clientY: number
    preventDefault: () => void
  }) {
    const text = selectedTextIn(event.currentTarget)
    if (!text) return
    event.preventDefault()
    setQuoteSelection({ text, x: event.clientX, y: event.clientY })
  }
  const scrollArea = useRef<HTMLDivElement | null>(null)
  const APPROVAL_CONFIRM_TIMEOUT_MS = 3000
  const pendingApprovalMessage = conversation?.messages.find(message => (
    message.approvalState === 'pending'
    && Boolean(message.approvalRequestId)
    && !isAskMessage(message)
  )) ?? null
  // 受限文件夹的**生效列表**（总开关关掉时为空）：与引擎下发给侧车的值同一口径。
  const protectedFolders = effectiveProtectedFolders(settings ?? undefined)
  const approvalAssessed = useMemo(() => assessApprovalRequest({
    content: pendingApprovalMessage?.content ?? '',
    approvalInput: pendingApprovalMessage?.approvalInput ?? '',
  }, [], { effectiveProtectedFolders: protectedFolders }), [
    pendingApprovalMessage?.approvalInput,
    pendingApprovalMessage?.content,
    protectedFolders,
  ])
  const approvalBarIsDestructive = useMemo(() => approvalBarIsDestructiveFor({
    content: pendingApprovalMessage?.content,
    approvalInput: pendingApprovalMessage?.approvalInput,
    targetKinds: approvalAssessed.targets.map(target => target.kind),
  }), [approvalAssessed.targets, pendingApprovalMessage?.approvalInput, pendingApprovalMessage?.content])
  const approvalCanAllow = approvalCanAllowFrom(approvalBarIsDestructive, approvalAssessed.canAllow)
  // 上游新增：无法核准的破坏性删除要在卡片上说明（不是我们那条“空间实测”的口径）。
  const approvalUnverified = approvalBarIsDestructive && !approvalAssessed.canAllow
  const [approvalSubmitting, setApprovalSubmitting] = useState(false)
  const [approvalError, setApprovalError] = useState('')
  const approvalSummary = String(pendingApprovalMessage?.toolName ?? pendingApprovalMessage?.content ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)

  function submitApproval(approved: boolean) {
    if (!approvalSubmitAllowed({
      approved,
      canAllow: approvalCanAllow,
      hasRequestId: Boolean(pendingApprovalMessage?.approvalRequestId),
      submitting: approvalSubmitting,
    })) return
    setApprovalSubmitting(true)
    setApprovalError('')
    onRespondApproval?.(pendingApprovalMessage?.approvalRequestId ?? '', approved, 'once')
    window.setTimeout(() => {
      setApprovalSubmitting(current => {
        const outcome = approvalTimeoutOutcome(current)
        if (outcome.unconfirmed) {
          setApprovalError(t('审批未确认，请重试。', 'The decision was not confirmed. Try again.'))
        }
        return outcome.submitting
      })
    }, APPROVAL_CONFIRM_TIMEOUT_MS)
  }

  useEffect(() => {
    if (pendingApprovalMessage?.approvalState && pendingApprovalMessage.approvalState !== 'pending') {
      setApprovalSubmitting(false)
    }
  }, [pendingApprovalMessage?.approvalState])
  const chatAutoScrollPinned = useRef(true)
  const lastChatScrollTop = useRef(0)
  // 我们自己发起的跟随滚动的时间戳：在那之后的一小段里，滚动事件不得被当成“读者往上翻”。
  const programmaticScrollUntil = useRef(0)
  const [workshopState, setWorkshopState] = useState<CTFToolWorkshopState | null>(null)
  const [environmentOpen, setEnvironmentOpen] = useState(false)
  const [contextRailWidth, setContextRailWidth] = useState<number | null>(readCodingRailWidth())
  const [terminalOpen, setTerminalOpen] = useState(false)
  const [terminalHeight, setTerminalHeight] = useState(readCodingTerminalHeight())
  const [contextPanel, setContextPanel] = useState<ContextPanel>(
    ctfSession || vulnerabilitySession ? 'domain' : 'environment',
  )
  const artifactPanel = useRef<CodingArtifactPreviewPanelHandle | null>(null)
  const [requestedArtifactPath, setRequestedArtifactPath] = useState('')
  const [, setEnvironmentLoading] = useState(false)
  const [environmentError, setEnvironmentError] = useState('')
  const [browserPanelError, setBrowserPanelError] = useState('')
  const [codingBrowserLoading, setCodingBrowserLoading] = useState(false)
  const [codingBrowserURL, setCodingBrowserURL] = useState('')
  const [codingBrowserStatus, setCodingBrowserStatus] = useState<CodingBrowserStatus | null>(null)
  const codingBrowserViewport = useRef<HTMLDivElement | null>(null)
  const [codingBrowserEvidenceLoading, setCodingBrowserEvidenceLoading] = useState(false)
  const [, setCodingBrowserEvidenceError] = useState('')
  const [, setCodingBrowserEvidenceRevealed] = useState(false)
  const [, setArtifactPreviewEvidence] = useState<{
    relativePath: string
    kind: CodingArtifactPreview['kind']
  } | null>(null)
  const [, setBrowserEvidence] = useState<{ path: string } | null>(null)
  const [, setComputerUseEvidence] = useState<{
    name: string
    bundleId: string
    pid: number
    windowId: number
    windowTitle?: string
  } | null>(null)
  const [computerUseLoading, setComputerUseLoading] = useState(false)
  const [computerUseStatus, setComputerUseStatus] = useState<CodingComputerUseStatus | null>(null)
  const [computerUseTargets, setComputerUseTargets] = useState<CodingComputerUseTarget[]>([])
  const [selectedComputerUseTargetKey, setSelectedComputerUseTargetKey] = useState('')
  const [computerUsePermissionDialogOpen, setComputerUsePermissionDialogOpen] = useState(false)
  const [computerUsePermissionRequesting, setComputerUsePermissionRequesting] = useState<CodingComputerUsePermission | null>(null)
  const [computerUsePermissionPolling, setComputerUsePermissionPolling] = useState(false)
  const [computerUsePermissionError, setComputerUsePermissionError] = useState('')
  const [computerUsePermissionCompleting, setComputerUsePermissionCompleting] = useState(false)
  const [preferEmulatorTarget, setPreferEmulatorTarget] = useState(false)
  const [changesFocusPath, setChangesFocusPath] = useState('')
  const [codingEnvironment, setCodingEnvironment] = useState<CodingEnvironmentSnapshot | null>(null)
  const codingEnvironmentRef = useRef<CodingEnvironmentSnapshot | null>(null)
  const [mcpConfig, setMcpConfig] = useState<CodingMCPConfigSnapshot | null>(null)
  const [mcpConfigLoading, setMcpConfigLoading] = useState(false)
  const [ctfBudget, setCtfBudget] = useState<CTFAgentBudgetStatus | null>(null)
  const [ctfCheckpoint, setCtfCheckpoint] = useState<CTFAgentRunCheckpoint | null>(null)
  const [ctfProjection, setCtfProjection] = useState<CTFProjection | null>(null)
  const [userSkills, setUserSkills] = useState<AgentResourceSkill[]>([])
  const [projectMemory, setProjectMemory] = useState<CodingProjectMemory | null>(null)
  const [gitBranchError, setGitBranchError] = useState('')
  const [runClockNow, setRunClockNow] = useState(() => Date.now())
  const [waitingNow, setWaitingNow] = useState(() => Date.now())
  const [waitingStartedAt, setWaitingStartedAt] = useState<number | null>(null)
  const [chatActivityExpansion, setChatActivityExpansion] = useState(
    () => new Map<string, ChatActivityExpansionState>(),
  )
  const [activityExpansionRev, setActivityExpansionRev] = useState(0)
  const [mountedTranscriptBlocks, setMountedTranscriptBlocks] = useState(0)
  // 显示窗口从尾巴往回挪了多少段（读者点「更早的 N 段」时增加）⇒ 更早的内容仍然看得到 ✓
  const [transcriptWindowShift, setTranscriptWindowShift] = useState(0)
  const transcriptWindowShiftRef = useRef(0)
  // 「回到最新」按钮的显隐：由“是否还贴着底部”驱动 ✓（那个判断本身是 ref ✗ ⇒ 不触发重渲染 ⇒ 另设一个 state ✓）。
  const [jumpToLatestVisible, setJumpToLatestVisible] = useState(false)

  const conversationRef = useRef(conversation)
  const workspacePathRef = useRef(workspacePath)
  const runningRef = useRef(running)
  const ctfSessionRef = useRef(ctfSession)
  const environmentOpenRef = useRef(environmentOpen)
  const contextPanelRef = useRef(contextPanel)
  const codingBrowserStatusRef = useRef(codingBrowserStatus)
  const computerUseStatusRef = useRef(computerUseStatus)
  const computerUseTargetsRef = useRef(computerUseTargets)
  const selectedComputerUseTargetKeyRef = useRef(selectedComputerUseTargetKey)
  const preferEmulatorTargetRef = useRef(preferEmulatorTarget)
  const computerUsePermissionDialogOpenRef = useRef(computerUsePermissionDialogOpen)
  const computerUsePermissionPollingRef = useRef(computerUsePermissionPolling)
  const dockSurfaceRef = useRef(dockSurface)
  const codingBrowserLoadingRef = useRef(codingBrowserLoading)
  const computerUseLoadingRef = useRef(computerUseLoading)
  const mcpServersRef = useRef(mcpServers)
  const mcpConfigDigestRef = useRef(mcpConfigDigest)
  const chatTranscriptLengthRef = useRef(0)
  const mountedTranscriptBlocksRef = useRef(0)
  const lastConversationIdForTranscript = useRef('')
  const codingBrowserResizeObserver = useRef<ResizeObserver | null>(null)
  const lastCodingBrowserViewport = useRef('')
  const transcriptRefillTimer = useRef(0)
  const transcriptInteractionUntil = useRef(0)
  const pendingTranscriptRestore = useRef<{ height: number; top: number } | null>(null)
  const ctfProjectionRef = useRef(ctfProjection)

  conversationRef.current = conversation
  workspacePathRef.current = workspacePath
  runningRef.current = running
  ctfSessionRef.current = ctfSession
  environmentOpenRef.current = environmentOpen
  contextPanelRef.current = contextPanel
  codingBrowserStatusRef.current = codingBrowserStatus
  computerUseStatusRef.current = computerUseStatus
  computerUseTargetsRef.current = computerUseTargets
  selectedComputerUseTargetKeyRef.current = selectedComputerUseTargetKey
  preferEmulatorTargetRef.current = preferEmulatorTarget
  computerUsePermissionDialogOpenRef.current = computerUsePermissionDialogOpen
  computerUsePermissionPollingRef.current = computerUsePermissionPolling
  dockSurfaceRef.current = dockSurface
  codingBrowserLoadingRef.current = codingBrowserLoading
  computerUseLoadingRef.current = computerUseLoading
  mcpServersRef.current = mcpServers
  mcpConfigDigestRef.current = mcpConfigDigest
  ctfProjectionRef.current = ctfProjection
  codingEnvironmentRef.current = codingEnvironment
  mountedTranscriptBlocksRef.current = mountedTranscriptBlocks
  transcriptWindowShiftRef.current = transcriptWindowShift

  const terminalDockStyle = useMemo<CSSProperties>(() => ({ height: `${terminalHeight}px` }), [terminalHeight])
  const automaticModel = useMemo(() => {
    if (!settings) return null
    return {
      provider: settings.active_provider,
      model: settings.active_model,
    }
  }, [settings])
  const effectiveModelMode = modelMode ?? 'auto'
  const currentModelKey = useMemo(() => {
    if (!settings) return ''
    if (effectiveModelMode === 'auto') return 'auto'
    const provider = modelProvider || settings.active_provider
    const model = modelId || settings.active_model
    const match = pickerGroups.find(group => (
      group.providerId === provider && group.models.includes(model)
    ))
    const source = match?.source ?? 'service'
    return encodeComposerModelKey(provider, model, source)
  }, [settings, effectiveModelMode, modelProvider, modelId, pickerGroups])
  const automaticModelLabel = useMemo(() => {
    const selection = automaticModel
    if (!selection) return 'Default'
    const match = pickerGroups.find(group => (
      group.providerId === selection.provider && group.models.includes(selection.model)
    ))
    if (match) return `Default · ${catalog.pickerModelLabel(match, selection.model)}`
    return `Default · ${providerModelLabel(selection.provider, selection.model)}`
  }, [automaticModel, pickerGroups, catalog])
  const currentModelSelection = useMemo(() => ({
    provider: effectiveModelMode === 'auto'
      ? automaticModel?.provider ?? ''
      : modelProvider || settings?.active_provider || '',
    model: effectiveModelMode === 'auto'
      ? automaticModel?.model ?? ''
      : modelId || settings?.active_model || '',
  }), [effectiveModelMode, automaticModel, modelProvider, modelId, settings])
  const currentThinkingProfile = useMemo(() => resolveModelThinking(
    settings,
    currentModelSelection.provider,
    currentModelSelection.model,
  ), [settings, currentModelSelection])
  const currentThinkingLevel = useMemo(() => effectiveModelThinkingLevel(
    currentThinkingProfile,
    thinkingLevel,
  ), [currentThinkingProfile, thinkingLevel])
  const activeExtensions = conversation?.agentExtensions ?? []
  const selectedMCPServers = mcpServers ?? []
  const enabledUserSkills = useMemo(() => userSkills.filter(skill => skill.enabled), [userSkills])
  const userSkillNames = useMemo(() => enabledUserSkills.map(skill => skill.name), [enabledUserSkills])
  const activeSkills = useMemo(() => [
    ...enabledCodingSkillNames(settings?.disabled_skills),
    ...userSkillNames,
  ], [settings?.disabled_skills, userSkillNames])
  const userMCPServers = useMemo(() => (
    (mcpConfig?.servers ?? []).filter(server => server.scope === 'user')
  ), [mcpConfig])
  const projectMCPServers = useMemo(() => (
    (mcpConfig?.servers ?? []).filter(server => server.scope !== 'user')
  ), [mcpConfig])
  const activeTools = conversation?.agentTools ?? []
  const activeGoal = conversation?.agentGoal
  const queuedGuidanceAwaitingTool = useMemo(() => (
    (conversation?.messages ?? []).some(message => (
      message.role === 'tool'
      && message.status === 'running'
      && message.toolName !== codingAskToolName
    ))
  ), [conversation?.messages])
  const composerGitSummary = useMemo(() => {
    const git = codingEnvironment?.git
    if (!git?.isRepository || !git.dirty || git.changedFiles <= 0) return undefined
    return {
      changedFiles: git.changedFiles,
      additions: git.additions,
      deletions: git.deletions,
      changes: git.changes ?? [],
      changesTruncated: git.changesTruncated,
    }
  }, [codingEnvironment])
  const continuity = useMemo(() => codingContinuityPresentation({
    sessionReady,
    resumed,
    compacting,
    compactedAt,
    running,
  }), [sessionReady, resumed, compacting, compactedAt, running])
  const effectiveTurnStatus = useMemo<SessionTurnSnapshot>(() => {
    const base = turnStatus ?? { compacting }
    const model = effectiveModelMode === 'auto'
      ? automaticModel?.model
      : modelId || settings?.active_model
    const usageModel = base.usage?.model
    const catalogWindowFor = (id: string | undefined) => (
      id ? modelCatalogSnapshot?.models.find(entry => entry.id === id)?.context_window : undefined
    )
    const catalogWindow = catalogWindowFor(model)
      ?? catalogWindowFor(usageModel)
      ?? base.contextWindow
    const usageModelId = usageModel || model
    const provider = base.usage?.provider
      || (effectiveModelMode === 'auto'
        ? automaticModel?.provider
        : modelProvider || settings?.active_provider)
    const contextWindow = resolveModelContextWindow(
      usageModelId,
      catalogWindow,
      modelContextWindowOverride(settings?.model_context_windows, provider, usageModelId),
    ) || base.contextWindow
    return applySessionContextWindow(
      { ...base, compacting: compacting || Boolean(base.compacting) },
      contextWindow,
    )
  }, [
    turnStatus,
    compacting,
    effectiveModelMode,
    automaticModel,
    modelId,
    modelProvider,
    settings,
    modelCatalogSnapshot,
  ])
  const contextUsagePresentation = useMemo(() => presentContextUsage(effectiveTurnStatus), [effectiveTurnStatus])
  const runTimingPresentation = useMemo(() => (
    presentRunTiming(effectiveTurnStatus, runClockNow)
  ), [effectiveTurnStatus, runClockNow])
  // 打字卡顿的根：runClockNow / waitingNow 每秒变一次 ⇒ ChatPage 每秒整体重渲染；而消息条目
  // 没有 memo、下面这些回调每次渲染都是新身份 ⇒ 2300+ 条消息每秒被全部重渲染一次（真机实测：
  // 属性写入约 265 次/秒、最长一次卡 744ms、每秒新增约 77 个 DOM 节点）。
  // 这里把回调身份钉死（永远调用"最新的那一份"），并让消息条目 memo 化，
  // 这样"每秒一次的页面重渲染"就不会传导到每一条消息上。
  const latestTranscriptHandlers = useRef({
    onRespondApproval,
    onEditUser,
    onRewindContext,
    resumeAfterFailure,
    branchFromAssistantMessage,
  })
  useEffect(() => {
    latestTranscriptHandlers.current = {
      onRespondApproval,
      onEditUser,
      onRewindContext,
      resumeAfterFailure,
      branchFromAssistantMessage,
    }
  })
  const transcriptHandlers = useMemo(() => ({
    onRespondApproval: (requestId: string, approved: boolean, scope?: 'once' | 'conversation', choice?: string) =>
      latestTranscriptHandlers.current.onRespondApproval?.(requestId, approved, scope, choice),
    onRetry: () => latestTranscriptHandlers.current.resumeAfterFailure(),
    onEditUser: (messageId: string, content: string) =>
      latestTranscriptHandlers.current.onEditUser?.(messageId, content),
    onRewindContext: () => latestTranscriptHandlers.current.onRewindContext?.(),
    onBranchAssistant: (messageId: string) =>
      latestTranscriptHandlers.current.branchFromAssistantMessage(messageId),
  }), [])
  const MemoChatMessageItem = useMemo(() => memo(ChatMessageItem), [])
  const effectiveExecutionMode = useMemo(() => (
    normalizeCodingExecutionMode(executionMode)
  ), [executionMode])
  const effectiveApprovalPolicy = useMemo(() => (
    normalizeCodingApprovalPolicy(approvalPolicy)
  ), [approvalPolicy])
  const computerUseOwnedByCurrentTask = Boolean(
    computerUseStatus?.conversationId
    && computerUseStatus.conversationId === conversation?.id,
  )
  const computerUseReadyForCurrentTask = Boolean(
    computerUseStatus?.enabled
    && computerUseOwnedByCurrentTask,
  )
  const scopedComputerUseTargets = computerUseTargets
  const browserUseReadyForCurrentTask = Boolean(
    workspacePath
    && effectiveExecutionMode === 'go'
    && effectiveApprovalPolicy !== 'read-only',
  )
  const externalAppUseReadyForCurrentTask = Boolean(
    computerUseReadyForCurrentTask
    && computerUseStatus?.target,
  )
  const selectedComputerUseTarget = useMemo(() => (
    resolveSelectedComputerUseTarget(
      scopedComputerUseTargets,
      selectedComputerUseTargetKey,
    )
  ), [scopedComputerUseTargets, selectedComputerUseTargetKey])
  const codingCapabilities = useMemo(() => {
    const capabilities = conversation?.agentCapabilities?.length
      ? conversation.agentCapabilities
      : previewCodingCapabilities(
          effectiveExecutionMode,
          effectiveApprovalPolicy,
          Boolean(
            settings?.providers?.openai?.enabled
            && settings.providers.openai.has_api_key,
          ),
        )
    if (!computerUseStatus) return capabilities
    const target = computerUseStatus.target
    const computerUseCapability = computerUseReadyForCurrentTask && target
      ? describeActiveComputerUseCapability(
          effectiveExecutionMode,
          effectiveApprovalPolicy,
          target,
        )
      : describePendingComputerUseCapability(
          effectiveExecutionMode,
          effectiveApprovalPolicy,
          target ?? selectedComputerUseTarget,
          {
            available: Boolean(computerUseStatus.available),
            permissionsReady: Boolean(
              computerUseStatus.permissions.accessibility
              && computerUseStatus.permissions.screenRecording,
            ),
            attachedToOtherTask: Boolean(
              computerUseStatus.conversationId
              && !computerUseOwnedByCurrentTask,
            ),
            problem: computerUseStatus.problem,
          },
        )
    return capabilities.map(capability => capability.id === 'computer-use'
      ? { ...capability, ...computerUseCapability }
      : capability)
  }, [
    conversation?.agentCapabilities,
    effectiveExecutionMode,
    effectiveApprovalPolicy,
    settings,
    computerUseStatus,
    computerUseReadyForCurrentTask,
    selectedComputerUseTarget,
    computerUseOwnedByCurrentTask,
  ])
  const codingPolicyLabel = useMemo(() => {
    const mode = effectiveExecutionMode === 'plan' ? 'Plan' : 'Go'
    const approval = effectiveApprovalPolicy === 'read-only'
      ? t('只读', 'Read-only')
      : effectiveApprovalPolicy === 'ask'
        ? t('每次询问', 'Ask each time')
        : effectiveApprovalPolicy === 'full-auto'
          ? t('完全访问', 'Full access')
          : t('项目自动', 'Project auto')
    return `${mode} · ${approval}`
  }, [effectiveExecutionMode, effectiveApprovalPolicy, t])
  const topbarPresentation = useMemo(() => chatTopbarPresentation({
    ctfSession,
    vulnerabilitySession,
    conversationTitle: conversation?.title,
    workspacePath,
    codingPolicyLabel,
    ctfMode,
  }), [ctfSession, vulnerabilitySession, conversation?.title, workspacePath, codingPolicyLabel, ctfMode])
  const topbarModule = ctfSession
    ? 'ctf'
    : vulnerabilitySession
      ? 'cve'
      : conversation?.domainTaskContext?.kind === 'lab'
        ? 'lab'
        : 'coding'
  const emptyCanvas = !(conversation?.messages.length)
  const codingDraftIdle = (
    !ctfSession
    && !vulnerabilitySession
    && emptyCanvas
  )
  const approvalMenuLabel = useMemo(() => (
    effectiveApprovalPolicy === 'full-auto'
      ? t('完全访问', 'Full access')
      : effectiveApprovalPolicy === 'workspace-auto'
        ? t('替我审批', 'Approve for me')
        : effectiveApprovalPolicy === 'ask'
          ? t('请求批准', 'Ask before acting')
          : t('只读', 'Read-only')
  ), [effectiveApprovalPolicy, t])
  const compactModelLabel = useMemo(() => {
    const provider = effectiveModelMode === 'auto'
      ? automaticModel?.provider
      : modelProvider || settings?.active_provider
    const model = effectiveModelMode === 'auto'
      ? automaticModel?.model
      : modelId || settings?.active_model
    if (!provider || !model) {
      return effectiveModelMode === 'auto' ? 'Default' : t('选择模型', 'Choose a model')
    }
    const modelName = providerModelLabel(provider, model).split(' · ').at(-1) || model
    return modelName.replace(/^DeepSeek\s+/i, '')
  }, [effectiveModelMode, automaticModel, modelProvider, modelId, settings, t])
  const automaticScratchWorkspace = isGeneratedScratchWorkspace(workspacePath)
  const homeDirectory = projectMemory?.homeDirectory ?? ''
  const recentProjects = projectMemory?.recents ?? []
  const gitBranches = codingEnvironment?.git.localBranches ?? []
  const gitBranch = codingEnvironment?.git.branch ?? ''
  const gitRepository = Boolean(codingEnvironment?.git.isRepository)
  const workspaceName = useMemo(() => {
    if (automaticScratchWorkspace) return t('无项目任务', 'No project')
    const context = conversation?.domainTaskContext
    if (context?.kind === 'ctf' && context.challengeTitle.trim()) return context.challengeTitle.trim()
    if (context?.kind === 'cve' && context.cveId.trim()) return context.cveId.trim()
    if (context?.kind === 'lab' && context.title.trim()) return context.title.trim()
    return codingWorkspaceLabel(workspacePath, homeDirectory)
  }, [automaticScratchWorkspace, conversation?.domainTaskContext, workspacePath, homeDirectory, t])
  const selectedCodingProjectName = useMemo(() => {
    if (!shouldRememberCodingProject(workspacePath)) return ''
    return codingWorkspaceLabel(workspacePath, homeDirectory)
  }, [workspacePath, homeDirectory])
  const codingEmptyHeading = useMemo(() => {
    const name = selectedCodingProjectName || workspaceName
    if (name && name !== '~' && name !== t('无项目任务', 'No project') && !isGenericWorkspaceLabel(name)) {
      return t(`我们在 ${name} 中构建什么`, `What should we build in ${name}`)
    }
    return t('我们要构建什么', 'What should we build')
  }, [selectedCodingProjectName, workspaceName, t])
  const terminalConversationId = conversation?.id || LOCAL_CODING_SHELL_ID
  const terminalWorkspacePath = workspacePath || homeDirectory
  const codingBrowserEvidencePath = useMemo(() => {
    const sessionID = codingBrowserStatus?.sessionId?.trim()
    return sessionID ? `.milksu/browser-evidence/${sessionID}` : ''
  }, [codingBrowserStatus?.sessionId])
  const codingBrowserTabs = codingBrowserStatus?.tabs ?? []
  const codingBrowserPage = codingBrowserStatus?.pages?.[0] ?? null
  const activeCodingBrowserTab = codingBrowserTabs.find(tab => tab.active)
    ?? codingBrowserTabs[0]
    ?? null
  const codingBrowserTabTitle = (
    activeCodingBrowserTab?.title
    || codingBrowserPage?.title
    || codingBrowserStatus?.initialUrl
    || t('新标签页', 'New tab')
  )
  const workspaceLocked = Boolean(conversation?.messages.length)
  const agentKernel: 'pi' | 'dsh' = kernel ?? (conversation?.kernel === 'dsh' ? 'dsh' : 'pi')
  const workingRoot = workingRootConversation(conversation, conversations.conversations)
  const workingItems = workingItemsForConversation(
    workingRoot,
    conversations.conversations,
    conversations.runningConversationIds,
  )
  const liveWorkingCount = liveWorkingItems(workingItems).length
  const runPhase = composerRunPhase({
    kernel: agentKernel,
    parentMarkedRunning: running,
    aborting,
    compacting: Boolean(compacting),
    liveWorkingCount,
    parentHasActiveTurnResidue: parentHasActiveTurnResidue(
      conversation?.messages ?? [],
      agentKernel,
      { liveWorkingCount },
    ),
    msSinceRunStart: turnStatus?.runStartedAt === undefined
      ? 0
      : Math.max(0, runClockNow - turnStatus.runStartedAt),
  })
  const sessionTreeUnavailable = agentKernel === 'dsh'
  const rewindUnavailable = Boolean(compacting) || sessionTreeUnavailable
  const activeModelLabel = useMemo(() => {
    if (effectiveModelMode === 'auto') return automaticModelLabel.replace(/^Default · /, '')
    const provider = modelProvider || settings?.active_provider
    const model = modelId || settings?.active_model
    return provider && model ? providerModelLabel(provider, model) : t('等待选择', 'Waiting for a choice')
  }, [effectiveModelMode, automaticModelLabel, modelProvider, modelId, settings, t])
  const activeModelSourceLabel = useMemo(() => modelServiceSourceLabel({
    provider: currentModelSelection.provider,
    model: currentModelSelection.model,
    modelSource: conversation?.modelSource,
    pickerGroups,
    providers: settings?.providers,
  }), [currentModelSelection, conversation?.modelSource, pickerGroups, settings?.providers])
  const computerUseOperationEvidence = useMemo(() => (
    extractLatestComputerUseOperationEvidence(conversation?.messages ?? [])
  ), [conversation?.messages])
  const chatTranscript = useMemo(() => (
    buildChatTranscript(conversation?.messages ?? [], running)
  ), [conversation?.messages, running])
  // 跟随输出增长用的康价指纹。一轮里的正文和工具块都挂在**同一条** assistant 消息下，
  // 所以 messages.length 不变而内容在涨；只看条数的话视图会停在原处，
  // 读者看到一片空白，会以为“它没动静”（用户实测就是这个现象）。
  const transcriptContentRevision = useMemo(() => {
    // 三种块都要看：正文块看正文长度；工具/活动块看条数、运行状态与内部正文+耗时之和；
    // 折叠的过程块递归进去。只写 kind 的话，长命令跑着时这些块在变也不会跟随。
    const fingerprint = (block: ChatTranscriptBlock): string => {
      if (block.kind === 'message') {
        return `${block.id}:${block.message.content?.length ?? 0}`
      }
      if (block.kind === 'process') {
        return `${block.id}[${block.blocks.map(fingerprint).join(',')}]`
      }
      return `${block.id}:${block.running ? 1 : 0}:${block.messages.length}:${block.messages.reduce(
        (sum, item) => sum + (item.content?.length ?? 0) + (item.durationMs ?? 0),
        0,
      )}`
    }
    return chatTranscript.map(fingerprint).join('|')
  }, [chatTranscript])
  const thinkingFoldKey = useMemo(() => latestFinishedThinkingId(chatTranscript), [chatTranscript])
  chatTranscriptLengthRef.current = chatTranscript.length
  const recoverableFailureId = useMemo(() => (
    recoverableAgentFailureId(conversation?.messages ?? [], running)
  ), [conversation?.messages, running])
  const emptyVisibleReply = useMemo(() => (
    hasEmptyVisibleReply(conversation?.messages ?? [], running)
  ), [conversation?.messages, running])
  const rewindableUserMessageId = useMemo(() => (
    lastRewindableUserMessageId(conversation?.messages ?? [])
  ), [conversation?.messages])
  const transcriptMemoKey = [
    recoverableFailureId ?? '',
    rewindableUserMessageId ?? '',
    rewindUnavailable ? 1 : 0,
    ctfSession ? 'ctf' : 'coding',
    agentKernel,
    activityExpansionRev,
    running ? 1 : 0,
    (conversation?.subagentTasks ?? []).length,
    (conversation?.subagentTasks ?? []).map(task => `${task.id}:${task.status}`).join(','),
  ].join('|')
  const conversationFileDiffs = useMemo(() => (
    agentFileDiffChips(buildChatActivityEntries(conversation?.messages ?? []))
  ), [conversation?.messages])
  const hasExecutionPlan = Boolean(latestCodingPlan(conversation?.messages ?? []))
  const hasComposerDock = hasExecutionPlan || Boolean(composerGitSummary)
  const waitingForModel = useMemo(() => {
    if (!running) return false
    if (pendingAskMessage(conversation?.messages)) return false
    const last = chatTranscript.at(-1)
    if (!last) return true
    if (last.kind === 'activity') return !last.running
    if (last.kind === 'process') {
      const inner = last.blocks.at(-1)
      if (!inner) return true
      if (inner.kind === 'activity') return !inner.running
      return inner.message.status !== 'running' && inner.message.role !== 'assistant'
    }
    return last.message.status !== 'running' && last.message.role !== 'assistant'
  }, [running, conversation?.messages, chatTranscript])
  const waitingElapsed = waitingStartedAt == null
    ? ''
    : formatDemoElapsed(Math.max(0, waitingNow - waitingStartedAt))
  // ---- 搬运自本地分支：诚实文案 ----
  // “事件=有进展”与“心跳=引擎还在”是两件事。以前只看安静，于是长工具/慢模型都被读成
  // “连接掉了”；现在分开，并且只有“安静 + 没有工具在跑 + 引擎心跳也没了”才说引擎没响应。
  const streamStale = conversations.streamStale
  const streamStaleSeconds = conversations.streamStaleSeconds
  const runningToolActive = conversations.activeToolRunning
  const engineAlive = conversations.activeEngineAlive
  // E 队列可见性：当前对话排在谁后面（空串=没排队）。
  const queuedBehindLabel = conversations.activeQueuedBehind
  const STUCK_TURN_EXIT_SECONDS = 45
  const stuckTurn = streamStale
    && !runningToolActive
    && !queuedBehindLabel
    && engineAlive === false
    && streamStaleSeconds >= STUCK_TURN_EXIT_SECONDS
  /** “等待”必须说清在等什么；无声地计数就是在说“模型正在回复”——那和连接断了一模一样。 */
  const waitingLabel = (() => {
    // 排在同一个 sidecar 的另一个对话后面是「排队」，不是「停滞」：
    // 在这里说“连接丢了”就是横幅以前撒的那个谎。
    if (queuedBehindLabel) {
      return t('排队中（同工作区另一个会话在跑）', 'Queued (another conversation in this workspace is running)')
    }
    // 工具正在跑就直说：引擎这时候正在干活，说成“等待引擎响应”是假话，
    // 而且会让人以为它卡了（用户实测就是被这句话误导）。
    if (runningToolActive) return t('工具执行中…', 'Tool running…')
    if (streamStale) {
      if (stuckTurn) return t('引擎没有响应…', 'The engine is not responding…')
      return t('等待中…', 'Waiting…')
    }
    return t('等待引擎响应…', 'Waiting for the engine…')
  })()
  const latestJudge = ctfProjection?.judgeReceipts.at(-1)
  const contextPanelTitle = ({
    domain: ctfSession ? t('CTF 领域上下文', 'CTF domain context') : vulnerabilitySession ? t('CVE 领域上下文', 'CVE domain context') : t('领域上下文', 'Domain context'),
    environment: ctfSession ? t('解题环境', 'Challenge environment') : t('环境信息', 'Environment'),
    changes: t('变更', 'Changes'),
    artifacts: t('产物', 'Artifacts'),
    browser: t('浏览器', 'Browser'),
    'browser-use': 'Browser Use',
    'computer-use': 'Computer Use',
    collaboration: t('Agent 协作', 'Agent collaboration'),
    evidence: t('证据与 Judge', 'Evidence and Judge'),
  })[contextPanel]
  const transientComputerUsePanel = contextPanel === 'browser-use' || contextPanel === 'computer-use'
  const ctfRoleLabel = ctfRole === 'tool-builder'
    ? t('Coding Agent 工具工坊', 'Coding Agent tool workshop')
    : ctfRole === 'strategist'
      ? t('策略 Agent 复盘', 'Strategy Agent debrief')
      : t('CTF 解题会话', 'CTF solving session')
  const workshopSummary = useMemo(() => {
    if (!workshopState) return t('正在读取工具交接状态', 'Reading tool handoff status')
    if (workshopState.pendingCount) return t(`${workshopState.pendingCount} 个工具请求待实现`, `${workshopState.pendingCount} tool requests pending`)
    if (workshopState.readyCount) return t(`${workshopState.readyCount} 个工具已交付，等待解题 Agent 验收`, `${workshopState.readyCount} tools delivered, waiting for the solving agent to verify`)
    if (workshopState.blockedCount) return t(`${workshopState.blockedCount} 个工具请求被阻塞`, `${workshopState.blockedCount} tool requests blocked`)
    if (workshopState.unknownCount) return t(`${workshopState.unknownCount} 个请求缺少有效状态`, `${workshopState.unknownCount} requests are missing a valid status`)
    return workshopState.toolCount
      ? t(`${workshopState.toolCount} 个本题工具已保存在工作区`, `${workshopState.toolCount} challenge tools saved in the workspace`)
      : t('当前没有工具请求', 'No tool requests')
  }, [workshopState, t])
  // 窗口 = 有上限的滑动窗口：长度 ≤ TRANSCRIPT_MOUNT_CAP，可整体往回挪（更早的内容够得到 ✓）。
  // 只是“画哪一段”⇒ chatTranscript 本身不动 ✓（模型上下文、别的对话来读，都不受影响 ✓）。
  const transcriptWindow = useMemo(
    () => computeTranscriptWindow({
      length: chatTranscript.length,
      mounted: mountedTranscriptBlocks,
      shift: transcriptWindowShift,
    }),
    [chatTranscript.length, mountedTranscriptBlocks, transcriptWindowShift],
  )
  const visibleTranscript = useMemo(
    () => chatTranscript.slice(transcriptWindow.start, transcriptWindow.end),
    [chatTranscript, transcriptWindow.start, transcriptWindow.end],
  )
  const hiddenTranscriptBlocks = transcriptWindow.hidden

  async function revealTranscriptMessage(messageId: string) {
    const index = chatTranscript.findIndex(block => block.kind === 'message' && block.message.id === messageId)
    if (index < 0) return false
    const needed = chatTranscript.length - index
    // 跨越的段数可能超过上限 ⇒ 那就不是“多挂”，而是把窗口整体挪过去 ✓（否则目标还在窗口外 ✗）
    const target = Math.min(Math.max(needed, 1), TRANSCRIPT_MOUNT_CAP)
    setMountedTranscriptBlocks(current => Math.max(current, target))
    setTranscriptWindowShift(Math.max(0, chatTranscript.length - index - target))
    await new Promise<void>(resolve => { queueMicrotask(resolve) })
    return true
  }

  useImperativeHandle(ref, () => ({
    focusComposer: () => composer.current?.focusMessageInput() ?? Promise.resolve(),
    revealTranscriptMessage,
  }))

  const browserTabs = codingBrowserTabs.length
    ? codingBrowserTabs
    : [{
        id: 'current',
        title: codingBrowserTabTitle,
        url: codingBrowserURL,
        active: true,
      }]

  function capabilityStatusLabel(status: string) {
    return status === 'allowed'
      ? t('允许', 'Allowed')
      : status === 'approval-required'
        ? t('需批准', 'Needs approval')
        : status === 'unavailable'
          ? t('未接入', 'Not attached')
          : t('阻止', 'Blocked')
  }

  function extensionLabel(value: string) {
    return value === 'milksu-workflow'
      ? 'MilkSU Workflow'
      : value === 'pi-lsp'
        ? 'PI LSP'
        : value === 'pi-goal'
          ? 'PI Goal'
          : value === 'pi-background-tasks'
            ? 'PI Background Tasks'
            : value === 'pi-mcp-adapter'
              ? 'PI MCP Adapter'
              : value === 'pi-sub-agent'
                ? 'PI Sub Agent'
                : value
  }

  function currentActivityExpansion(): ChatActivityExpansionState {
    return chatActivityExpansion.get(conversation?.id ?? '') ?? emptyActivityExpansion
  }

  function chatActivityGroupIsOpen(activityId: string): boolean {
    return chatActivityGroupOpen(currentActivityExpansion(), activityId)
  }

  function chatActivityOpenEntries(activityId: string): ReadonlySet<string> {
    return chatActivityOpenEntryIds(currentActivityExpansion(), activityId)
  }

  function applyActivityExpansion(next: ChatActivityExpansionState) {
    const conversationId = conversation?.id ?? ''
    const states = new Map(chatActivityExpansion)
    states.set(conversationId, next)
    setChatActivityExpansion(states)
    setActivityExpansionRev(value => value + 1)
  }

  function handleActivityGroupToggle(activityId: string, open: boolean) {
    applyActivityExpansion(setChatActivityGroupOpen(currentActivityExpansion(), activityId, open))
  }

  function handleActivityEntryToggle(activityId: string, entryId: string, open: boolean) {
    applyActivityExpansion(
      setChatActivityEntryOpen(currentActivityExpansion(), activityId, entryId, open),
    )
  }

  async function refreshUserSkills() {
    try {
      const catalogResult = await invokeCommand<AgentResourceCatalog>('list_agent_resource_catalog')
      setUserSkills(catalogResult.skills ?? [])
    } catch {
      setUserSkills([])
    }
  }

  function persistContextRailWidth(width: number) {
    setContextRailWidth(writeCodingRailWidth(width))
  }

  function persistTerminalHeight(height: number) {
    setTerminalHeight(writeCodingTerminalHeight(height))
  }

  function startTerminalResize(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return
    const handle = event.currentTarget
    const dock = handle.closest('.coding-terminal-dock')
    if (!dock) return
    event.preventDefault()
    handle.setPointerCapture(event.pointerId)
    const startY = event.clientY
    const startHeight = dock.getBoundingClientRect().height

    function onMove(move: PointerEvent) {
      persistTerminalHeight(clampCodingTerminalHeight(startHeight + (startY - move.clientY)))
    }
    function onUp(up: PointerEvent) {
      handle.releasePointerCapture(up.pointerId)
      handle.removeEventListener('pointermove', onMove)
      handle.removeEventListener('pointerup', onUp)
      handle.removeEventListener('pointercancel', onUp)
    }
    handle.addEventListener('pointermove', onMove)
    handle.addEventListener('pointerup', onUp)
    handle.addEventListener('pointercancel', onUp)
  }

  function showCodingPermissions() {
    setContextPanel('environment')
    setEnvironmentOpen(true)
  }

  function toggleManualContextSidebar() {
    if (environmentOpen) {
      setEnvironmentOpen(false)
      return
    }
    setContextPanel('environment')
    setEnvironmentOpen(true)
  }

  function toggleTerminalPanel() {
    setTerminalOpen(open => !open)
  }

  function showBrowserUseScope() {
    setContextPanel('browser-use')
    setEnvironmentOpen(true)
  }

  function applyCodingBrowserAddress(status: CodingBrowserStatus | null | undefined) {
    if (document.activeElement?.getAttribute('aria-label') === t('浏览器地址', 'Address')) return
    setCodingBrowserURL(codingBrowserAddressFromStatus(status))
  }

  async function syncCodingBrowserViewport() {
    const conversationID = conversationRef.current?.id
    const viewport = codingBrowserViewport.current
    const status = codingBrowserStatusRef.current
    const visible = Boolean(
      environmentOpenRef.current
      && contextPanelRef.current === 'browser'
      && status?.enabled
      && viewport,
    )
    if (!conversationID || !status?.enabled || !viewport) return
    const rect = viewport.getBoundingClientRect()
    const geometry = {
      conversationId: conversationID,
      x: rect.left,
      y: rect.top,
      width: rect.width,
      height: rect.height,
      visible,
    }
    const key = codingBrowserViewportSyncKey(
      geometry,
      status.activeTabId
        || status.tabs?.find(tab => tab.active)?.id
        || '',
    )
    if (key === lastCodingBrowserViewport.current) return
    lastCodingBrowserViewport.current = key
    try {
      await invokeCommand('set_coding_browser_viewport', geometry)
    } catch (reason) {
      toastError(reason, t('无法放置内嵌浏览器。', 'Could not place the embedded browser.'))
    }
  }

  async function hideCodingBrowserViewport(conversationID = conversationRef.current?.id ?? '') {
    if (!conversationID || !codingBrowserStatusRef.current?.enabled) return
    lastCodingBrowserViewport.current = ''
    try {
      await invokeCommand('set_coding_browser_viewport', {
        conversationId: conversationID,
        x: 0,
        y: 0,
        width: 1,
        height: 1,
        visible: false,
      })
    } catch {
      // The native view may already have been disposed with its conversation.
    }
  }

  async function refreshCodingBrowserState() {
    const conversationID = conversationRef.current?.id
    if (!conversationID || !codingBrowserStatusRef.current?.enabled) return
    try {
      const status = await invokeCommand<CodingBrowserStatus>(
        'get_coding_browser_status',
        { conversationId: conversationID },
      )
      setCodingBrowserStatus(status)
      codingBrowserStatusRef.current = status
      applyCodingBrowserAddress(status)
      await syncCodingBrowserViewport()
    } catch {
      // The regular panel refresh reports actionable errors; polling stays quiet.
    }
  }

  async function refreshBrowserPanel() {
    setBrowserPanelError('')
    if (codingBrowserLoadingRef.current || computerUseLoadingRef.current) return
    setCodingBrowserLoading(true)
    setComputerUseLoading(true)
    codingBrowserLoadingRef.current = true
    computerUseLoadingRef.current = true
    const conversationID = conversationRef.current?.id
    const [browser, computerUse, computerUseTargetsResult] = await Promise.allSettled([
      conversationID
        ? invokeCommand<CodingBrowserStatus>(
            'get_coding_browser_status',
            { conversationId: conversationID },
          )
        : Promise.resolve<CodingBrowserStatus>({
            enabled: false,
            conversationId: '',
            phase: 'disabled',
            pages: [],
          }),
      conversationID
        ? invokeCommand<CodingComputerUseStatus>('activate_coding_computer_use', {
            conversationId: conversationID,
          })
        : invokeCommand<CodingComputerUseStatus>('get_coding_computer_use_status'),
      invokeCommand<CodingComputerUseTarget[]>('list_coding_computer_use_targets'),
    ])
    let nextStatus: CodingComputerUseStatus | null = null
    if (browser.status === 'fulfilled') {
      setCodingBrowserStatus(browser.value)
      codingBrowserStatusRef.current = browser.value
      if (browser.value.initialUrl) setCodingBrowserURL(browser.value.initialUrl)
    } else {
      setCodingBrowserStatus(null)
      codingBrowserStatusRef.current = null
      toastError(browser.reason, t('暂时无法读取浏览器状态。', 'Browser status cannot be read right now.'))
    }
    if (computerUse.status === 'fulfilled') {
      nextStatus = computerUse.value
      setComputerUseStatus(computerUse.value)
      computerUseStatusRef.current = computerUse.value
    } else {
      setComputerUseStatus(null)
      computerUseStatusRef.current = null
      toastError(computerUse.reason, t('暂时无法读取 Computer Use 状态。', 'Computer Use status cannot be read right now.'))
    }
    if (computerUseTargetsResult.status === 'fulfilled') {
      setComputerUseTargets(computerUseTargetsResult.value)
      computerUseTargetsRef.current = computerUseTargetsResult.value
      setSelectedComputerUseTargetKey(current => nextComputerUseTargetKey(
        computerUseTargetsResult.value,
        current,
        nextStatus?.conversationId
          ? nextStatus.target
          : nextStatus?.grantedTarget,
        { hostBundleId: nextStatus?.signing?.bundleId },
        preferEmulatorTargetRef.current ? isEmulatorComputerUseTarget : undefined,
      ))
    } else {
      setComputerUseTargets([])
      computerUseTargetsRef.current = []
      toastError(computerUseTargetsResult.reason, t('暂时无法读取可见 App 窗口。', 'Visible app windows cannot be read right now.'))
    }
    setCodingBrowserLoading(false)
    setComputerUseLoading(false)
    codingBrowserLoadingRef.current = false
    computerUseLoadingRef.current = false
  }

  async function continueComputerUseScope() {
    const status = computerUseStatusRef.current
    const targets = computerUseTargetsRef.current
    const permissionsReady = Boolean(
      status?.permissions.accessibility && status.permissions.screenRecording,
    )
    setSelectedComputerUseTargetKey(current => nextComputerUseTargetKey(
      targets,
      current,
      status?.conversationId ? status.target : status?.grantedTarget,
      { hostBundleId: status?.signing?.bundleId },
      preferEmulatorTargetRef.current ? isEmulatorComputerUseTarget : undefined,
    ))
    const canStartOnlyVisibleTarget = Boolean(
      status?.available
      && permissionsReady
      && !status.enabled
      && !status.conversationId
      && targets.length === 1,
    )
    if (canStartOnlyVisibleTarget) {
      setSelectedComputerUseTargetKey(computerUseTargetKey(targets[0]))
      await startComputerUse(computerUseTargetKey(targets[0]))
    }
  }

  async function showComputerUseScope(preferEmulator = false) {
    if (preferEmulator) {
      setPreferEmulatorTarget(true)
      preferEmulatorTargetRef.current = true
    }
    if (dockSurfaceRef.current) {
      requestComputerUseReveal({ preferEmulator: preferEmulatorTargetRef.current })
      onExpand?.()
      return
    }
    setContextPanel('computer-use')
    setEnvironmentOpen(true)
    await refreshBrowserPanel()
    const status = computerUseStatusRef.current
    const permissionsReady = Boolean(
      status?.permissions.accessibility && status.permissions.screenRecording,
    )
    if (status?.available && !permissionsReady) {
      setComputerUsePermissionError('')
      setComputerUsePermissionDialogOpen(true)
      return
    }
    await continueComputerUseScope()
  }

  async function ensureCodingBrowser() {
    const conversationID = conversationRef.current?.id
    if (!conversationID) return
    if (codingBrowserStatusRef.current?.enabled) {
      await refreshCodingBrowserState()
      return
    }
    setCodingBrowserLoading(true)
    setBrowserPanelError('')
    try {
      const status = await invokeCommand<CodingBrowserStatus>(
        'ensure_coding_browser',
        { conversationId: conversationID },
      )
      setCodingBrowserStatus(status)
      codingBrowserStatusRef.current = status
      await refreshCodingBrowserState()
    } catch (reason) {
      toastError(reason, t('浏览器启动失败。', 'The browser failed to start.'))
    } finally {
      setCodingBrowserLoading(false)
    }
  }

  function revealBuiltInBrowser() {
    setContextPanel('browser')
    setEnvironmentOpen(true)
    void ensureCodingBrowser()
  }

  function applyWorkspaceReveal(payload?: {
    conversationId?: string
    panel?: string
    artifactPath?: string
    changePath?: string
    terminal?: string
  }) {
    if (dockSurfaceRef.current) return
    if (payload?.conversationId && payload.conversationId !== conversationRef.current?.id) return
    const panel = payload?.panel
    if (panel === 'computer-use') {
      void showComputerUseScope()
      return
    }
    if (panel === 'browser' || panel === 'artifacts' || panel === 'changes' || panel === 'environment') {
      setContextPanel(panel)
      setEnvironmentOpen(true)
    }
    if (payload?.artifactPath) setRequestedArtifactPath(payload.artifactPath)
    if (payload?.changePath) {
      setChangesFocusPath(payload.changePath)
      setContextPanel('changes')
      setEnvironmentOpen(true)
    }
    if (payload?.terminal === 'open') setTerminalOpen(true)
    if (payload?.terminal === 'close') setTerminalOpen(false)
    if (panel === 'browser') void refreshCodingBrowserState()
  }

  async function startCodingBrowser() {
    setBrowserPanelError('')
    let initialURL = ''
    try {
      initialURL = normalizeCodingBrowserAddress(codingBrowserURL)
      setCodingBrowserURL(initialURL)
    } catch (reason) {
      setBrowserPanelError(reason instanceof Error ? reason.message : t('无法识别这个地址。', 'This address could not be recognized.'))
      return
    }
    const name = workspacePathRef.current.replace(/\/+$/, '').split('/').at(-1)
    const conversationID = ensureConversation(
      name ? t(`${name} · 浏览器`, `${name} · Browser`) : t('浏览器', 'Browser'),
    )
    setCodingBrowserLoading(true)
    try {
      const status = await invokeCommand<CodingBrowserStatus>(
        'start_coding_browser',
        { conversationId: conversationID, initialUrl: initialURL },
      )
      setCodingBrowserStatus(status)
      codingBrowserStatusRef.current = status
      setCodingBrowserEvidenceError('')
      setCodingBrowserEvidenceRevealed(false)
      setBrowserEvidence(null)
      const pageURL = status.pages?.[0]?.url
      if (pageURL) setCodingBrowserURL(pageURL)
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
      await syncCodingBrowserViewport()
    } catch (reason) {
      toastError(reason, t('浏览器启动失败。', 'The browser failed to start.'))
    } finally {
      setCodingBrowserLoading(false)
    }
  }

  async function stopCodingBrowser() {
    const conversationID = conversationRef.current?.id
    if (!conversationID) return
    setBrowserPanelError('')
    setCodingBrowserLoading(true)
    try {
      await hideCodingBrowserViewport(conversationID)
      const status = await invokeCommand<CodingBrowserStatus>(
        'stop_coding_browser',
        { conversationId: conversationID },
      )
      setCodingBrowserStatus(status)
      codingBrowserStatusRef.current = status
      setCodingBrowserEvidenceError('')
      setCodingBrowserEvidenceRevealed(false)
      setBrowserEvidence(null)
    } catch (reason) {
      toastError(reason, t('浏览器停止失败。', 'The browser failed to stop.'))
    } finally {
      setCodingBrowserLoading(false)
    }
  }

  async function navigateCodingBrowser() {
    let initialURL = ''
    try {
      initialURL = normalizeCodingBrowserAddress(codingBrowserURL)
      setCodingBrowserURL(initialURL)
    } catch (reason) {
      setBrowserPanelError(reason instanceof Error ? reason.message : t('无法识别这个地址。', 'This address could not be recognized.'))
      return
    }
    if (!codingBrowserStatusRef.current?.enabled) {
      await startCodingBrowser()
      return
    }
    const conversationID = conversationRef.current?.id
    if (!conversationID) return
    setBrowserPanelError('')
    setCodingBrowserLoading(true)
    try {
      await invokeCommand('navigate_coding_browser', {
        conversationId: conversationID,
        targetUrl: initialURL,
      })
      window.setTimeout(() => void refreshCodingBrowserState(), 250)
    } catch (reason) {
      toastError(reason, t('页面导航失败。', 'Page navigation failed.'))
    } finally {
      setCodingBrowserLoading(false)
    }
  }

  async function mutateCodingBrowserTab(
    command: 'create_coding_browser_tab' | 'activate_coding_browser_tab' | 'close_coding_browser_tab',
    payload: Record<string, string> = {},
  ) {
    const conversationID = conversationRef.current?.id
    if (!conversationID || !codingBrowserStatusRef.current?.enabled) return
    setBrowserPanelError('')
    try {
      const status = await invokeCommand<CodingBrowserStatus>(command, {
        conversationId: conversationID,
        ...payload,
      })
      setCodingBrowserStatus(status)
      codingBrowserStatusRef.current = status
      lastCodingBrowserViewport.current = ''
      applyCodingBrowserAddress(status)
      await refreshCodingBrowserState()
      await syncCodingBrowserViewport()
    } catch (reason) {
      toastError(reason, t('标签页操作失败。', 'The tab action failed.'))
    }
  }

  async function createCodingBrowserTab() {
    if (!codingBrowserStatusRef.current?.enabled) {
      await ensureCodingBrowser()
      return
    }
    await mutateCodingBrowserTab('create_coding_browser_tab')
  }

  async function activateCodingBrowserTab(tabId: string) {
    await mutateCodingBrowserTab('activate_coding_browser_tab', { tabId })
  }

  async function closeCodingBrowserTab(tabId: string) {
    if ((codingBrowserStatusRef.current?.tabs ?? []).length <= 1) {
      await stopCodingBrowser()
      return
    }
    await mutateCodingBrowserTab('close_coding_browser_tab', { tabId })
  }

  async function runCodingBrowserNavigation(action: 'back' | 'forward' | 'reload') {
    const conversationID = conversationRef.current?.id
    if (!conversationID || !codingBrowserStatusRef.current?.enabled) return
    setBrowserPanelError('')
    try {
      await invokeCommand({
        back: 'coding_browser_go_back',
        forward: 'coding_browser_go_forward',
        reload: 'reload_coding_browser',
      }[action], { conversationId: conversationID })
      window.setTimeout(() => void refreshCodingBrowserState(), 180)
    } catch (reason) {
      toastError(reason, t('浏览器操作失败。', 'The browser action failed.'))
    }
  }

  async function revealCodingBrowserEvidence() {
    const conversationID = conversationRef.current?.id
    if (!conversationID) {
      setCodingBrowserEvidenceError(t('当前会话尚未就绪，无法定位浏览器证据。', 'This session is not ready yet, so browser evidence cannot be located.'))
      return
    }
    setCodingBrowserEvidenceError('')
    setCodingBrowserEvidenceRevealed(false)
    setCodingBrowserEvidenceLoading(true)
    try {
      await invokeCommand('reveal_coding_browser_evidence', {
        conversationId: conversationID,
      })
      setCodingBrowserEvidenceRevealed(true)
      const sessionID = codingBrowserStatusRef.current?.sessionId?.trim()
      const path = sessionID ? `.milksu/browser-evidence/${sessionID}` : ''
      setBrowserEvidence(path ? { path } : null)
    } catch (reason) {
      setCodingBrowserEvidenceError(reason instanceof Error
        ? reason.message
        : t('无法在 Finder 中显示浏览器证据。', 'Could not reveal browser evidence in Finder.'))
    } finally {
      setCodingBrowserEvidenceLoading(false)
    }
  }

  async function requestComputerUsePermissions(permission: CodingComputerUsePermission) {
    setBrowserPanelError('')
    setComputerUsePermissionError('')
    setComputerUsePermissionDialogOpen(true)
    setComputerUsePermissionRequesting(permission)
    try {
      const status = await invokeCommand<CodingComputerUseStatus>(
        'request_coding_computer_use_permissions',
        { permission },
      )
      setComputerUseStatus(status)
      computerUseStatusRef.current = status
    } catch (reason) {
      setComputerUsePermissionError(reason instanceof Error
        ? reason.message
        : t('无法请求 MilkSU 的系统权限。', 'Could not request MilkSU system permissions.'))
    } finally {
      setComputerUsePermissionRequesting(null)
    }
  }

  async function pollComputerUsePermissions() {
    if (!computerUsePermissionDialogOpenRef.current || computerUsePermissionPollingRef.current) return
    setComputerUsePermissionPolling(true)
    computerUsePermissionPollingRef.current = true
    try {
      const status = await invokeCommand<CodingComputerUseStatus>('get_coding_computer_use_status')
      setComputerUseStatus(status)
      computerUseStatusRef.current = status
      setComputerUsePermissionError('')
    } catch (reason) {
      setComputerUsePermissionError(reason instanceof Error
        ? reason.message
        : t('暂时无法读取 Computer Use 权限状态。', 'Computer Use permission status cannot be read right now.'))
    } finally {
      setComputerUsePermissionPolling(false)
      computerUsePermissionPollingRef.current = false
    }
  }

  async function handleComputerUsePermissionComplete() {
    if (computerUsePermissionCompleting) return
    setComputerUsePermissionCompleting(true)
    setComputerUsePermissionDialogOpen(false)
    try {
      await refreshBrowserPanel()
      await continueComputerUseScope()
    } finally {
      setComputerUsePermissionCompleting(false)
    }
  }

  async function startComputerUse(targetKey = selectedComputerUseTargetKeyRef.current) {
    setBrowserPanelError('')
    const target = resolveSelectedComputerUseTarget(computerUseTargetsRef.current, targetKey)
    if (!target) {
      setBrowserPanelError(t('请先选择一个当前可见的 App 窗口。', 'Choose a currently visible app window first.'))
      return
    }
    const name = workspacePathRef.current.replace(/\/+$/, '').split('/').at(-1)
    const conversationID = ensureConversation(
      name ? `${name} · ${target.name}` : t(`${target.name} 可见会话`, `${target.name} visible session`),
    )
    setComputerUseLoading(true)
    try {
      const status = await invokeCommand<CodingComputerUseStatus>(
        'start_coding_computer_use',
        computerUseStartArgs(conversationID, target),
      )
      setComputerUseStatus(status)
      computerUseStatusRef.current = status
      if (status.enabled && status.target) {
        setComputerUseEvidence({
          name: status.target.name,
          bundleId: status.target.bundleId,
          pid: status.target.pid,
          windowId: status.target.windowId,
          windowTitle: status.target.windowTitle,
        })
      }
    } catch (reason) {
      toastError(reason, t('Computer Use 可见会话启动失败。', 'The Computer Use visible session failed to start.'))
    } finally {
      setComputerUseLoading(false)
    }
    await refreshBrowserPanel()
  }

  async function stopComputerUse() {
    const conversationID = conversationRef.current?.id
    const owned = Boolean(
      computerUseStatusRef.current?.conversationId
      && computerUseStatusRef.current.conversationId === conversationID,
    )
    if (!conversationID || !owned) return
    setBrowserPanelError('')
    setComputerUseLoading(true)
    try {
      const status = await invokeCommand<CodingComputerUseStatus>(
        'stop_coding_computer_use',
        { conversationId: conversationID },
      )
      setComputerUseStatus(status)
      computerUseStatusRef.current = status
      setComputerUseEvidence(null)
    } catch (reason) {
      toastError(reason, t('Computer Use 可见会话停止失败。', 'The Computer Use visible session failed to stop.'))
    } finally {
      setComputerUseLoading(false)
    }
  }

  async function loadWorkshopState() {
    const jobId = conversationRef.current?.ctfJobId
    if (!ctfSessionRef.current || !jobId || conversationRef.current?.ctfRole === 'strategist') {
      setWorkshopState(null)
      return
    }
    try {
      setWorkshopState(await invokeCommand<CTFToolWorkshopState>(
        'get_ctf_tool_workshop_state',
        { id: jobId },
      ))
    } catch {
      setWorkshopState(null)
    }
  }

  async function loadCTFDomainProjection() {
    if (!ctfSessionRef.current) {
      setCtfProjection(null)
      return
    }
    const jobId = conversationRef.current?.ctfJobId
    if (!jobId) {
      setCtfProjection(null)
      return
    }
    try {
      const projection = await invokeCommand<CTFProjection>('get_ctf_job', { id: jobId })
      setCtfProjection(projection)
      ctfProjectionRef.current = projection
    } catch {
      // Keep the last successful projection if a mid-turn read fails.
    }
  }

  async function refreshEnvironment() {
    setEnvironmentError('')
    const errors: string[] = []
    if (ctfSessionRef.current) {
      const jobId = conversationRef.current?.ctfJobId
      if (!jobId) {
        setCtfBudget(null)
        setCtfCheckpoint(null)
      } else {
        setEnvironmentLoading(true)
        const [budget, checkpoint] = await Promise.allSettled([
          invokeCommand<CTFAgentBudgetStatus>('get_ctf_agent_budget_status', { id: jobId }),
          invokeCommand<CTFAgentRunCheckpoint | null>('get_ctf_agent_run_checkpoint', { id: jobId }),
        ])
        await loadCTFDomainProjection()
        setCtfBudget(budget.status === 'fulfilled' ? budget.value : null)
        setCtfCheckpoint(checkpoint.status === 'fulfilled' ? checkpoint.value : null)
        if (
          [budget, checkpoint].every(result => result.status === 'rejected')
          && !ctfProjectionRef.current
        ) {
          errors.push(t('暂时无法读取解题环境。', 'The challenge environment cannot be read right now.'))
        }
      }
    } else {
      setCtfBudget(null)
      setCtfCheckpoint(null)
      setCtfProjection(null)
    }
    if (!workspacePathRef.current) {
      setCodingEnvironment(null)
      codingEnvironmentRef.current = null
      setEnvironmentError(errors[0] ?? '')
      setEnvironmentLoading(false)
      return
    }
    setEnvironmentLoading(true)
    try {
      const snapshot = await invokeCommand<CodingEnvironmentSnapshot>(
        'get_coding_environment',
        { workspacePath: workspacePathRef.current },
      )
      setCodingEnvironment(snapshot)
      codingEnvironmentRef.current = snapshot
    } catch (reason) {
      setCodingEnvironment(null)
      codingEnvironmentRef.current = null
      errors.push(reason instanceof Error
        ? reason.message
        : t('暂时无法读取项目环境。', 'The project environment cannot be read right now.'))
    } finally {
      setEnvironmentLoading(false)
    }
    setEnvironmentError(errors[0] ?? '')
  }

  async function refreshMCPConfig() {
    setMcpConfigLoading(true)
    try {
      const snapshot = await invokeCommand<CodingMCPConfigSnapshot>(
        'get_coding_mcp_config',
        { workspacePath: workspacePathRef.current ?? '' },
      )
      setMcpConfig(snapshot)
      const selected = mcpServersRef.current ?? []
      if (!selected.length) return
      const available = new Set(snapshot.servers.map(server => server.name))
      const selectionIsStale = mcpConfigDigestRef.current !== snapshot.digest
        || selected.some(server => !available.has(server))
      if (selectionIsStale) onChangeMcpServers?.([], '')
    } catch (reason) {
      setMcpConfig({
        workspace: workspacePathRef.current,
        configured: false,
        servers: [],
        problem: reason instanceof Error
          ? reason.message
          : t('暂时无法读取项目 MCP 配置。', 'Project MCP config cannot be read right now.'),
      })
      if ((mcpServersRef.current ?? []).length) onChangeMcpServers?.([], '')
    } finally {
      setMcpConfigLoading(false)
    }
  }

  async function refreshContextPanel(panel = contextPanelRef.current) {
    if (panel === 'artifacts') {
      await artifactPanel.current?.refresh()
      return
    }
    if (['browser', 'computer-use'].includes(panel)) {
      await refreshBrowserPanel()
      return
    }
    await Promise.all([
      refreshEnvironment(),
      loadWorkshopState(),
      refreshMCPConfig(),
    ])
  }

  function changeContextPanel(value: string) {
    if (!contextPanelValues.some(panel => panel === value)) return
    if (value === 'collaboration' && !ctfSessionRef.current) return
    setContextPanel(value as ContextPanel)
    setEnvironmentOpen(true)
    void refreshContextPanel(value as ContextPanel)
  }

  function openChanges(path = '') {
    if (dockSurfaceRef.current) return
    setChangesFocusPath(path)
    changeContextPanel('changes')
  }

  function recordArtifactPreview(preview: CodingArtifactPreview) {
    setArtifactPreviewEvidence({
      relativePath: preview.relativePath,
      kind: preview.kind,
    })
  }

  function requestTool() {
    onCtfAction?.({
      kind: 'handoff',
      prompt: '检查 notes.md 当前真正的阻塞点。如果确实需要一个可重复使用的辅助工具，请按 TOOLING.md 在 work/tool-requests/ 新建一个 status: pending 的最小请求，写清单一假设、输入输出契约、验收条件、fixture 和安全边界；这一步只写请求，不实现工具。若一次性命令已足够，请说明为什么不需要委托 Coding Agent。',
    })
  }

  function verifyDeliveredTool() {
    onCtfAction?.({
      kind: 'handoff',
      prompt: '读取 work/tool-requests/ 中最新的 ready 请求和对应的 work/tools/ 实现。不要相信交付声明本身：独立运行验收测试，用当前题目材料验证输出契约，把命令、关键输出、结论和限制写入 notes.md，再决定是否把工具用于下一步解题。',
    })
  }

  function sendComposerMessage(
    prompt: string,
    visibleText?: string,
    attachments?: CodingAttachment[],
    scopeToken?: 'browser-use' | 'computer-use',
    productAction?: CodingProductActionRequest,
  ) {
    setGoalMode(false)
    if (scopeToken === 'browser-use' && !browserUseReadyForCurrentTask) {
      showBrowserUseScope()
      return
    }
    if (scopeToken === 'computer-use' && !externalAppUseReadyForCurrentTask) {
      void showComputerUseScope()
      return
    }
    const stagedPrompt = stagedComposerPrompt
    const submittedPrompt = stagedPrompt
      && stagedPrompt.conversationId === conversation?.id
      && stagedPrompt.prompt !== prompt
      ? `${stagedPrompt.prompt}\n\n用户当前请求：${prompt}`
      : prompt
    setStagedComposerPrompt(null)
    const scopedPrompt = scopeToken === 'browser-use'
      ? `本轮通过 Playwright MCP 官方扩展请求连接真实用户浏览器；首次调用时等我在 Chrome/Edge 里选择并批准准确标签页。只操作扩展返回的标签页，不要改用 MilkSU 内置浏览器或 Computer Use。\n\n${submittedPrompt}`
      : scopeToken === 'computer-use'
        ? `本轮使用已锁定的可见 App 窗口完成请求；若尚未接入准确窗口，先停下让我选择。\n\n${submittedPrompt}`
        : submittedPrompt
    onSend?.(scopedPrompt, visibleText, attachments, scopeToken, productAction)
  }

  function controlComposerGoal(action: 'pause' | 'resume' | 'clear') {
    if (action === 'pause' && running) {
      onAbort?.()
      return
    }
    onControlGoal?.(action)
  }

  function resumeAfterFailure() {
    if (running || (!recoverableFailureId && !emptyVisibleReply)) return
    const lastUserMessage = [...(conversation?.messages ?? [])]
      .reverse()
      .find(message => message.role === 'user')
    onSend?.(
      emptyVisibleReply ? emptyVisibleReplyRecoveryPrompt() : agentRecoveryPrompt(ctfSession),
      t('继续', 'Continue'),
      lastUserMessage?.attachments,
    )
  }

  function changeModel(value: string) {
    const parsed = parseComposerModelKey(value)
    if (parsed.mode === 'auto') {
      onChangeModel?.('auto')
      return
    }
    if (parsed.providerId && parsed.model) {
      if (parsed.source === 'account' || parsed.source === 'personal') {
        onChangeModelSource?.(parsed.source)
      }
      onChangeModel?.('manual', parsed.providerId, parsed.model)
    }
  }

  function changeExecutionMode(value: string) {
    if (agentKernel === 'dsh') {
      void conversations.toggleDshPlanMode(value === 'plan')
      return
    }
    onChangeCodingPolicy?.(normalizeCodingExecutionMode(value), effectiveApprovalPolicy)
  }

  function changeApprovalPolicy(value: string) {
    onChangeCodingPolicy?.(effectiveExecutionMode, normalizeCodingApprovalPolicy(value))
  }

  function toggleMCPServer(server: CodingMCPConfigSnapshot['servers'][number]) {
    if (server.scope === 'user') return
    if (running || !mcpConfig?.digest || !server.reviewReady) return
    const selection = new Set(selectedMCPServers)
    if (selection.has(server.name)) selection.delete(server.name)
    else selection.add(server.name)
    onChangeMcpServers?.(
      [...selection].sort((left, right) => left.localeCompare(right)),
      mcpConfig.digest,
    )
  }

  async function openPlaywrightBrowserExtension() {
    setBrowserPanelError('')
    try {
      await invokeCommand('open_playwright_browser_extension')
    } catch (reason) {
      toastError(reason, t('无法打开 Playwright MCP 官方扩展页面。', 'Could not open the official Playwright MCP extension page.'))
    }
  }

  function branchFromAssistantMessage(messageId: string) {
    if (sessionTreeUnavailable) return
    onBranchAssistant?.(messageId)
  }

  function runSlashCommand(command: string) {
    if (command === 'new') {
      onNewConversation?.()
      return
    }
    if (command === 'compact') {
      onCompactContext?.()
      return
    }
    if (command === 'rewind') {
      if (rewindUnavailable) return
      onRewindContext?.()
      return
    }
    if (command === 'handoff') {
      onHandoffContext?.()
      return
    }
    if (command === 'mcp' && dockSurface) {
      composer.current?.openAddMenu?.()
      return
    }
    if (['understand', 'test', 'review', 'fix', 'summary'].includes(command)) {
      void runCodingProductAction(command as CodingProductActionKind)
      return
    }
    if (command === 'browser') {
      revealBuiltInBrowser()
      return
    }
    if (command === 'browser-use') {
      showBrowserUseScope()
      return
    }
    if (command === 'computer-use') {
      void showComputerUseScope()
      return
    }
    const panel = ({
      status: 'environment',
      diff: 'changes',
      mcp: 'environment',
    } as const)[command as 'status' | 'diff' | 'mcp']
    if (panel) changeContextPanel(panel)
  }

  function chooseWorkspaceFromCurrentTask() {
    if (workspaceLocked) {
      onChooseWorkspaceForNewTask?.()
      return
    }
    onChooseWorkspace?.()
  }

  async function loadProjectMemory() {
    try {
      setProjectMemory(await invokeCommand<CodingProjectMemory>('get_coding_project_memory'))
    } catch {
      // New-chat recents stay empty until Desktop RPC is available.
    }
  }

  function selectRecentProject(path: string) {
    const next = path.trim()
    if (!next) return
    onSelectWorkspace?.(next)
  }

  async function forgetRecentProject(path: string) {
    try {
      setProjectMemory(await invokeCommand<CodingProjectMemory>('forget_coding_project', { path }))
    } catch {
      await loadProjectMemory()
    }
    onForgetWorkspace?.(path)
  }

  async function applyGitBranchAction(action: 'checkout' | 'create-branch', branch: string) {
    const workspace = workspacePath
    const next = branch.trim()
    if (!workspace || !next || running) return
    if (action === 'checkout' && next === gitBranch) return
    setGitBranchError('')
    try {
      const result = await invokeCommand<CodingGitActionResult>('apply_coding_git_action', {
        workspacePath: workspace,
        action,
        relativePath: next,
        message: '',
      })
      if (result?.snapshot) {
        setCodingEnvironment(result.snapshot)
        codingEnvironmentRef.current = result.snapshot
      } else {
        await refreshEnvironment()
      }
    } catch (reason) {
      const fallback = action === 'create-branch'
        ? t('无法创建分支。', 'Could not create the branch.')
        : t('无法切换分支。', 'Could not switch branches.')
      setGitBranchError(reason instanceof Error ? reason.message : fallback)
    }
  }

  async function runCodingProductAction(kind: CodingProductActionKind) {
    if (!workspacePath) {
      onChooseWorkspace?.()
      return
    }
    if (running) return
    const action = codingProductAction(kind)
    setContextPanel(action.panel)
    setEnvironmentOpen(true)
    onChangeCodingPolicy?.(
      action.executionMode,
      action.approvalPolicy ?? effectiveApprovalPolicy,
    )
    let prompt = action.prompt
    if (kind === 'review') {
      await refreshEnvironment()
      const environment = codingEnvironmentRef.current
      if (!environment?.git.isRepository) {
        setEnvironmentError(environment?.git.problem
          || t('当前目录不是 Git 仓库，无法审阅变更。', 'This directory is not a Git repository, so changes cannot be reviewed.'))
        return
      }
      const changes = environment.git.changes ?? []
      const diffResults = await Promise.allSettled(
        changes.slice(0, 20).map(change => invokeCommand<CodingDiffSnapshot>(
          'get_coding_diff',
          { workspacePath, relativePath: change.path },
        )),
      )
      const diffs = diffResults.flatMap(result => (
        result.status === 'fulfilled' ? [result.value] : []
      ))
      prompt = codingReviewPrompt(prompt, environment, diffs)
    }
    onSend?.(prompt, action.visibleText, undefined, undefined, { kind })
  }

  function noteTranscriptInteraction() {
    transcriptInteractionUntil.current = Date.now() + 250
  }

  function restoreTranscriptScroll(beforeHeight: number, beforeTop: number) {
    const element = scrollArea.current
    if (!element) return
    if (chatAutoScrollPinned.current) {
      element.scrollTop = element.scrollHeight
    } else {
      element.scrollTop = beforeTop + Math.max(0, element.scrollHeight - beforeHeight)
    }
    lastChatScrollTop.current = element.scrollTop
  }

  const scheduleTranscriptRefill = useCallback((delay = 64) => {
    if (transcriptRefillTimer.current) return
    if (mountedTranscriptBlocksRef.current >= transcriptMountLimit(chatTranscriptLengthRef.current)) return
    transcriptRefillTimer.current = window.setTimeout(() => {
      transcriptRefillTimer.current = 0
      if (mountedTranscriptBlocksRef.current >= transcriptMountLimit(chatTranscriptLengthRef.current)) return
      if (Date.now() < transcriptInteractionUntil.current) {
        scheduleTranscriptRefill(160)
        return
      }
      const element = scrollArea.current
      pendingTranscriptRestore.current = {
        height: element?.scrollHeight ?? 0,
        top: element?.scrollTop ?? 0,
      }
      setMountedTranscriptBlocks(current => Math.min(
        chatTranscriptLengthRef.current,
        current + TRANSCRIPT_REFILL_CHUNK,
      ))
      scheduleTranscriptRefill(64)
    }, delay)
  }, [])

  function mountEarlierTranscriptBlocks(count: number) {
    const element = scrollArea.current
    pendingTranscriptRestore.current = {
      height: element?.scrollHeight ?? 0,
      top: element?.scrollTop ?? 0,
    }
    // 上限内照旧扩窗 ✓；到上限就**不再多挂**（再多挂 = 页面变重 ✗）
    setMountedTranscriptBlocks(current => Math.min(
      transcriptMountLimit(chatTranscript.length),
      current + count,
    ))
  }

  // 读者点「更早的 N 段」：窗口整体往回挪（不是多挂 ✗）⇒ 更早的内容看得到 ✓、页面不变重 ✓
  function showEarlierTranscript() {
    const limit = transcriptMountLimit(chatTranscriptLengthRef.current)
    setTranscriptWindowShift(current => Math.min(
      current + TRANSCRIPT_OLDER_CHUNK,
      Math.max(0, chatTranscriptLengthRef.current - limit),
    ))
    const element = scrollArea.current
    if (element) {
      pendingTranscriptRestore.current = null
      element.scrollTop = 0
    }
  }

  function handleChatScroll() {
    const element = scrollArea.current
    if (!element) return
    noteTranscriptInteraction()
    if (element.scrollTop <= 8 && hiddenTranscriptBlocks > 0) {
      mountEarlierTranscriptBlocks(TRANSCRIPT_TOP_REFILL_CHUNK)
    }
    // 我们自己发起的跟随滚动不能被当成“读者往上翻”——长内容里这个误判会永久关掉跟随。
    if (Date.now() > programmaticScrollUntil.current) {
      chatAutoScrollPinned.current = nextChatAutoScrollPinned(
        lastChatScrollTop.current,
        element.scrollTop,
        element.clientHeight,
        element.scrollHeight,
      )
    }
    // 只有读者真的往上翻了才露出「回到最新」✓；贴着底部时它不该站位置 ✗（读者要求 ✓）。
    setJumpToLatestVisible(!chatAutoScrollPinned.current)
    lastChatScrollTop.current = element.scrollTop
  }

  async function scrollChatToBottom(force = false) {
    if (!force && !chatAutoScrollPinned.current) return
    // 正在看历史（窗口往回挪过）时，只要回到“贴底”就把窗口挪回最新 ✓，否则新消息会被挡在窗口外 ✗
    if (transcriptWindowShiftRef.current > 0) setTranscriptWindowShift(0)
    // 点了「回到最新」就是要回到底部 ⇒ 按钮随之收起 ✓
    setJumpToLatestVisible(false)
    // 长内容会在滚动之后继续变高（markdown、代码块、图片、分批挂载）——
    // 只转两帧就收手会停在半路，之后就被判成“离底部太远”而不再跟随。
    // 所以少量重试，直到真的贴到底（最多 6 帧）。
    for (let pass = 0; pass < 6; pass += 1) {
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
      if (!force && !chatAutoScrollPinned.current) return
      const element = scrollArea.current
      if (!element) return
      // force 时**不看**这个判断：首屏时屏幕外内容用的是**估算高度**（`content-visibility` 的
      // `contain-intrinsic-size`）⇒ “已经到底”会看走眼 ⇒ 视图停在对话**中部**（真事：每次重开
      // 都要手动拖回底部 ✗）。强制时把这几帧走完（上限 6 帧 ⇒ 有界、代价极小 ✓）。
      if (!force && !chatNeedsAnotherFollowScroll(element.scrollTop, element.clientHeight, element.scrollHeight)) return
      programmaticScrollUntil.current = Date.now() + 200
      element.scrollTop = element.scrollHeight
      lastChatScrollTop.current = element.scrollTop
    }
  }

  function refreshComputerUseAfterSettings() {
    if (computerUsePermissionDialogOpenRef.current) {
      void pollComputerUsePermissions()
      return
    }
    const status = computerUseStatusRef.current
    if (!status || (
      status.permissions.accessibility
      && status.permissions.screenRecording
    )) return
    void refreshBrowserPanel()
  }

  function handleBrowserAddressKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') {
      event.preventDefault()
      void navigateCodingBrowser()
    }
  }

  function handleTabCloseKeyDown(
    event: KeyboardEvent<HTMLSpanElement>,
    tabId: string,
  ) {
    if (event.key !== 'Enter') return
    event.preventDefault()
    if (tabId === 'current') void stopCodingBrowser()
    else void closeCodingBrowserTab(tabId)
  }

  useLayoutEffect(() => {
    const pending = pendingTranscriptRestore.current
    if (!pending) return
    pendingTranscriptRestore.current = null
    restoreTranscriptScroll(pending.height, pending.top)
  }, [mountedTranscriptBlocks, visibleTranscript.length])

  useEffect(() => {
    void refreshUserSkills()
    void loadProjectMemory()
    void scrollChatToBottom(true)
    if (conversationRef.current?.id && !runningRef.current) void refreshBrowserPanel()
    const pendingReveal = takeComputerUseReveal()
    if (pendingReveal && !dockSurfaceRef.current) {
      void showComputerUseScope(pendingReveal.preferEmulator)
    }
    window.addEventListener('focus', refreshComputerUseAfterSettings)
    let stopBrowserReady: (() => void) | undefined
    let stopWorkspaceReveal: (() => void) | undefined
    void listenEvent<CodingBrowserStatus>('coding-browser.ready', event => {
      const status = event.payload
      if (status?.conversationId && status.conversationId !== conversationRef.current?.id) return
      if (status?.enabled) {
        setCodingBrowserStatus(status)
        codingBrowserStatusRef.current = status
      }
      revealBuiltInBrowser()
    }).then(stop => {
      stopBrowserReady = stop
    })
    void listenEvent<{
      conversationId?: string
      panel?: string
      artifactPath?: string
      changePath?: string
      terminal?: string
    }>('coding-workspace.reveal', event => {
      applyWorkspaceReveal(event.payload)
    }).then(stop => {
      stopWorkspaceReveal = stop
    })
    if (typeof ResizeObserver !== 'undefined') {
      codingBrowserResizeObserver.current = new ResizeObserver(() => {
        lastCodingBrowserViewport.current = ''
        void syncCodingBrowserViewport()
      })
      if (codingBrowserViewport.current) {
        codingBrowserResizeObserver.current.observe(codingBrowserViewport.current)
      }
    }
    const statusTimer = window.setInterval(() => {
      if (environmentOpenRef.current && contextPanelRef.current === 'browser') {
        void refreshCodingBrowserState()
      }
    }, 750)
    return () => {
      stopBrowserReady?.()
      stopWorkspaceReveal?.()
      void hideCodingBrowserViewport()
      window.removeEventListener('focus', refreshComputerUseAfterSettings)
      codingBrowserResizeObserver.current?.disconnect()
      window.clearInterval(statusTimer)
      if (transcriptRefillTimer.current) window.clearTimeout(transcriptRefillTimer.current)
    }
    // Mount-only listeners; live values are read from refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const viewport = codingBrowserViewport.current
    const observer = codingBrowserResizeObserver.current
    if (!observer || !viewport) return
    observer.observe(viewport)
    lastCodingBrowserViewport.current = ''
    void syncCodingBrowserViewport()
    return () => observer.unobserve(viewport)
  }, [environmentOpen, contextPanel, codingBrowserStatus?.enabled])

  useEffect(() => {
    let timer: number | undefined
    if (running && turnStatus?.runStartedAt !== undefined) {
      setRunClockNow(Date.now())
      timer = window.setInterval(() => setRunClockNow(Date.now()), 1000)
    }
    return () => {
      if (timer !== undefined) window.clearInterval(timer)
    }
  }, [running, turnStatus?.runStartedAt])

  useEffect(() => {
    const conversationId = conversation?.id ?? ''
    if (!conversationId) return
    const current = chatActivityExpansion.get(conversationId)
    if (!current) return
    const pruned = pruneChatActivityExpansion(current, chatTranscript)
    if (pruned !== current) applyActivityExpansion(pruned)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatTranscript, conversation?.id])

  useEffect(() => {
    let clock = 0
    const waiting = waitingForModel && !compacting
    const ticking = waiting || running
    if (!waiting) {
      setWaitingStartedAt(null)
    }
    if (!ticking) return
    if (waiting) setWaitingStartedAt(Date.now())
    setWaitingNow(Date.now())
    clock = window.setInterval(() => setWaitingNow(Date.now()), 1000)
    return () => window.clearInterval(clock)
  }, [waitingForModel, compacting, running])

  const previousTranscriptLength = useRef(0)
  // 上一次“打开的对话”——用来区分“刚打开/切换对话”（要无条件贴底 ✓）与“同一对话里内容增长”
  // （按读者的意愿跟随 ✓）。
  const openedConversationId = useRef('')
  useEffect(() => {
    const conversationId = conversation?.id ?? ''
    const length = chatTranscript.length
    if (lastConversationIdForTranscript.current !== conversationId) {
      lastConversationIdForTranscript.current = conversationId
      previousTranscriptLength.current = length
      setMountedTranscriptBlocks(Math.min(length, TRANSCRIPT_INITIAL_BLOCKS))
      setTranscriptWindowShift(0)
    } else {
      const delta = Math.max(0, length - previousTranscriptLength.current)
      previousTranscriptLength.current = length
      // 读者正在看历史（窗口挪过）⇒ 窗口跟着一起挪，别把他推走 ✓
      if (delta > 0 && transcriptWindowShiftRef.current > 0) {
        setTranscriptWindowShift(current => current + delta)
      }
      setMountedTranscriptBlocks(current => Math.min(transcriptMountLimit(length), current + delta))
    }
    chatTranscriptLengthRef.current = length
    scheduleTranscriptRefill()
  }, [conversation?.id, chatTranscript.length, scheduleTranscriptRefill])

  useEffect(() => {
    if (environmentOpen && contextPanel === 'browser') {
      void syncCodingBrowserViewport()
    } else {
      void hideCodingBrowserViewport()
    }
  }, [environmentOpen, contextPanel])

  useEffect(() => {
    // 刚打开/切换对话时**无条件**贴到底：首屏内容还没量完，“已经到底”的判断靠不住 ✓。
    const nextId = conversation?.id ?? ''
    const justOpened = openedConversationId.current !== nextId
    openedConversationId.current = nextId
    void scrollChatToBottom(justOpened)
  }, [conversation?.messages.length, conversation?.id, ctfSession, vulnerabilitySession])

  // 内容增长（不只是消息条数变化）也要跟随。不跟随的话，输出在往下长、视图不动，
  // 中间那段空白看起来就像“引擎没响应”。scrollChatToBottom 自己会先判断是否
  // 还贴着底部（chatAutoScrollPinned），用户手动往上滚之后不会把他拽回去。
  useEffect(() => {
    void scrollChatToBottom()
  }, [transcriptContentRevision])

  const skipDomainPanelReset = useRef(true)
  useEffect(() => {
    if (skipDomainPanelReset.current) {
      skipDomainPanelReset.current = false
      return
    }
    if (contextPanelRef.current === 'domain') setContextPanel('environment')
  }, [ctfSession, vulnerabilitySession])

  useEffect(() => {
    const draft = pendingComposerDraft
    if (!draft?.prompt) return
    const frame = requestAnimationFrame(() => {
      setStagedComposerPrompt({
        conversationId: conversation?.id ?? '',
        prompt: draft.prompt,
      })
      composer.current?.appendDraftText(draft.visibleText || draft.prompt)
      onConsumePendingDraft?.()
    })
    return () => cancelAnimationFrame(frame)
  }, [pendingComposerDraft, conversation?.id, onConsumePendingDraft])

  const previousConversationId = useRef(conversation?.id)
  useEffect(() => {
    const previous = previousConversationId.current
    previousConversationId.current = conversation?.id
    if (previous && previous !== conversation?.id && codingBrowserStatusRef.current?.enabled) {
      void hideCodingBrowserViewport(previous)
    }
    if (previous === conversation?.id) return
    setGoalMode(false)
    setCodingBrowserStatus(null)
    codingBrowserStatusRef.current = null
    setCodingBrowserEvidenceError('')
    setCodingBrowserEvidenceRevealed(false)
    setArtifactPreviewEvidence(null)
    setBrowserEvidence(null)
    setComputerUseEvidence(null)
    setComputerUsePermissionDialogOpen(false)
    setComputerUsePermissionRequesting(null)
    setComputerUsePermissionError('')
    chatAutoScrollPinned.current = true
    setJumpToLatestVisible(false)
    lastChatScrollTop.current = 0
    void scrollChatToBottom(true)
    if (conversation?.id && !running) void refreshBrowserPanel()
    if (['browser', 'browser-use', 'computer-use'].includes(contextPanel) && environmentOpen) {
      void refreshBrowserPanel()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversation?.id])

  useEffect(() => {
    void refreshMCPConfig()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctfSession, workspacePath])

  useEffect(() => {
    if (!shouldRememberCodingProject(workspacePath)) return
    void invokeCommand<CodingProjectMemory>('remember_coding_project', { path: workspacePath })
      .then(memory => setProjectMemory(memory))
      .catch(() => undefined)
  }, [workspacePath])

  const previousContextPanel = useRef(contextPanel)
  useEffect(() => {
    const previous = previousContextPanel.current
    previousContextPanel.current = contextPanel
    if (previous === 'browser' && contextPanel !== 'browser') void hideCodingBrowserViewport()
    if (['browser', 'browser-use', 'computer-use'].includes(contextPanel) && environmentOpen) {
      void refreshBrowserPanel()
    }
    if (['artifacts', 'changes'].includes(contextPanel) && environmentOpen) void refreshEnvironment()
    if (contextPanel === 'browser' && environmentOpen) {
      void ensureCodingBrowser().then(() => {
        requestAnimationFrame(() => void syncCodingBrowserViewport())
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contextPanel, environmentOpen])

  useEffect(() => {
    if (ctfSession && conversation?.ctfJobId) {
      void loadCTFDomainProjection()
      return
    }
    if (!ctfSession) setCtfProjection(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctfSession, conversation?.ctfJobId])

  useEffect(() => {
    if (ctfSession && conversation?.ctfJobId && !running) {
      void Promise.all([loadWorkshopState(), refreshEnvironment()])
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctfSession, conversation?.ctfJobId, ctfRole, running])

  useEffect(() => {
    if (!running) void refreshEnvironment()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctfSession, conversation?.id, workspacePath, running])

  const contextPanelIcon = contextPanel === 'environment'
    ? <Activity className="size-4" />
    : contextPanel === 'changes'
      ? <FileDiff className="size-4" />
      : contextPanel === 'artifacts'
        ? <FileImage className="size-4" />
        : contextPanel === 'browser'
          ? <Globe2 className="size-4" />
          : contextPanel === 'collaboration'
            ? <Wrench className="size-4" />
            : <CircleDot className="size-4" />

  return (
    <section
      className={cn(
        'chat-page relative flex min-w-0 flex-1 flex-col bg-surface-editor',
        dockSurface ? 'chat-surface-dock min-h-0 min-w-0 overflow-hidden' : 'overflow-hidden',
        className,
      )}
      data-agent-conversation
      data-testid={dockSurface ? 'coding-agent-dock-surface' : undefined}
    >
      <div className="coding-workspace relative flex min-h-0 min-w-0 flex-1 overflow-hidden">
        <main className="chat-main flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-surface-editor">
          {!dockSurface ? (
            <WorkspaceModuleTopBar
              module={topbarModule}
              title={topbarPresentation.title}
              subtitle={topbarPresentation.subtitle}
              hideIdentity={codingDraftIdle}
              actions={(
                <>
                  {restorable ? (
                    <button
                      type="button"
                      className="agent-chrome-icon"
                      aria-label={t('还原小窗', 'Restore window')}
                      title={t('还原小窗', 'Restore window')}
                      onClick={() => onRestore?.()}
                    >
                      <Minimize2 className="size-4" />
                    </button>
                  ) : null}
                  {!environmentOpen ? (
                    <>
                      <button
                        type="button"
                        className="agent-chrome-icon"
                        aria-label={terminalOpen ? t('关闭底部终端', 'Close bottom terminal') : t('打开底部终端', 'Open bottom terminal')}
                        title={terminalOpen ? t('关闭底部终端', 'Close bottom terminal') : t('打开底部终端', 'Open bottom terminal')}
                        onClick={toggleTerminalPanel}
                      >
                        <SquareTerminal className="size-4" />
                      </button>
                      <button
                        type="button"
                        className="agent-chrome-icon"
                        data-testid="coding-rail-toggle"
                        aria-label={t('打开右侧栏', 'Open right rail')}
                        title={t('打开右侧栏', 'Open right rail')}
                        onClick={toggleManualContextSidebar}
                      >
                        <PanelRightOpen className="size-4" />
                      </button>
                    </>
                  ) : null}
                </>
              )}
            />
          ) : null}

          <div
            className={cn(
              'flex min-h-0 min-w-0 flex-1 flex-col',
              emptyCanvas ? 'chat-empty-canvas justify-center overflow-x-hidden overflow-y-auto' : 'overflow-hidden',
            )}
          >
          {!emptyCanvas ? (
          <div
            ref={scrollArea}
            className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto"
            onScroll={handleChatScroll}
          >
            {/* 搬运自本地分支（C）：别的对话交过来的提示。只读、可关闭，永远不入 messages。 */}
            {conversations.activeCrossConversationNotices.map(notice => (
              <CrossConversationNotice
                key={notice.id}
                notice={notice}
                onOpen={sourceId => {
                  conversations.activeId = sourceId
                }}
                onDismiss={id => conversations.dismissCrossConversationNotice(id)}
              />
            ))}
            {streamStale || queuedBehindLabel ? (
              <div
                className={cn(
                  'mx-auto mb-2 w-[72%] rounded-xl border px-3 py-1.5 text-caption',
                  stuckTurn
                    ? 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300'
                    : 'border-border/70 bg-muted/50 text-muted-foreground',
                )}
                data-testid="stream-stale"
              >
                {queuedBehindLabel ? (
                  <span data-testid="queued-behind">
                    {t(
                      `排队中：同工作区「${queuedBehindLabel}」正在运行。`,
                      `Queued: "${queuedBehindLabel}" in this workspace is running.`,
                    )}
                  </span>
                ) : runningToolActive ? (
                  t(
                    `工具执行中…（已 ${streamStaleSeconds}s 无输出）`,
                    `Tool running… (${streamStaleSeconds}s without output)`,
                  )
                ) : stuckTurn ? (
                  <span className="flex flex-wrap items-center gap-2">
                    <span>{t(`引擎 ${streamStaleSeconds}s 没有响应。`, `The engine has not answered for ${streamStaleSeconds}s.`)}</span>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      data-testid="cancel-stuck-turn"
                      onClick={() => void conversations.forceStopConversation(conversation?.id ?? '')}
                    >
                      {t('取消该回合', 'Cancel this turn')}
                    </Button>
                  </span>
                ) : (
                  t(`等待中（已 ${streamStaleSeconds}s）`, `Waiting… (${streamStaleSeconds}s)`)
                )}
              </div>
            ) : null}
            {engineNotice ? (
              <div
                className="mx-auto mb-2 w-[72%] rounded-xl border border-border/70 bg-muted/50 px-3 py-1.5 text-caption text-muted-foreground"
                data-testid="engine-notice"
              >
                {engineNotice}
                {(engineNoticeRepeat ?? 0) > 1 ? (
                  <span data-testid="engine-notice-repeat">
                    {t(`（重复 ${engineNoticeRepeat} 次）`, ` (x${engineNoticeRepeat})`)}
                  </span>
                ) : null}
              </div>
            ) : null}
            {/* 「这个对话遇到了问题」（上一轮被强停 / Agent 运行失败）：**常驻在顶部**（就是「批准」
                那个槽位）。不自动消失；读者可以点「知道了」立刻消除，或者发下一条消息（开新一回合）
                自动消除。侧栏同时亮红叉（ContextSidebar）。
                底色必须**不透明**：半透明底在深色／花哨背景上基本读不清（读者真机反馈）。 */}
            {conversations.activeProblemTurn ? (
              <div
                className="sticky top-0 z-30 mx-auto mb-2 flex w-[72%] items-start gap-2 rounded-xl border border-red-500 bg-red-50 px-3 py-2 text-caption text-red-900 shadow-sm dark:bg-red-950 dark:text-red-100"
                data-testid="problem-bar"
                role="status"
              >
                <span className="min-w-0 flex-1">
                  {t(
                    conversations.activeProblemTurn.notice || conversations.activeProblemTurn.noticeEnglish,
                    conversations.activeProblemTurn.noticeEnglish || conversations.activeProblemTurn.notice,
                  )}
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  data-testid="dismiss-problem-bar"
                  onClick={() => conversations.dismissProblemTurn()}
                >
                  {t('知道了', 'Dismiss')}
                </Button>
              </div>
            ) : null}
            {pendingApprovalMessage ? (
              <div
                className="sticky top-0 z-30 mx-auto mb-2 flex w-[72%] items-center gap-2 rounded-xl border border-primary/40 bg-background/95 px-3 py-2 shadow-sm"
                data-testid="approval-bar"
              >
                <span className="min-w-0 flex-1 truncate text-caption font-medium text-foreground">
                  {t('待批准：', 'Waiting for approval: ')}{approvalSummary}
                </span>
                {approvalSubmitting ? (
                  <span className="shrink-0 text-caption text-muted-foreground" data-testid="approval-bar-submitting">
                    {t('处理中…', 'Working…')}
                  </span>
                ) : approvalError ? (
                  <span className="shrink-0 text-caption text-destructive">{approvalError}</span>
                ) : approvalUnverified ? (
                  <span className="shrink-0 text-caption font-medium text-destructive" data-testid="approval-bar-gate">
                    {t('范围未核验，仍可确认', 'Unverified scope; you can still confirm')}
                  </span>
                ) : null}
                <Button type="button" variant="outline" size="sm" disabled={approvalSubmitting} data-testid="approval-bar-deny" onClick={() => submitApproval(false)}>
                  {t('拒绝', 'Deny')}
                </Button>
                <Button type="button" size="sm" disabled={approvalSubmitting} data-testid="approval-bar-allow" onClick={() => submitApproval(true)}>
                  {t('允许这一次', 'Allow once')}
                </Button>
              </div>
            ) : null}
              <div
                className={cn('agent-thread min-w-0', dockSurface ? 'agent-thread--dock' : '')}
                onContextMenu={openQuoteMenu}
              >
                {quoteSelection ? (
                  <ConversationQuoteMenu
                    text={quoteSelection.text}
                    x={quoteSelection.x}
                    y={quoteSelection.y}
                    onAdd={text => {
                      composer.current?.appendQuote(text)
                      setQuoteSelection(null)
                    }}
                    onDismiss={() => setQuoteSelection(null)}
                  />
                ) : null}
                {hiddenTranscriptBlocks > 0 && transcriptWindow.atCap ? (
                  <div className="flex justify-center py-2" data-testid="transcript-earlier">
                    <button
                      type="button"
                      className="rounded-full border px-3 py-1 text-xs opacity-70 hover:opacity-100"
                      onClick={showEarlierTranscript}
                    >
                      {t(
                        `更早的 ${hiddenTranscriptBlocks} 段内容 · 点开看`,
                        `${hiddenTranscriptBlocks} earlier blocks · open`,
                      )}
                    </button>
                  </div>
                ) : null}
                {visibleTranscript.map(item => (
                  item.kind === 'process' ? (
                    <ChatProcessFold
                      protectedFolders={protectedFolders}
                      key={item.id}
                      process={item}
                      recoverableFailureId={recoverableFailureId}
                      recoveryContext={ctfSession ? 'ctf' : 'coding'}
                      rewindableUserMessageId={rewindableUserMessageId}
                      rewindDisabled={rewindUnavailable}
                      kernel={agentKernel}
                      activityOpen={chatActivityGroupIsOpen}
                      activityOpenEntries={chatActivityOpenEntries}
                      subagentTasks={conversation?.subagentTasks}
                      memoKey={transcriptMemoKey}
                      onToggleGroup={handleActivityGroupToggle}
                      onToggleEntry={handleActivityEntryToggle}
                      onRespondApproval={(requestId, approved, scope, choice) => onRespondApproval?.(requestId, approved, scope, choice)}
                      onRetry={resumeAfterFailure}
                      onEditUser={(messageId, content) => onEditUser?.(messageId, content)}
                      onRewindContext={() => onRewindContext?.()}
                      onBranchAssistant={branchFromAssistantMessage}
                    />
                  ) : item.kind === 'activity' ? (
                    <ChatActivityGroup
                      key={item.id}
                      activity={item}
                      open={chatActivityGroupIsOpen(item.id)}
                      openEntryIds={chatActivityOpenEntries(item.id)}
                      subagentTasks={conversation?.subagentTasks}
                      onToggleGroup={open => handleActivityGroupToggle(item.id, open)}
                      onToggleEntry={(entryId, open) => handleActivityEntryToggle(item.id, entryId, open)}
                    />
                  ) : (
                    <MemoChatMessageItem
                      key={item.id}
                      message={item.message}
                      recoverable={item.message.id === recoverableFailureId}
                      recoveryContext={ctfSession ? 'ctf' : 'coding'}
                      canRewind={item.message.id === rewindableUserMessageId}
                      rewindDisabled={rewindUnavailable}
                      kernel={agentKernel}
                      {...transcriptHandlers}
                      // 本机偏好（**故意不上游**）：思考段**默认收起**，包括「刚结束的那一段」。
                      // 以前是「最新一段思考自动展开」（`thinkingStaysOpen`）⇒ 每轮思考一完就撑开一次，
                      // 观感上就是页面一直在跳（用户原话）。点击仍可展开/收起 ✓。
                      thinkingDefaultOpen={false}
                      thinkingFoldKey={thinkingFoldKey}
                    />
                  )
                ))}
                {/* 守卫示警（受保护路径被拦等）：**放在转写末尾** —— 拦截会把回合停掉，
                    而读者就停在底部看；放到顶部的提示都在屏幕外（真事：读者只看到
                    「这一轮没有可见正文」，以为没有任何提示）。 */}
                {conversations.activeGuardNotices.map(notice => (
                  <div
                    key={notice.id}
                    className="agent-turn mb-4 flex w-full items-start gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-caption text-amber-700 dark:text-amber-300"
                    data-testid="guard-notice"
                  >
                    <span className="flex-1">
                      {t(notice.notice || notice.noticeEnglish, notice.noticeEnglish || notice.notice)}
                      {notice.count > 1 ? ` ×${notice.count}` : ''}
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      data-testid="dismiss-guard-notice"
                      onClick={() => conversations.dismissGuardNotice(notice.id)}
                    >
                      {t('知道了', 'Dismiss')}
                    </Button>
                  </div>
                ))}
                {emptyVisibleReply && !waitingForModel ? (
                  <article className="agent-turn mb-7 min-w-0 w-full">
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <Button type="button" variant="outline" size="sm" onClick={resumeAfterFailure}>
                        <RotateCcw className="size-3.5" />
                        {t('继续', 'Continue')}
                      </Button>
                      <span className="text-caption text-muted-foreground">
                        {t('这一轮没有可见正文。', 'This turn produced no visible reply.')}
                      </span>
                    </div>
                  </article>
                ) : null}
                {waitingForModel && !compacting ? (
                  <p className="chat-model-loading">
                    <AgentPixelLoader
                      label={waitingLabel}
                      elapsed={waitingElapsed}
                      running
                    />
                  </p>
                ) : null}
              </div>
          </div>
          ) : (
            <div className="flex w-full flex-col items-center px-8">
              {engineNotice ? (
                <div
                  className="mb-4 w-[min(36rem,100%)] rounded-xl border border-border/70 bg-muted/50 px-3 py-1.5 text-caption text-muted-foreground"
                  data-testid="engine-notice"
                >
                  {engineNotice}
                  {(engineNoticeRepeat ?? 0) > 1 ? (
                    <span data-testid="engine-notice-repeat">
                      {t(`（重复 ${engineNoticeRepeat} 次）`, ` (x${engineNoticeRepeat})`)}
                    </span>
                  ) : null}
                </div>
              ) : null}
              <h1 className="mb-6 text-center text-2xl font-medium tracking-tight text-foreground">
                {codingEmptyHeading}
              </h1>
              {gitBranchError ? (
                <p className="mb-4 text-center text-caption text-destructive">{gitBranchError}</p>
              ) : null}
            </div>
          )}

          {compacting ? (
            <p
              className="compact-bar agent-thread"
              data-testid="context-compaction-status"
              role="status"
            >
              <AgentPixelLoader
                label={t('正在整理上下文', 'Compacting context')}
                running
              />
            </p>
          ) : compactionError ? (
            <p
              className="compact-bar agent-thread"
              data-testid="context-compaction-error"
              role="status"
            >
              {compactionError}
            </p>
          ) : null}

          {hasComposerDock ? (
            <div className="agent-composer-aux agent-thread">
              <div className="agent-status-capsule">
                <AgentExecutionPlan
                  messages={conversation?.messages ?? []}
                  running={running}
                />
                {hasExecutionPlan && composerGitSummary ? (
                  <span className="agent-status-sep" aria-hidden="true">·</span>
                ) : null}
                <AgentChangeSummary
                  summary={composerGitSummary}
                  previews={conversationFileDiffs}
                  onOpenChanges={openChanges}
                />
              </div>
            </div>
          ) : null}

          <WorkingTray
            items={workingItems}
            conversations={conversations.conversations}
            onStopOne={item => {
              void conversations.abortWorkingItem(item.id)
            }}
            onStopAll={() => {
              void conversations.abortWorkingAll(workingRoot?.id)
            }}
          />

          {/* 温和停止重试仍失败时，才在输入框右上角外侧给出紧急开关（搬运自本地分支）。
              它刻意与输入区内的“停止 / 重试停止”分开：温和停止照旧，这个只是兜底。 */}
          {conversations.activeForceStopReady ? (
            <div className="flex justify-end pb-1 pr-1">
              <Button
                type="button"
                variant="destructive"
                size="sm"
                data-testid="force-stop-turn"
                onClick={() => void conversations.forceStopConversation(conversation?.id ?? '')}
              >
                {t('强制停止本回合（引擎未确认）', 'Force-stop this turn (the engine never confirmed)')}
              </Button>
            </div>
          ) : null}

          {/* 整窗拖拽加附件（监听在 window 上 ⇒ 拖到窗口任意处都生效；遮罩 fixed inset-0）。
              文件交给 composer 现成的 importCodingFiles（经 ref）⇒ 上限/体积/报错都由它负责。 */}
          <WindowFileDrop
            getPendingCount={() => composer.current?.pendingAttachmentCount() ?? 0}
            onFiles={(files, notices) => {
              if (files.length) composer.current?.addDroppedFiles(files)
              // 提示统一从纯模块给的 notices 出口出（**文案在这里用 t() 成对拼** ✓ —— 仓库约定：
              // 面向用户的文字都要经 t(中文, English)，`uiLocaleCoverage` 会抓 ✗）⇒ 不会重复弹 ✗。
              for (const notice of notices) {
                const message = notice.kind === 'overflow'
                  ? t(`最多 8 个附件，已忽略多余的 ${notice.count} 个。`, `At most 8 attachments; ${notice.count} were ignored.`)
                  : t('暂不支持文件夹，请拖文件或压缩后再试。', 'Folders are not supported yet; drop files (or a zip) instead.')
                toastError(message, message)
              }
            }}
          >
            <span className="hidden" aria-hidden="true" />
          </WindowFileDrop>

          {/* 对话里的"等待你拍板"：与侧栏"待决策"同一枚琥珀像素环 + 与后台任务同一条窄带样式。
              请求先于其它状态：它要读者动手，不该被后面的任务指示遮住。 */}
          {pendingApprovalMessage ? (
            <div
              className="chat-composer__approval-strip flex items-center gap-2 px-1 pb-1 text-xs text-muted-foreground"
              data-testid="approval-waiting-strip"
            >
              <AgentDecisionMark />
              <span>{t('等待你批准', 'Waiting for your approval')}{approvalSummary ? `：${approvalSummary}` : ''}</span>
            </div>
          ) : null}
          {pendingAskMessage(conversation?.messages) ? (
            <div
              className="chat-composer__ask-strip flex items-center gap-2 px-1 pb-1 text-xs text-muted-foreground"
              data-testid="ask-waiting-strip"
            >
              <AgentDecisionMark />
              <span>{t('等待你选择', 'Waiting for your choice')}</span>
            </div>
          ) : null}
          {/* 后台任务窄带：在跑时三行（进行中 + 件数/名字 + 状态）并带「停止全部」，
              跑完显示终态并在 15 秒后收起。口径在 lib/backgroundStripDigest（纯函数、有测试）。 */}
          <BackgroundTaskStrip
            running={backgroundTasks}
            outcome={backgroundTaskOutcome}
            conversationId={conversation?.id}
            onStopped={(taskIds) => {
              // 乐观更新：立刻把这几件从"在跑"里移除；再触发一次 refresh 让引擎侧确认（终态由引擎报 cancelled）。
              const active = conversation?.id ?? ''
              if (!active) return
              const remaining = (backgroundTasks ?? [])
                .filter(task => !taskIds.includes(String(task?.id ?? '')))
                .map(task => ({
                  id: String(task?.id ?? ''),
                  name: String(task?.name ?? ''),
                  status: String(task?.status ?? ''),
                }))
              // 公开运行时对象上 backgroundTasks 是只读（只有 getter）⇒ 走 store 写入。
              conversations.store.setState(state => ({
                ...state,
                backgroundTasks: { ...state.backgroundTasks, [active]: remaining },
              }))
              void invokeCommand('refresh_coding_background_tasks', {
                conversationId: active,
                workspacePath: conversation?.workspacePath ?? '',
              }).catch(() => undefined)
            }}
          />
          <ChatComposer
            // 按会话重挂载：输入框内部有多处"上一个会话"的 ref，若不重挂载，切换时
            // 它们会互相滞后，把草稿记到别的会话名下（已在装机版复现串稿）。
            // 用 key 让每个会话拥有全新的输入框实例，从结构上消除这类滞后。
            key={composerDraftKey(
              conversation?.id,
              conversation
                ? conversationWorkspaceHome(conversation)
                : conversations.pendingWorkspaceHome,
            )}
            ref={composer}
            conversationKey={composerDraftKey(
              conversation?.id,
              conversation
                ? conversationWorkspaceHome(conversation)
                : conversations.pendingWorkspaceHome,
            )}
            running={running}
            aborting={aborting}
            compacting={compacting}
            runPhase={runPhase}
            queuedGuidance={messageQueue?.steering ?? []}
            injectedGuidance={conversations.activeInjectedGuidance}
            queuedGuidanceInterrupted={conversations.activeQueuedGuidanceInterrupted}
            onInjectQueuedGuidance={index => void conversations.injectQueuedGuidance(index)}
            onReorderQueuedGuidance={(from, to) => conversations.reorderQueuedGuidance(from, to)}
            queuedGuidanceAwaitingTool={queuedGuidanceAwaitingTool}
            queuedGuidanceStalled={messageQueue?.stalled === true}
            abortStalled={abortStalled}
            ctfSession={ctfSession}
            goalMode={goalMode}
            goal={activeGoal}
            executionMode={effectiveExecutionMode}
            approvalPolicy={effectiveApprovalPolicy}
            approvalLabel={approvalMenuLabel}
            modelKey={currentModelKey}
            automaticModelLabel={automaticModelLabel}
            compactModelLabel={compactModelLabel}
            thinkingLevels={currentThinkingProfile.levels}
            thinkingLevel={currentThinkingLevel}
            kernel={agentKernel}
            kernelLocked={Boolean(conversation?.messages.some(message => message.role === 'user' && message.status !== 'queued'))}
            planModeActive={conversation?.planMode?.active === true}
            dshCommands={conversation?.dshCommands}
            dshCommandsError={conversation?.dshCommandsError}
            busySend={conversations.busySend}
            multitask={conversations.selectedMultitask}
            onToggleMultitask={enabled => conversations.setMultitask(enabled)}
            compactDisabled={continuity.compactDisabled}
            contextUsage={contextUsagePresentation}
            workspaceReady={Boolean(workspacePath)}
            workspaceLocked={workspaceLocked}
            workspaceName={workspaceName}
            workspacePath={workspacePath}
            homeDirectory={homeDirectory}
            recentProjects={recentProjects}
            gitRepository={gitRepository}
            gitBranch={gitBranch}
            gitBranches={gitBranches}
            browserUseReady={browserUseReadyForCurrentTask}
            computerUseReady={externalAppUseReadyForCurrentTask}
            availableSkills={activeSkills}
            importedSkills={enabledUserSkills}
            selectedMcpServers={selectedMCPServers}
            mcpCatalog={mcpConfig?.servers ?? []}
            mcpConfigDigest={mcpConfig?.digest ?? ''}
            onSend={sendComposerMessage}
            onOpenChanges={openChanges}
            onAbort={() => onAbort?.()}
            onJumpToLatest={() => void scrollChatToBottom(true)}
            jumpToLatestVisible={jumpToLatestVisible}
            onChangeExecutionMode={changeExecutionMode}
            onChangeApprovalPolicy={changeApprovalPolicy}
            onChangeModel={changeModel}
            onChangeThinkingLevel={level => onChangeThinkingLevel?.(level)}
            onChangeKernel={value => onChangeKernel?.(value)}
            onMigrateKernel={value => onMigrateKernel?.(value)}
            onShowPermissions={showCodingPermissions}
            onChooseWorkspace={chooseWorkspaceFromCurrentTask}
            onSelectWorkspace={selectRecentProject}
            onForgetWorkspace={path => void forgetRecentProject(path)}
            onClearWorkspace={() => onClearWorkspace?.()}
            onCheckoutBranch={branch => void applyGitBranchAction('checkout', branch)}
            onCreateBranch={branch => void applyGitBranchAction('create-branch', branch)}
            onCancelQueuedGuidance={index => onCancelQueuedGuidance?.(index)}
            onEditQueuedGuidance={index => onEditQueuedGuidance?.(index)}
            onConsumeGoal={() => setGoalMode(false)}
            onStartGoal={() => setGoalMode(true)}
            onRunSlashCommand={runSlashCommand}
            onControlGoal={controlComposerGoal}
            onChangeMcpServers={(servers, digest) => onChangeMcpServers?.(servers, digest)}
          />
          </div>
        </main>

        {!dockSurface && environmentOpen ? (
          <ContextRail
            as="aside"
            className="context-sidebar"
            size="wide"
            resizable
            width={contextRailWidth}
            bodyMode={contextPanel === 'browser' ? 'viewport' : 'scroll'}
            aria-label={contextPanelTitle}
            data-testid="single-right-context-rail"
            onWidthChange={persistContextRailWidth}
            header={(
              <div className="app-drag flex w-full items-center gap-px">
                {!transientComputerUsePanel ? (
                  <Select
                    value={contextPanel}
                    onValueChange={value => changeContextPanel(String(value ?? ''))}
                  >
                    <SelectTrigger
                      className="agent-chrome-tab app-no-drag h-8 min-w-0 flex-1 justify-start border-0 bg-transparent px-2 text-[14px] font-medium shadow-none"
                      aria-label={t('选择右侧页面', 'Choose the right-rail page')}
                    >
                      {contextPanelIcon}
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent align="start" className="agent-floating min-w-56">
                      <SelectItem value="environment">{t('环境信息', 'Environment')}</SelectItem>
                      <SelectItem value="changes">{t('变更', 'Changes')}</SelectItem>
                      <SelectItem value="artifacts">{t('产物', 'Artifacts')}</SelectItem>
                      <SelectItem value="browser">{t('浏览器', 'Browser')}</SelectItem>
                      {ctfSession ? (
                        <>
                          <SelectSeparator />
                          <SelectItem value="collaboration">{t('Agent 协作', 'Agent collaboration')}</SelectItem>
                          <SelectItem value="evidence">{t('证据与 Judge', 'Evidence and Judge')}</SelectItem>
                        </>
                      ) : null}
                    </SelectContent>
                  </Select>
                ) : (
                  <div className="app-no-drag flex min-w-0 flex-1 items-center gap-2 px-2 text-[14px] font-medium">
                    {contextPanel === 'browser-use' ? (
                      <Globe2 className="size-4 shrink-0" />
                    ) : (
                      <MousePointer2 className="size-4 shrink-0" />
                    )}
                    <span className="truncate">{contextPanelTitle}</span>
                  </div>
                )}
                <div className="app-no-drag flex items-center">
                  <button
                    type="button"
                    className="agent-chrome-icon"
                    data-testid="coding-rail-terminal"
                    aria-label={terminalOpen ? t('关闭底部终端', 'Close bottom terminal') : t('打开底部终端', 'Open bottom terminal')}
                    title={terminalOpen ? t('关闭底部终端', 'Close bottom terminal') : t('打开底部终端', 'Open bottom terminal')}
                    onClick={toggleTerminalPanel}
                  >
                    <SquareTerminal className="size-4" />
                  </button>
                  <button
                    type="button"
                    className="agent-chrome-icon"
                    data-testid="coding-rail-toggle"
                    aria-label={t('关闭右侧栏', 'Close right rail')}
                    title={t('关闭右侧栏', 'Close right rail')}
                    onClick={toggleManualContextSidebar}
                  >
                    <PanelRightClose className="size-4" />
                  </button>
                </div>
              </div>
            )}
          >
            <div className="min-h-0 flex-1">
              {contextPanel === 'environment' ? (
                <>
                  {environmentError ? (
                    <div className="border-b border-border px-4 py-3 text-caption text-destructive">
                      {environmentError}
                    </div>
                  ) : null}

                  <section className="border-b border-border px-4 py-4">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-caption font-medium text-muted-foreground">{t('工作区', 'Workspace')}</p>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={running}
                        onClick={chooseWorkspaceFromCurrentTask}
                      >
                        {workspaceLocked ? t('新任务使用其他目录', 'Use another folder for a new task') : t('更换', 'Change')}
                      </Button>
                    </div>
                    <div className="mt-3 flex items-start gap-3">
                      <FolderOpen className="mt-0.5 size-4 shrink-0 text-primary" />
                      <div className="min-w-0">
                        <p className="truncate text-body font-medium">
                          {automaticScratchWorkspace ? workspaceName : codingEnvironment?.workspaceName || workspaceName}
                        </p>
                        {automaticScratchWorkspace || workspacePath ? (
                          <p
                            className="mt-1 truncate font-mono text-caption text-muted-foreground"
                            title={workspacePath}
                          >
                            {automaticScratchWorkspace
                              ? t('无项目任务 · MilkSU 本地临时工作区', 'No project · MilkSU local temporary workspace')
                              : workspacePath}
                          </p>
                        ) : null}
                      </div>
                    </div>
                  </section>

                  <section className="border-b border-border px-4 py-4">
                    <div className="flex items-center justify-between">
                      <p className="text-caption font-medium text-muted-foreground">Git</p>
                      {codingEnvironment?.git.isRepository ? (
                        <Badge variant={codingEnvironment.git.dirty ? 'secondary' : 'outline'}>
                          {codingEnvironment.git.dirty ? t('有变更', 'Changed') : t('干净', 'Clean')}
                        </Badge>
                      ) : null}
                    </div>
                    {codingEnvironment?.git.isRepository ? (
                      <div className="mt-3 space-y-3 text-body">
                        <div className="flex items-center justify-between gap-3">
                          <span className="flex min-w-0 items-center gap-2 text-muted-foreground">
                            <GitBranch className="size-4 shrink-0" />
                            <span className="truncate">{codingEnvironment.git.branch || 'detached'}</span>
                          </span>
                          {codingEnvironment.git.ahead || codingEnvironment.git.behind ? (
                            <span className="font-mono text-caption">
                              ↑{codingEnvironment.git.ahead} ↓{codingEnvironment.git.behind}
                            </span>
                          ) : null}
                        </div>
                        {codingEnvironment.git.head ? (
                          <div className="flex items-center justify-between gap-3">
                            <span className="text-muted-foreground">{t('提交', 'Commit')}</span>
                            <span className="font-mono text-caption">{codingEnvironment.git.head}</span>
                          </div>
                        ) : null}
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-muted-foreground">{t('变更', 'Changes')}</span>
                          <span className="font-mono text-caption">
                            {t(`${codingEnvironment.git.changedFiles} 文件`, `${codingEnvironment.git.changedFiles} files`)}
                            {' '}
                            <span className="text-primary">+{codingEnvironment.git.additions}</span>
                            {' '}
                            <span className="text-destructive">-{codingEnvironment.git.deletions}</span>
                          </span>
                        </div>
                        <div className="grid grid-cols-2 gap-x-3 gap-y-2 text-caption text-muted-foreground">
                          <span>{t(`暂存 ${codingEnvironment.git.staged}`, `Staged ${codingEnvironment.git.staged}`)}</span>
                          <span>{t(`修改 ${codingEnvironment.git.modified}`, `Modified ${codingEnvironment.git.modified}`)}</span>
                          <span>{t(`未跟踪 ${codingEnvironment.git.untracked}`, `Untracked ${codingEnvironment.git.untracked}`)}</span>
                          <span className={codingEnvironment.git.conflicts ? 'text-destructive' : undefined}>
                            {t(`冲突 ${codingEnvironment.git.conflicts}`, `Conflicts ${codingEnvironment.git.conflicts}`)}
                          </span>
                        </div>
                        <Button
                          variant="outline"
                          className="w-full justify-between"
                          onClick={() => changeContextPanel('changes')}
                        >
                          <span className="flex items-center gap-2">
                            <FileDiff className="size-4" />
                            {t('查看文件级变更', 'View file-level changes')}
                          </span>
                          <span className="text-caption text-muted-foreground">
                            {t(`${codingEnvironment.git.changedFiles} 文件`, `${codingEnvironment.git.changedFiles} files`)}
                          </span>
                        </Button>
                      </div>
                    ) : (
                      <p className="mt-3 text-caption leading-5 text-muted-foreground">
                        {codingEnvironment?.git.problem || t('当前目录不是 Git 仓库。', 'This directory is not a Git repository.')}
                      </p>
                    )}
                  </section>

                  {ctfSession ? (
                    <section className="border-b border-border px-4 py-4">
                      <p className="text-caption font-medium text-muted-foreground">{t('当前解题', 'Current challenge')}</p>
                      <div className="mt-3 space-y-3 text-body">
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-muted-foreground">{t('角色', 'Role')}</span>
                          <span>{ctfRoleLabel}</span>
                        </div>
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-muted-foreground">{t('协作', 'Collaboration')}</span>
                          <span>{ctfMode === 'coach' ? t('教练', 'Coach') : ctfMode === 'delegate' ? t('代理', 'Delegate') : t('搭档', 'Partner')}</span>
                        </div>
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-muted-foreground">{t('阶段', 'Phase')}</span>
                          <span>{ctfCheckpoint?.progress?.phase || ctfCheckpoint?.status || t('待启动', 'Not started')}</span>
                        </div>
                        {ctfBudget ? (
                          <div className="flex items-center justify-between gap-3">
                            <span className="text-muted-foreground">{t('回合预算', 'Turn budget')}</span>
                            <span className="font-mono text-caption">
                              {ctfBudget.remainingTurns}/{ctfBudget.budget.maxTurns}
                            </span>
                          </div>
                        ) : null}
                      </div>
                    </section>
                  ) : null}

                  <section className="border-b border-border px-4 py-4">
                    <p className="text-caption font-medium text-muted-foreground">Agent</p>
                    <div className="mt-3 space-y-3 text-body">
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-muted-foreground">{t('状态', 'Status')}</span>
                        <span className="flex items-center gap-2">
                          {running ? <AkLoadingMark label={t('执行中', 'Running')} /> : (
                            <span className="size-1.5 rounded-full bg-muted-foreground" />
                          )}
                          {running ? t('执行中', 'Running') : t('空闲', 'Idle')}
                        </span>
                      </div>
                      {runTimingPresentation ? (
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-muted-foreground">{t('本轮用时', 'This turn')}</span>
                          <span
                            className="font-mono text-caption tabular-nums"
                            data-testid="agent-run-elapsed"
                          >
                            {runTimingPresentation.label}
                          </span>
                        </div>
                      ) : null}
                      <div className="flex items-start justify-between gap-3">
                        <span className="shrink-0 text-muted-foreground">{t('模型', 'Model')}</span>
                        <span className="text-right text-caption leading-5">{activeModelLabel}</span>
                      </div>
                      <div className="flex items-start justify-between gap-3">
                        <span className="shrink-0 text-muted-foreground">{t('来源', 'Source')}</span>
                        <span className="text-right text-caption leading-5">{activeModelSourceLabel}</span>
                      </div>
                      {contextUsagePresentation ? (
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-muted-foreground">{t('上下文', 'Context')}</span>
                          <ContextUsageMeter
                            usage={contextUsagePresentation}
                            size="md"
                            running={running}
                            compacting={compacting}
                            onCompactContext={() => onCompactContext?.()}
                            onHandoffContext={() => onHandoffContext?.()}
                          />
                        </div>
                      ) : null}
                      <div className="flex items-start justify-between gap-3">
                        <span className="shrink-0 text-muted-foreground">{t('插件', 'Plugins')}</span>
                        <span className="text-right text-caption leading-5">
                          {activeExtensions.length ? activeExtensions.map(extensionLabel).join(' · ') : ''}
                        </span>
                      </div>
                      {activeSkills.length ? (
                        <div className="flex items-start justify-between gap-3">
                          <span className="shrink-0 text-muted-foreground">{t('技能', 'Skills')}</span>
                          <span className="text-right text-caption leading-5">
                            {activeSkills.join(' · ')}
                          </span>
                        </div>
                      ) : null}
                      <div className="flex items-start justify-between gap-3">
                        <span className="shrink-0 text-muted-foreground">{t('工具', 'Tools')}</span>
                        <span className="text-right text-caption leading-5">
                          {t(`${activeTools.length} 个`, `${activeTools.length} tools`)}
                        </span>
                      </div>
                      {activeTools.length ? (
                        <details className="rounded-md bg-muted/40 px-2.5 py-2">
                          <summary className="cursor-pointer text-caption text-muted-foreground">
                            {t('查看本任务工具', 'View tools for this task')}
                          </summary>
                          <p className="mt-2 break-words text-caption leading-5 text-muted-foreground">
                            {activeTools.join(' · ')}
                          </p>
                        </details>
                      ) : null}
                    </div>
                  </section>

                  <section className="border-b border-border px-4 py-4">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-caption font-medium text-muted-foreground">{t('执行与权限', 'Execution and permissions')}</p>
                      <Badge variant="outline">{codingPolicyLabel}</Badge>
                    </div>
                    <div className="mt-3 space-y-3">
                      {codingCapabilities.map(capability => (
                        <div
                          key={capability.id}
                          className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1"
                        >
                          <p className="text-body">{capability.label}</p>
                          <span
                            className={cn(
                              'text-caption',
                              capability.status === 'allowed'
                                ? 'text-primary'
                                : capability.status === 'approval-required'
                                  ? 'text-amber-500'
                                  : 'text-muted-foreground',
                            )}
                          >
                            {capabilityStatusLabel(capability.status)}
                          </span>
                          {capability.status !== 'allowed' && capability.detail ? (
                            <p className="col-span-2 text-caption leading-5 text-muted-foreground">
                              {capability.detail}
                            </p>
                          ) : null}
                        </div>
                      ))}
                    </div>
                    <div className="mt-4 border-t border-border/70 pt-4">
                      {userMCPServers.length ? (
                        <p className="text-caption font-medium text-muted-foreground">
                          {t('用户 MCP', 'User MCP')}
                        </p>
                      ) : null}
                      {userMCPServers.length ? (
                        <div className="mt-2 space-y-2">
                          {userMCPServers.map(server => (
                            <CodingMCPReviewCard
                              key={`user-${server.name}`}
                              server={server}
                              selected
                              running={running}
                              alwaysOn
                            />
                          ))}
                        </div>
                      ) : null}
                      <p
                        className={cn(
                          'text-caption font-medium text-muted-foreground',
                          userMCPServers.length ? 'mt-4' : undefined,
                        )}
                      >
                        {t('项目 MCP', 'Project MCP')}
                      </p>
                      {mcpConfigLoading ? (
                        <p className="mt-2 text-caption text-muted-foreground">
                          {t('正在读取', 'Reading')}
                        </p>
                      ) : mcpConfig?.problem ? (
                        <p className="mt-2 text-caption leading-5 text-destructive">
                          {mcpConfig.problem}
                        </p>
                      ) : mcpConfig ? (
                        <div className="mt-2 space-y-2">
                          {projectMCPServers.map(server => (
                            <CodingMCPReviewCard
                              key={server.name}
                              server={server}
                              selected={selectedMCPServers.includes(server.name)}
                              running={running}
                              onToggle={() => toggleMCPServer(server)}
                            />
                          ))}
                        </div>
                      ) : null}
                    </div>
                  </section>
                </>
              ) : contextPanel === 'changes' ? (
                <CodingChangesPanel
                  workspacePath={workspacePath}
                  environment={codingEnvironment}
                  running={running}
                  focusPath={changesFocusPath}
                  preferredEditor={settings?.preferred_external_editor}
                  onReview={() => void runCodingProductAction('review')}
                  onRefresh={() => void refreshEnvironment()}
                />
              ) : contextPanel === 'artifacts' ? (
                <CodingArtifactPreviewPanel
                  ref={artifactPanel}
                  workspacePath={workspacePath}
                  environment={codingEnvironment}
                  requestedPath={requestedArtifactPath}
                  onPreviewed={recordArtifactPreview}
                />
              ) : contextPanel === 'browser' ? (
                <section className="coding-browser-panel flex h-full min-h-0 flex-col">
                  {browserPanelError ? (
                    <div className="shrink-0 border-b border-border px-3 py-2 text-caption text-destructive">
                      {browserPanelError}
                    </div>
                  ) : null}

                  <div className="flex h-11 shrink-0 items-end gap-1 border-b border-border bg-muted/35 px-2 pt-1.5">
                    <div className="flex min-w-0 flex-1 items-end gap-1 overflow-x-auto">
                      {browserTabs.map(tab => (
                        <button
                          key={tab.id}
                          type="button"
                          className={cn(
                            'flex h-9 min-w-0 max-w-52 flex-1 items-center gap-2 rounded-t-lg border border-b-0 px-3',
                            tab.active
                              ? 'border-border bg-background'
                              : 'border-transparent bg-transparent text-muted-foreground',
                          )}
                          aria-current={tab.active ? 'page' : undefined}
                          aria-label={tab.title || tab.url || t('新标签页', 'New tab')}
                          onClick={() => {
                            if (tab.id !== 'current') void activateCodingBrowserTab(tab.id)
                          }}
                        >
                          <Globe2 className="size-3.5 shrink-0 text-primary" />
                          <span className="min-w-0 flex-1 truncate text-left text-control">
                            {tab.title || tab.url || t('新标签页', 'New tab')}
                          </span>
                          {codingBrowserStatus?.enabled ? (
                            <span
                              role="button"
                              tabIndex={0}
                              className="grid size-5 shrink-0 place-items-center rounded-sm text-muted-foreground hover:text-foreground"
                              aria-label={codingBrowserTabs.length > 1
                                ? t(`关闭 ${tab.title || t('标签页', 'tab')}`, `Close ${tab.title || t('标签页', 'tab')}`)
                                : t('关闭浏览器', 'Close browser')}
                              onClick={event => {
                                event.stopPropagation()
                                if (tab.id === 'current') void stopCodingBrowser()
                                else void closeCodingBrowserTab(tab.id)
                              }}
                              onKeyDown={event => handleTabCloseKeyDown(event, tab.id)}
                            >
                              <X className="size-3.5" />
                            </span>
                          ) : null}
                        </button>
                      ))}
                    </div>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="mb-1 size-7 shrink-0"
                      aria-label={t('新标签页', 'New tab')}
                      disabled={codingBrowserLoading || codingBrowserTabs.length >= 8}
                      onClick={() => void createCodingBrowserTab()}
                    >
                      <Plus className="size-3.5" />
                    </Button>
                  </div>

                  <div className="flex h-12 shrink-0 items-center gap-1.5 border-b border-border bg-background px-2">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      disabled={!codingBrowserStatus?.enabled}
                      aria-label={t('后退', 'Back')}
                      onClick={() => void runCodingBrowserNavigation('back')}
                    >
                      <ArrowLeft className="size-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      disabled={!codingBrowserStatus?.enabled}
                      aria-label={t('前进', 'Forward')}
                      onClick={() => void runCodingBrowserNavigation('forward')}
                    >
                      <ArrowRight className="size-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      disabled={!codingBrowserStatus?.enabled || codingBrowserLoading}
                      aria-label={t('重新加载', 'Reload')}
                      onClick={() => void runCodingBrowserNavigation('reload')}
                    >
                      <RefreshCw className={cn('size-4', codingBrowserLoading ? 'animate-spin' : undefined)} />
                    </Button>
                    <Input
                      value={codingBrowserURL}
                      disabled={codingBrowserLoading}
                      className="h-8 min-w-0 flex-1 rounded-full bg-muted/55 px-3 font-mono text-caption"
                      aria-label={t('浏览器地址', 'Address')}
                      placeholder={t('输入网址或搜索内容', 'Enter a URL or search')}
                      onChange={event => setCodingBrowserURL(event.target.value)}
                      onKeyDown={handleBrowserAddressKeyDown}
                    />
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      disabled={codingBrowserLoading}
                      aria-label={codingBrowserStatus?.enabled ? t('打开地址', 'Open address') : t('启动浏览器', 'Start browser')}
                      onClick={() => void navigateCodingBrowser()}
                    >
                      {codingBrowserLoading ? (
                        <LoaderCircle className="size-4 animate-spin" />
                      ) : (
                        <ArrowRight className="size-4" />
                      )}
                    </Button>
                  </div>

                  <div className="relative min-h-0 flex-1 bg-white">
                    <div
                      ref={codingBrowserViewport}
                      className="absolute inset-0"
                      data-coding-browser-viewport
                      aria-label={codingBrowserStatus?.enabled ? t('浏览器页面', 'Browser page') : t('浏览器未启动', 'Browser not started')}
                    />
                    {!codingBrowserStatus?.enabled ? (
                      <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-background px-8 text-center">
                        <Globe2 className="size-7 text-muted-foreground" />
                        <p className="mt-3 text-label font-medium">{t('浏览器', 'Browser')}</p>
                        <p className="mt-1 text-caption text-muted-foreground">{t('输入地址后按回车', 'Press Return after entering an address')}</p>
                      </div>
                    ) : null}
                  </div>

                  <footer className="flex h-9 shrink-0 items-center justify-between gap-3 border-t border-border bg-background px-3 text-caption text-muted-foreground">
                    <span className="min-w-0 truncate">
                      {codingBrowserStatus?.enabled
                        ? codingBrowserStatus.profileLabel
                        : t('独立 profile · 不读取日常浏览器', 'Isolated profile · does not read your everyday browser')}
                    </span>
                    {codingBrowserEvidencePath ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="shrink-0"
                        disabled={codingBrowserEvidenceLoading}
                        aria-label={t('在 Finder 中显示浏览器证据', 'Reveal browser evidence in Finder')}
                        onClick={() => void revealCodingBrowserEvidence()}
                      >
                        {codingBrowserEvidenceLoading ? (
                          <LoaderCircle className="size-3.5 animate-spin" />
                        ) : (
                          <FolderOpen className="size-3.5" />
                        )}
                        {t('证据', 'Evidence')}
                      </Button>
                    ) : null}
                  </footer>
                </section>
              ) : contextPanel === 'browser-use' ? (
                <>
                  {browserPanelError ? (
                    <div className="border-b border-border px-4 py-3 text-caption text-destructive">
                      {browserPanelError}
                    </div>
                  ) : null}
                  <section className="px-4 py-5">
                    <div className="rounded-xl border border-border bg-muted/25 p-4">
                      <div className="flex items-start gap-3">
                        <Globe2 className="mt-0.5 size-5 shrink-0 text-primary" />
                        <div>
                          <p className="text-body font-medium">{t('真实用户浏览器', 'Real user browser')}</p>
                          <p className="mt-1 text-caption leading-5 text-muted-foreground">
                            {t('发送任务后，在 Chrome/Edge 中批准要操作的标签页。', 'After you send the task, approve the tab to operate in Chrome/Edge.')}
                          </p>
                        </div>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        className="mt-4"
                        onClick={() => void openPlaywrightBrowserExtension()}
                      >
                        <ExternalLink className="size-3.5" />
                        {t('安装 Playwright 官方扩展', 'Install the official Playwright extension')}
                      </Button>
                    </div>
                  </section>
                </>
              ) : contextPanel === 'computer-use' ? (
                <>
                  {browserPanelError ? (
                    <div className="border-b border-border px-4 py-3 text-caption text-destructive">
                      {browserPanelError}
                    </div>
                  ) : null}
                  <section className="px-4 py-5">
                    <CodingComputerUsePanel
                      standalone
                      status={computerUseStatus}
                      targets={scopedComputerUseTargets}
                      selectedTargetKey={selectedComputerUseTargetKey}
                      loading={computerUseLoading}
                      running={running}
                      ownedByCurrentTask={computerUseOwnedByCurrentTask}
                      executionMode={effectiveExecutionMode}
                      approvalPolicy={effectiveApprovalPolicy}
                      operationEvidence={computerUseOperationEvidence}
                      onSelectedTargetKeyChange={setSelectedComputerUseTargetKey}
                      onRequestPermissions={permission => void requestComputerUsePermissions(permission)}
                      onRefresh={() => void refreshBrowserPanel()}
                      onStart={() => void startComputerUse()}
                      onStop={() => void stopComputerUse()}
                    />
                  </section>
                </>
              ) : contextPanel === 'collaboration' ? (
                <>
                  <section className="border-b border-border px-4 py-4">
                    <p className="text-caption font-medium text-muted-foreground">{t('当前角色', 'Current role')}</p>
                    <div className="mt-3 grid gap-2">
                      <Button
                        variant={ctfRole === 'solver' ? 'secondary' : 'outline'}
                        className="justify-start"
                        onClick={() => onSwitchCtfAgent?.('solver')}
                      >
                        <Flag className="size-4" />
                        {t('解题 Agent', 'Solving agent')}
                      </Button>
                      <Button
                        variant={ctfRole === 'tool-builder' ? 'secondary' : 'outline'}
                        className="justify-start"
                        onClick={() => onSwitchCtfAgent?.('tool-builder')}
                      >
                        <Wrench className="size-4" />
                        {t('Coding Agent 工具工坊', 'Coding Agent tool workshop')}
                      </Button>
                      <Button
                        variant={ctfRole === 'strategist' ? 'secondary' : 'outline'}
                        className="justify-start"
                        onClick={() => onSwitchCtfAgent?.('strategist')}
                      >
                        <Route className="size-4" />
                        {t('策略复盘', 'Strategy debrief')}
                      </Button>
                    </div>
                    {ctfRole === 'strategist' ? (
                      <div className="mt-3 rounded-lg bg-primary/5 px-3 py-3">
                        <p className="text-body font-medium">{t('策略 Agent 复盘', 'Strategy Agent debrief')}</p>
                        <p className="mt-1 text-caption leading-5 text-muted-foreground">
                          {t('独立审阅题面、轨迹与证据；不执行命令，不修改解题笔记或候选。', 'Independently review the challenge, trajectory, and evidence. Do not run commands or change solving notes or candidates.')}
                        </p>
                        <Button
                          variant="link"
                          size="text"
                          className="mt-2"
                          onClick={() => onSwitchCtfAgent?.('solver')}
                        >
                          {t('复盘完成后返回验证', 'Return to verification after debrief')}
                        </Button>
                      </div>
                    ) : null}
                  </section>
                  <section className="border-b border-border px-4 py-4">
                    <p className="text-caption font-medium text-muted-foreground">{t('工具交接', 'Tool handoff')}</p>
                    <p className="mt-2 text-body">{workshopSummary}</p>
                    {workshopState?.latestRequest ? (
                      <p
                        className="mt-1 truncate text-caption text-muted-foreground"
                        title={workshopState.latestRequest.relativePath}
                      >
                        {workshopState.latestRequest.title}
                      </p>
                    ) : null}
                    <div className="mt-4 flex flex-wrap gap-2">
                      {ctfRole !== 'tool-builder' && workshopState?.readyCount ? (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={running}
                          onClick={verifyDeliveredTool}
                        >
                          {t('验收工具', 'Verify tool')}
                        </Button>
                      ) : ctfRole !== 'tool-builder' && !workshopState?.pendingCount ? (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={running}
                          onClick={requestTool}
                        >
                          {t('提出工具需求', 'Request a tool')}
                        </Button>
                      ) : null}
                    </div>
                  </section>
                </>
              ) : (
                <section className="border-b border-border px-4 py-4">
                  <p className="text-caption font-medium text-muted-foreground">{t('证据与 Judge', 'Evidence and Judge')}</p>
                  <div className="mt-3 grid grid-cols-2 gap-3">
                    <div>
                      <p className="text-xl font-semibold">{ctfProjection?.evidence.length ?? 0}</p>
                      <p className="text-caption text-muted-foreground">{t('证据', 'Evidence')}</p>
                    </div>
                    <div>
                      <p className="text-xl font-semibold">{ctfProjection?.artifacts.length ?? 0}</p>
                      <p className="text-caption text-muted-foreground">{t('制品', 'Artifacts')}</p>
                    </div>
                  </div>
                  {latestJudge ? (
                    <div className="mt-4 flex items-start gap-2">
                      <CircleDot
                        className={cn(
                          'mt-0.5 size-4 shrink-0',
                          latestJudge.correct ? 'text-primary' : 'text-muted-foreground',
                        )}
                      />
                      <div>
                        <p className="text-body font-medium">{latestJudge.platform} · {latestJudge.status}</p>
                        <MarkdownContent
                          className="mt-1 line-clamp-3 text-caption leading-5 text-muted-foreground"
                          content={latestJudge.summary}
                          compact
                        />
                      </div>
                    </div>
                  ) : (
                    <p className="mt-3 text-caption text-muted-foreground">{t('尚无外部 Judge 回执。', 'No external Judge receipts yet.')}</p>
                  )}
                </section>
              )}
            </div>
          </ContextRail>
        ) : null}
      </div>

      {!dockSurface && terminalOpen ? (
        <div
          className="coding-terminal-dock min-w-0 shrink-0 overflow-hidden"
          style={terminalDockStyle}
          aria-label={t('底部终端面板', 'Bottom terminal panel')}
        >
          <div
            className="coding-terminal-dock__resize app-no-drag"
            role="separator"
            aria-orientation="horizontal"
            aria-label={t('调整终端高度', 'Resize terminal')}
            onPointerDown={startTerminalResize}
          />
          <Suspense fallback={null}>
            <CodingTerminalPanel
              className="min-h-0 flex-1"
              active={terminalOpen}
              conversationId={terminalConversationId}
              workspacePath={terminalWorkspacePath}
              onClose={() => setTerminalOpen(false)}
            />
          </Suspense>
        </div>
      ) : null}

      <CodingComputerUsePermissionDialog
        open={computerUsePermissionDialogOpen}
        status={computerUseStatus}
        requesting={computerUsePermissionRequesting}
        error={computerUsePermissionError}
        onOpenChange={setComputerUsePermissionDialogOpen}
        onRequestPermissions={permission => void requestComputerUsePermissions(permission)}
        onPoll={() => void pollComputerUsePermissions()}
        onComplete={() => void handleComputerUsePermissionComplete()}
      />
      <style>{chatPageCss}</style>
    </section>
  )
})

export default ChatPage

const chatPageCss = `
.chat-main {
  container-name: chat-main;
  container-type: inline-size;
}

.chat-empty-canvas {
  padding-bottom: 8vh;
}

.chat-empty-canvas .chat-composer {
  width: 100%;
}

.chat-surface-dock,
.chat-surface-dock .coding-workspace,
.chat-surface-dock .chat-main {
  min-width: 0;
  min-height: 0;
  height: 100%;
}

.chat-surface-dock .chat-main {
  background: transparent;
}

.coding-workspace {
  container-name: coding-workspace;
  container-type: inline-size;
}

.coding-browser-panel {
  background-color: var(--card);
}

.coding-action-option {
  display: flex;
  cursor: pointer;
  align-items: flex-start;
  gap: 0.75rem;
  padding: 0.65rem 0.75rem;
}

.coding-terminal-dock {
  position: relative;
  display: flex;
  min-height: 0;
  flex-direction: column;
}

.coding-terminal-dock__resize {
  position: absolute;
  inset: 0 0 auto;
  z-index: 2;
  height: 8px;
  margin-top: -3px;
  cursor: row-resize;
  touch-action: none;
}

.coding-terminal-dock__resize::after {
  position: absolute;
  inset: 3px 0;
  background: transparent;
  content: '';
}

.coding-terminal-dock__resize:hover::after,
.coding-terminal-dock__resize:focus-visible::after {
  background: var(--hover-2);
}
`
