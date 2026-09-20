package main

import (
	"errors"
	"fmt"
	"log"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/MilkSU-Official/milksu/internal/config"
	"github.com/MilkSU-Official/milksu/internal/conversation"
)

// A conversation may hand a message to another conversation of the same workspace.
//
// The backend is the only layer that can address a conversation the reader is not
// looking at, so the target is bound here and announced over agent-delivery. The
// renderer files the entry under that id - into the schedule while the target is
// running, as a fresh turn when it is idle - and never switches the visible view.
const agentDeliveryEventName = "agent-delivery"

const (
	agentDeliveryMaxRunes = 4000
	agentDeliveryWindow   = 10 * time.Second
	agentDeliveryBurst    = 5
	// 每条会话的总出站预算：按"对话对"记账管不住"一个失控的会话同时灌多个目标"，
	// 所以再加一道按来源合并计数的上限。超了就拒，并要求它向读者汇报，而不是换目标继续发。
	agentDeliverySourceBurst = 12
)

type agentDeliveryOrigin struct {
	ConversationID    string `json:"conversationId"`
	ConversationTitle string `json:"conversationTitle"`
	Agent             string `json:"agent"`
	DeliveredAt       uint64 `json:"deliveredAt,omitempty"`
}

// agentDeliverySource is the only thing a caller may say about where a delivery came from:
// its own conversation id. The title and the agent name are resolved by the host from the
// conversation record, so no caller can label a message as coming from someone else.
type agentDeliverySource struct {
	ConversationID string `json:"conversationId"`
}

type agentDeliveryInput struct {
	TargetConversationID string              `json:"targetConversationId"`
	Text                 string              `json:"text"`
	Origin               agentDeliverySource `json:"origin"`
	// Kind is "request" (default) or "result". A result is an answer to an earlier request
	// and is the only form a conversation may send back to one that asked it.
	Kind string `json:"kind"`
	// RequestID correlates the announcement with the sidecar tool call that is waiting for
	// the verdict. Empty for callers that do not wait on one.
	RequestID string `json:"requestId"`
}

const (
	agentDeliveryKindRequest = "request"
	agentDeliveryKindResult  = "result"
)

// normalizeAgentDeliveryKind accepts only the two known forms. Anything else reads as a
// request, so an unknown label can never open the result-reply path.
func normalizeAgentDeliveryKind(value string) string {
	if strings.EqualFold(strings.TrimSpace(value), agentDeliveryKindResult) {
		return agentDeliveryKindResult
	}
	return agentDeliveryKindRequest
}

type agentDeliveryEvent struct {
	TargetConversationID string              `json:"targetConversationId"`
	Text                 string              `json:"text"`
	Origin               agentDeliveryOrigin `json:"origin"`
	// Kind is the accepted form: "request" or "result".
	Kind      string `json:"kind,omitempty"`
	RequestID string `json:"requestId,omitempty"`
}

// validateAgentDelivery is deliberately free of the App so the rules can be tested
// without a running backend: the target must exist, the delivery must not be a
// self-delivery, and both conversations must live in the same workspace.
// projectRootOf mirrors the renderer's rule: every "no project" conversation lives in
// its own scratch workspace, but they all belong to the same Coding project, so they may
// exchange messages. A workspace inside another project is still refused.
var scratchWorkspacePattern = regexp.MustCompile(
	`^(.*/agent-workspaces/Coding)/无项目任务-[a-f0-9]{8}$`)
var legacyScratchWorkspacePattern = regexp.MustCompile(
	`^(.*/MilkSU/Coding)/(?:新编码任务|临时任务)-[a-f0-9]{8}$`)

func projectRootOf(workspacePath string) string {
	value := strings.TrimRight(strings.TrimSpace(workspacePath), "/")
	if value == "" {
		return ""
	}
	if match := scratchWorkspacePattern.FindStringSubmatch(value); match != nil {
		return match[1]
	}
	if match := legacyScratchWorkspacePattern.FindStringSubmatch(value); match != nil {
		return match[1]
	}
	return value
}

// agentCollaborationPolicy is the resolved cross-project gate. The zero value is the
// product default: off.
type agentCollaborationPolicy struct {
	AllowCrossConversation bool
	AllowByConversation    map[string][]string
	// ResultReplyByConversation is keyed by the conversation that was asked; it lists the
	// conversations allowed to answer it with a result.
	ResultReplyByConversation map[string][]string
}

func agentCollaborationPolicyFrom(value *config.AgentCollaborationConfig) agentCollaborationPolicy {
	if value == nil {
		return agentCollaborationPolicy{}
	}
	return agentCollaborationPolicy{
		AllowCrossConversation:    value.AllowCrossConversation,
		AllowByConversation:       value.AllowByConversation,
		ResultReplyByConversation: value.ResultReplyByConversation,
	}
}

// allows reports whether `source` explicitly listed `target`. The switch alone is not
// enough: an empty list opens the project boundary to nobody.
func (policy agentCollaborationPolicy) allows(source, target string) bool {
	if !policy.AllowCrossConversation {
		return false
	}
	for _, id := range policy.AllowByConversation[source] {
		if strings.TrimSpace(id) == target {
			return true
		}
	}
	return false
}

// allowsResultReply reports whether `asked` granted `replier` a result reply. The grant sits
// with the conversation that was asked, so it cannot be claimed by the replier.
func (policy agentCollaborationPolicy) allowsResultReply(replier, asked string) bool {
	if !policy.AllowCrossConversation {
		return false
	}
	for _, id := range policy.ResultReplyByConversation[asked] {
		if strings.TrimSpace(id) == replier {
			return true
		}
	}
	return false
}

// findStoredConversation resolves one conversation by id from a listing. The host uses it
// to look provenance up itself instead of trusting what a caller claims.
func findStoredConversation(
	stored []conversation.StoredConversation,
	id string,
) *conversation.StoredConversation {
	if id == "" {
		return nil
	}
	for index := range stored {
		if stored[index].ID == id {
			return &stored[index]
		}
	}
	return nil
}

// resolveAgentDeliveryOrigin is the host-side provenance lookup: the title and the agent
// name come from the stored conversation record, never from the caller.
func resolveAgentDeliveryOrigin(
	source conversation.StoredConversation,
	deliveredAt uint64,
) agentDeliveryOrigin {
	title := strings.TrimSpace(source.Title)
	if title == "" {
		title = source.ID
	}
	return agentDeliveryOrigin{
		ConversationID:    source.ID,
		ConversationTitle: title,
		Agent:             agentIdentityOf(source),
		DeliveredAt:       deliveredAt,
	}
}

// agentIdentityOf names the sending agent by the kernel it runs and, when known, the model
// it answers with. A constant "Agent" would make two different sources indistinguishable.
func agentIdentityOf(source conversation.StoredConversation) string {
	kernel := strings.TrimSpace(source.Kernel)
	model := strings.TrimSpace(source.ModelID)
	switch {
	case kernel != "" && model != "":
		return kernel + " \u00b7 " + model
	case kernel != "":
		return kernel
	case model != "":
		return model
	default:
		return "MilkSU agent"
	}
}

func validateAgentDelivery(
	stored []conversation.StoredConversation,
	input agentDeliveryInput,
) (string, error) {
	return validateAgentDeliveryWithPolicy(stored, input, agentCollaborationPolicy{})
}

// validateAgentDeliveryWithPolicy is the one place the delivery rules live, so the same
// order applies on both sides of the desktop boundary: existence and shape first, then
// the project boundary with the collaboration gate, and the caller applies the loop
// breaker and the flood limiter after this returns a target.
func validateAgentDeliveryWithPolicy(
	stored []conversation.StoredConversation,
	input agentDeliveryInput,
	policy agentCollaborationPolicy,
) (string, error) {
	target := strings.TrimSpace(input.TargetConversationID)
	text := strings.TrimSpace(input.Text)
	source := strings.TrimSpace(input.Origin.ConversationID)
	if target == "" || text == "" {
		return "", errors.New("targetConversationId and text are required")
	}
	if len([]rune(text)) > agentDeliveryMaxRunes {
		return "", errors.New("the delivered text is longer than 4000 characters")
	}
	if source != "" && source == target {
		return "", errors.New("a conversation cannot deliver a message to itself")
	}
	targetConversation := findStoredConversation(stored, target)
	sourceConversation := findStoredConversation(stored, source)
	if targetConversation == nil {
		return "", errors.New("target-not-found")
	}
	if source != "" {
		if sourceConversation == nil {
			return "", errors.New("source-not-found")
		}
		if projectRootOf(sourceConversation.WorkspacePath) !=
			projectRootOf(targetConversation.WorkspacePath) {
			if !policy.AllowCrossConversation {
				return "", errors.New("agent-collaboration-disabled: cross-project delivery is not allowed")
			}
			if !policy.allows(source, target) &&
				!(normalizeAgentDeliveryKind(input.Kind) == agentDeliveryKindResult &&
					policy.allowsResultReply(source, target)) {
				return "", errors.New("not-allowlisted")
			}
		}
	}
	return target, nil
}

// agentDeliveryLimiter keeps one conversation from flooding another (and from an
// A -> B -> A loop).
type agentDeliveryLimiter struct {
	mu       sync.Mutex
	recent   map[string][]time.Time
	sourceAt map[string][]time.Time
}

var agentDeliveryLimits = &agentDeliveryLimiter{
	recent:   map[string][]time.Time{},
	sourceAt: map[string][]time.Time{},
}

// allowSource 按来源（不区分目标）计数：一个会话无论发给谁，每分钟的量都有上限。
func (limiter *agentDeliveryLimiter) allowSource(source string) bool {
	now := time.Now()
	limiter.mu.Lock()
	defer limiter.mu.Unlock()
	key := strings.TrimSpace(source)
	kept := make([]time.Time, 0, len(limiter.sourceAt[key]))
	for _, at := range limiter.sourceAt[key] {
		if now.Sub(at) < agentDeliveryWindow {
			kept = append(kept, at)
		}
	}
	if len(kept) >= agentDeliverySourceBurst {
		limiter.sourceAt[key] = kept
		return false
	}
	limiter.sourceAt[key] = append(kept, now)
	return true
}

func (limiter *agentDeliveryLimiter) allow(source, target string) bool {
	key := source + "->" + target
	now := time.Now()
	limiter.mu.Lock()
	defer limiter.mu.Unlock()
	kept := make([]time.Time, 0, len(limiter.recent[key]))
	for _, at := range limiter.recent[key] {
		if now.Sub(at) < agentDeliveryWindow {
			kept = append(kept, at)
		}
	}
	if len(kept) >= agentDeliveryBurst {
		limiter.recent[key] = kept
		return false
	}
	limiter.recent[key] = append(kept, now)
	return true
}

func (limiter *agentDeliveryLimiter) reset() {
	limiter.mu.Lock()
	defer limiter.mu.Unlock()
	limiter.recent = map[string][]time.Time{}
	limiter.sourceAt = map[string][]time.Time{}
}

// A reply inside the window looks like the two conversations are talking to each other
// rather than to the reader, so that pair is broken for a cooldown. Only a reversal counts:
// two messages in the same direction are ordinary work, not a loop.
const (
	agentDeliveryLoopWindow   = 60 * time.Second
	agentDeliveryLoopCooldown = 5 * time.Minute
)

type agentDeliveryPairState struct {
	lastSource string
	lastAt     time.Time
}

type agentDeliveryLoopGuard struct {
	mu        sync.Mutex
	pairs     map[string]agentDeliveryPairState
	openUntil map[string]time.Time
	// budgets is the per-pair reverse-delivery budget; see app_agent_delivery_loop_budget.go.
	budgets map[string]loopBudgetState
	// openDirection remembers which way the delivery that tripped the budget was going.
	openDirection map[string]string
}

var agentDeliveryLoops = &agentDeliveryLoopGuard{
	pairs:     map[string]agentDeliveryPairState{},
	openUntil: map[string]time.Time{},
	budgets:   map[string]loopBudgetState{},
	openDirection: map[string]string{},
}

// A pair is unordered: the point is the ping-pong, not which side started it.
func agentDeliveryPairKey(a, b string) string {
	if a > b {
		a, b = b, a
	}
	return a + "\x00" + b
}

// remaining reports how long the pair stays broken, zero when it is open.
func (guard *agentDeliveryLoopGuard) remaining(source, target string, now time.Time) time.Duration {
	guard.mu.Lock()
	defer guard.mu.Unlock()
	key := agentDeliveryPairKey(source, target)
	until, ok := guard.openUntil[key]
	if !ok || !now.Before(until) {
		return 0
	}
	// A ping-pong needs both sides, so a cooldown only has to stop the *other* direction. The direction
	// that tripped the budget may keep working: that is not a loop, and a same-direction flood is already
	// capped by agentDeliverySourceBurst (12 per 10s across targets), so nothing is let through here.
	if guard.openDirection[key] == source {
		return 0
	}
	return until.Sub(now)
}
func (guard *agentDeliveryLoopGuard) record(source, target string, now time.Time) {
	guard.mu.Lock()
	defer guard.mu.Unlock()
	key := agentDeliveryPairKey(source, target)
	previous, ok := guard.pairs[key]
	guard.pairs[key] = agentDeliveryPairState{lastSource: source, lastAt: now}
	// Only a reversal can build a loop; two messages in the same direction are ordinary work.
	if !ok || previous.lastSource == source {
		return
	}
	if guard.budgets == nil {
		guard.budgets = map[string]loopBudgetState{}
	}
	if guard.openDirection == nil {
		guard.openDirection = map[string]string{}
	}
	// One reversal is an ordinary reply, so the pair is broken only once it goes past its budget for the
	// window; the cooldown starts short and escalates only on a repeat offence.
	state, decision := decideLoopBudget(guard.budgets[key], loopBudgetConfigFor(agentDeliveryLoopLevel()), now)
	guard.budgets[key] = state
	if decision.Allowed {
		return
	}
	guard.openDirection[key] = source
	guard.openUntil[key] = now.Add(decision.Remaining)
}
func (guard *agentDeliveryLoopGuard) reset() {
	guard.mu.Lock()
	defer guard.mu.Unlock()
	guard.pairs = map[string]agentDeliveryPairState{}
	guard.openUntil = map[string]time.Time{}
	guard.budgets = map[string]loopBudgetState{}
	guard.openDirection = map[string]string{}
}

// SettleAgentDelivery answers the sidecar tool call that is waiting on a delivery the
// renderer just filed. The renderer owns the schedule, so only it can say whether the
// message was dispatched or is queued behind another conversation in the same workspace.
func (a *App) SettleAgentDelivery(conversationID, requestID, status, detail string) error {
	// The outcome is part of the record: the backend announced the delivery, so it also
	// records where it landed. Without this the log stops at "announced".
	log.Printf(
		"[delivery] settled source=%s request=%s status=%s detail=%q",
		conversationID,
		requestID,
		status,
		detail,
	)
	if a.engines == nil {
		return errors.New("engine supervisor is unavailable")
	}
	return a.engines.SettleAgentDelivery(conversationID, requestID, status, detail)
}

// SetAgentCollaboration persists the cross-project delivery gate. It is a dedicated command
// so flipping the switch (or editing one chat's list) cannot be blocked by an unrelated,
// half-finished settings draft on the settings page - and so it is the only path that can
// change the gate at all.
func (a *App) SetAgentCollaboration(value config.AgentCollaborationConfig) error {
	return a.settings.SetAgentCollaboration(&value)
}

// DeliverAgentMessage announces a cross-conversation message. It never starts a turn
// itself: the renderer owns the schedule, so it decides between queueing and starting
// based on the target's real state.
func (a *App) DeliverAgentMessage(input agentDeliveryInput) (map[string]any, error) {
	stored, err := a.conversations.List()
	if err != nil {
		log.Printf("[delivery] refused reason=list_failed source=%s target=%s", input.Origin.ConversationID, input.TargetConversationID)
		return nil, err
	}
	collaboration := a.settings.Get().AgentCollaboration
	// 熔断档位与协作策略来自同一份设置：读不到/空/非法 ⇒ 标准档（不报错、不放宽）。
	setAgentDeliveryLoopLevel(agentDeliveryLoopLevelFrom(collaboration))
	policy := agentCollaborationPolicyFrom(collaboration)
	target, err := validateAgentDeliveryWithPolicy(stored, input, policy)
	if err != nil {
		// A refused delivery used to leave only a renderer-side notice. The backend log is
		// the one record that survives the renderer, so it belongs here too.
		log.Printf("[delivery] refused reason=%q source=%s target=%s", err.Error(), input.Origin.ConversationID, input.TargetConversationID)
		return nil, err
	}
	source := strings.TrimSpace(input.Origin.ConversationID)
	// Provenance is the host's to state: resolve the source title and agent from the stored
	// conversation, never from the request body.
	resolvedOrigin := agentDeliveryOrigin{}
	if sourceConversation := findStoredConversation(stored, source); sourceConversation != nil {
		resolvedOrigin = resolveAgentDeliveryOrigin(*sourceConversation, uint64(time.Now().UnixMilli()))
	}
	if source != "" {
		if remaining := agentDeliveryLoops.remaining(source, target, time.Now()); remaining > 0 {
			reason := fmt.Sprintf("loop-circuit-open: %s left", formatDeliveryCooldown(remaining))
			log.Printf("[delivery] refused reason=%q source=%s target=%s", reason, source, target)
			return nil, errors.New(reason)
		}
		if !agentDeliveryLimits.allowSource(source) {
			// 读得懂、能照做：告诉它"别换目标继续发，去汇报"，而不是只说一句 rate limited。
			reason := "rate limited: this conversation is sending too many cross-conversation messages " +
				"in a short window; report to the reader instead of retrying or switching targets"
			log.Printf("[delivery] refused reason=%q source=%s target=%s", reason, source, target)
			return nil, errors.New(reason)
		}
		if !agentDeliveryLimits.allow(source, target) {
			log.Printf("[delivery] refused reason=rate_limited source=%s target=%s", source, target)
			return nil, errors.New("rate limited: too many deliveries between these conversations")
		}
		agentDeliveryLoops.record(source, target, time.Now())
	}
	a.emitDesktopEvent(agentDeliveryEventName, agentDeliveryEvent{
		TargetConversationID: target,
		Text:                 strings.TrimSpace(input.Text),
		Origin:               resolvedOrigin,
		Kind:                 normalizeAgentDeliveryKind(input.Kind),
		RequestID:            strings.TrimSpace(input.RequestID),
	})
	log.Printf("[delivery] announced source=%s target=%s kind=%s runes=%d", source, target, normalizeAgentDeliveryKind(input.Kind), len([]rune(strings.TrimSpace(input.Text))))
	result := map[string]any{
		"delivered":            "announced",
		"targetConversationId": target,
		"kind":                 normalizeAgentDeliveryKind(input.Kind),
	}
	if resolvedOrigin.ConversationID != "" {
		result["origin"] = resolvedOrigin
	}
	if requestID := strings.TrimSpace(input.RequestID); requestID != "" {
		result["requestId"] = requestID
	}
	return result, nil
}

// formatDeliveryCooldown is the remaining circuit time the caller is told about, rounded up
// so "0s left" never appears while the pair is still broken.
func formatDeliveryCooldown(remaining time.Duration) string {
	seconds := int((remaining + time.Second - 1) / time.Second)
	if seconds < 0 {
		seconds = 0
	}
	if seconds >= 60 {
		return fmt.Sprintf("%dm%02ds", seconds/60, seconds%60)
	}
	return fmt.Sprintf("%ds", seconds)
}
