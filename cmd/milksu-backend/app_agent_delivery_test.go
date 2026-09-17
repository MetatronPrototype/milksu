package main

import (
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/MilkSU-Official/milksu/internal/conversation"
)

func deliveryInput(target, source, text string) agentDeliveryInput {
	return agentDeliveryInput{
		TargetConversationID: target,
		Text:                 text,
		Origin:               agentDeliverySource{ConversationID: source},
	}
}

func deliveryStore() []conversation.StoredConversation {
	return []conversation.StoredConversation{
		{ID: "conversation-a", Title: "A", WorkspacePath: "/tmp/agent-workspaces/Coding/无项目任务-aaaaaaaa"},
		{ID: "conversation-b", Title: "B", WorkspacePath: "/tmp/agent-workspaces/Coding/无项目任务-bbbbbbbb"},
		{ID: "conversation-c", Title: "C", WorkspacePath: "/tmp/projects/other-repo"},
	}
}

// The target is bound by the request, not by anything the reader is looking at.
func TestValidateAgentDeliveryAcceptsTheSameWorkspace(t *testing.T) {
	target, err := validateAgentDelivery(deliveryStore(), deliveryInput("conversation-b", "conversation-a", "任务"))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if target != "conversation-b" {
		t.Fatalf("target = %q, want conversation-b", target)
	}
}

func TestValidateAgentDeliveryRejectsCrossWorkspace(t *testing.T) {
	if _, err := validateAgentDelivery(deliveryStore(), deliveryInput("conversation-c", "conversation-a", "任务")); err == nil {
		t.Fatal("a cross-workspace delivery must be rejected")
	}
}

func TestValidateAgentDeliveryRejectsUnknownAndSelf(t *testing.T) {
	if _, err := validateAgentDelivery(deliveryStore(), deliveryInput("conversation-missing", "conversation-a", "任务")); err == nil {
		t.Fatal("an unknown target must be rejected")
	}
	if _, err := validateAgentDelivery(deliveryStore(), deliveryInput("conversation-a", "conversation-a", "任务")); err == nil {
		t.Fatal("a self delivery must be rejected")
	}
	if _, err := validateAgentDelivery(deliveryStore(), deliveryInput("conversation-b", "conversation-a", "   ")); err == nil {
		t.Fatal("an empty text must be rejected")
	}
}

// Two conversations must not be able to flood each other (an A -> B -> A loop).
func TestAgentDeliveryLimiterStopsAFlood(t *testing.T) {
	limiter := &agentDeliveryLimiter{recent: map[string][]time.Time{}}
	allowed := 0
	for index := 0; index < agentDeliveryBurst+3; index++ {
		if limiter.allow("conversation-a", "conversation-b") {
			allowed++
		}
	}
	if allowed != agentDeliveryBurst {
		t.Fatalf("allowed = %d, want %d", allowed, agentDeliveryBurst)
	}
	// The other direction has its own budget.
	if !limiter.allow("conversation-b", "conversation-a") {
		t.Fatal("the opposite direction must keep its own budget")
	}
	// An old burst no longer counts.
	limiter.mu.Lock()
	limiter.recent["conversation-a->conversation-b"] =
		[]time.Time{time.Now().Add(-agentDeliveryWindow - time.Second)}
	limiter.mu.Unlock()
	if !limiter.allow("conversation-a", "conversation-b") {
		t.Fatal("an expired burst must not block a new delivery")
	}
}

// b16-1: two "no project" conversations each have their own scratch workspace, but they
// belong to the same Coding project, so delivery between them must be allowed.
func TestValidateAgentDeliveryAllowsTwoScratchWorkspaces(t *testing.T) {
	target, err := validateAgentDelivery(deliveryStore(), deliveryInput("conversation-b", "conversation-a", "任务"))
	if err != nil {
		t.Fatalf("two scratch workspaces must be allowed: %v", err)
	}
	if target != "conversation-b" {
		t.Fatalf("target = %q, want conversation-b", target)
	}
}

// b16-2 and b16-4: the same table as the renderer uses. A different project stays refused.
func TestProjectRootBoundaryMatchesTheRenderer(t *testing.T) {
	cases := []struct {
		name    string
		source  string
		target  string
		allowed bool
	}{
		{"same scratch root", "/tmp/agent-workspaces/Coding/无项目任务-aaaaaaaa", "/tmp/agent-workspaces/Coding/无项目任务-bbbbbbbb", true},
		{"same scratch root, legacy form", "/tmp/MilkSU/Coding/新编码任务-aaaaaaaa", "/tmp/MilkSU/Coding/临时任务-bbbbbbbb", true},
		{"same real project", "/tmp/projects/one", "/tmp/projects/one", true},
		{"different project", "/tmp/agent-workspaces/Coding/无项目任务-aaaaaaaa", "/tmp/projects/one", false},
		{"different project, two reals", "/tmp/projects/one", "/tmp/projects/two", false},
	}
	for _, item := range cases {
		t.Run(item.name, func(t *testing.T) {
			stored := []conversation.StoredConversation{
				{ID: "conversation-a", Title: "A", WorkspacePath: item.source},
				{ID: "conversation-b", Title: "B", WorkspacePath: item.target},
			}
			_, err := validateAgentDelivery(stored, deliveryInput("conversation-b", "conversation-a", "任务"))
			if item.allowed && err != nil {
				t.Fatalf("expected allowed, got %v", err)
			}
			if !item.allowed && err == nil {
				t.Fatal("expected refused")
			}
		})
	}
}

// The collaboration gate only opens a cross-project delivery. Off (the product default)
// must keep exactly the previous behaviour.
func TestValidateAgentDeliveryCollaborationGate(t *testing.T) {
	store := deliveryStore()
	crossProject := deliveryInput("conversation-c", "conversation-a", "任务")

	_, err := validateAgentDeliveryWithPolicy(store, crossProject, agentCollaborationPolicy{})
	if err == nil || !strings.Contains(err.Error(), "agent-collaboration-disabled") {
		t.Fatalf("a switched-off gate must refuse at the boundary, got %v", err)
	}
	// The same project is unaffected by the switch: delivery never needed the gate there.
	if _, err := validateAgentDeliveryWithPolicy(
		store,
		deliveryInput("conversation-b", "conversation-a", "任务"),
		agentCollaborationPolicy{},
	); err != nil {
		t.Fatalf("a same-project delivery must not need the gate: %v", err)
	}

	onButEmpty := agentCollaborationPolicy{AllowCrossConversation: true}
	_, err = validateAgentDeliveryWithPolicy(store, crossProject, onButEmpty)
	if err == nil || !strings.Contains(err.Error(), "not-allowlisted") {
		t.Fatalf("the switch alone must not open the boundary, got %v", err)
	}

	allowlisted := agentCollaborationPolicy{
		AllowCrossConversation: true,
		AllowByConversation:    map[string][]string{"conversation-a": {"conversation-c"}},
	}
	target, err := validateAgentDeliveryWithPolicy(store, crossProject, allowlisted)
	if err != nil {
		t.Fatalf("an allowlisted cross-project delivery must be allowed: %v", err)
	}
	if target != "conversation-c" {
		t.Fatalf("target = %q, want conversation-c", target)
	}
	// Bidirectional independence: B listing C does not let A reach C.
	_, err = validateAgentDeliveryWithPolicy(store, crossProject, agentCollaborationPolicy{
		AllowCrossConversation: true,
		AllowByConversation:    map[string][]string{"conversation-b": {"conversation-c"}},
	})
	if err == nil || !strings.Contains(err.Error(), "not-allowlisted") {
		t.Fatalf("each source needs its own allowlist, got %v", err)
	}
}

func TestAgentCollaborationPolicyAllowsOnlyExactTargets(t *testing.T) {
	policy := agentCollaborationPolicy{
		AllowCrossConversation: true,
		AllowByConversation:    map[string][]string{"conversation-a": {"conversation-c"}},
	}
	if !policy.allows("conversation-a", "conversation-c") {
		t.Fatal("an exact allowlisted target must be allowed")
	}
	if policy.allows("conversation-a", "conversation-d") {
		t.Fatal("an unlisted target must be refused")
	}
	if policy.allows("conversation-b", "conversation-c") {
		t.Fatal("the list is per source conversation")
	}
}

func newLoopGuard() *agentDeliveryLoopGuard {
	return &agentDeliveryLoopGuard{
		pairs:     map[string]agentDeliveryPairState{},
		openUntil: map[string]time.Time{},
	}
}

// A reversal inside the window is the ping-pong that must be broken; two messages the same
// way are ordinary work and must not break anything.
func TestAgentDeliveryLoopGuardBreaksOnlyAReversal(t *testing.T) {
	guard := newLoopGuard()
	start := time.Now()
	guard.record("conversation-a", "conversation-b", start)
	guard.record("conversation-a", "conversation-b", start.Add(10*time.Second))
	if remaining := guard.remaining("conversation-a", "conversation-b", start.Add(11*time.Second)); remaining != 0 {
		t.Fatalf("same-direction work must not open the circuit, got %s", remaining)
	}

	guard.record("conversation-b", "conversation-a", start.Add(20*time.Second))
	remaining := guard.remaining("conversation-a", "conversation-b", start.Add(21*time.Second))
	if remaining <= 0 || remaining > agentDeliveryLoopCooldown {
		t.Fatalf("a reversal inside the window must break the pair, got %s", remaining)
	}
	// The pair is unordered: the direction that opened it is broken too.
	if guard.remaining("conversation-b", "conversation-a", start.Add(21*time.Second)) <= 0 {
		t.Fatal("the broken pair must cover both directions")
	}
	// A pair that did not ping-pong is untouched.
	if guard.remaining("conversation-a", "conversation-c", start.Add(21*time.Second)) != 0 {
		t.Fatal("an unrelated pair must stay open")
	}
}

func TestAgentDeliveryLoopGuardRecoversAfterCooldown(t *testing.T) {
	guard := newLoopGuard()
	start := time.Now()
	guard.record("conversation-a", "conversation-b", start)
	guard.record("conversation-b", "conversation-a", start.Add(5*time.Second))
	if guard.remaining("conversation-a", "conversation-b", start.Add(6*time.Second)) <= 0 {
		t.Fatal("the circuit must be open right after the reversal")
	}
	afterCooldown := start.Add(agentDeliveryLoopCooldown + 6*time.Second)
	if remaining := guard.remaining("conversation-a", "conversation-b", afterCooldown); remaining != 0 {
		t.Fatalf("the pair must recover after the cooldown, got %s", remaining)
	}
	// A reply that comes long after the window is not a ping-pong, so it must not re-open.
	guard.record("conversation-a", "conversation-b", afterCooldown)
	if remaining := guard.remaining("conversation-a", "conversation-b", afterCooldown); remaining != 0 {
		t.Fatalf("a late reply must not re-open the circuit, got %s", remaining)
	}
}

func TestFormatDeliveryCooldownRoundsUp(t *testing.T) {
	cases := []struct {
		remaining time.Duration
		want      string
	}{
		{4*time.Minute + 12*time.Second, "4m12s"},
		{45 * time.Second, "45s"},
		{time.Millisecond, "1s"},
		{-time.Second, "0s"},
	}
	for _, item := range cases {
		if got := formatDeliveryCooldown(item.remaining); got != item.want {
			t.Fatalf("formatDeliveryCooldown(%s) = %q, want %q", item.remaining, got, item.want)
		}
	}
}

// Provenance is the host's to state. The caller can only name its own id; the title and the
// agent name are looked up from the conversation record.
func TestResolveAgentDeliveryOriginComesFromTheRecord(t *testing.T) {
	source := conversation.StoredConversation{
		ID:            "conversation-a",
		Title:         "真正来源",
		Kernel:        "pi",
		ModelID:       "deepseek-v4-pro",
		WorkspacePath: "/tmp/projects/one",
	}
	origin := resolveAgentDeliveryOrigin(source, 1234)
	if origin.ConversationID != "conversation-a" {
		t.Fatalf("conversationId = %q", origin.ConversationID)
	}
	if origin.ConversationTitle != "真正来源" {
		t.Fatalf("conversationTitle = %q, want the stored title", origin.ConversationTitle)
	}
	if origin.Agent != "pi · deepseek-v4-pro" {
		t.Fatalf("agent = %q, want kernel and model", origin.Agent)
	}
	if origin.DeliveredAt != 1234 {
		t.Fatalf("deliveredAt = %d, want the host clock", origin.DeliveredAt)
	}
}

func TestAgentIdentityFallsBackWithoutInventingAName(t *testing.T) {
	cases := []struct {
		source conversation.StoredConversation
		want   string
	}{
		{conversation.StoredConversation{Kernel: "dsh"}, "dsh"},
		{conversation.StoredConversation{ModelID: "gpt-test"}, "gpt-test"},
		{conversation.StoredConversation{}, "MilkSU agent"},
		{conversation.StoredConversation{Title: "只有标题"}, "MilkSU agent"},
	}
	for _, item := range cases {
		if got := agentIdentityOf(item.source); got != item.want {
			t.Fatalf("agentIdentityOf(%#v) = %q, want %q", item.source, got, item.want)
		}
	}
}

// An untitled conversation must still be identifiable, but by its id rather than an empty
// label that would render as "来自会话：".
func TestResolveAgentDeliveryOriginFallsBackToTheId(t *testing.T) {
	origin := resolveAgentDeliveryOrigin(conversation.StoredConversation{ID: "conversation-z"}, 7)
	if origin.ConversationTitle != "conversation-z" {
		t.Fatalf("conversationTitle = %q, want the id fallback", origin.ConversationTitle)
	}
}

// The caller cannot widen the origin: the request only carries the source id, and the host
// fills the rest. Keeping this test on the input shape pins the guarantee at compile time.
func TestAgentDeliveryInputCarriesNoSourceTitle(t *testing.T) {
	input := deliveryInput("conversation-b", "conversation-a", "任务")
	encoded, err := json.Marshal(input)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	body := string(encoded)
	if strings.Contains(body, "conversationTitle") || strings.Contains(body, "\"agent\"") {
		t.Fatalf("the delivery request must not carry a caller-chosen title/agent: %s", body)
	}
}

// Provenance has to survive the settings/conversation store's JSON round trip, otherwise the
// badge disappears on the next launch.
func TestStoredMessageOriginSurvivesJSON(t *testing.T) {
	original := conversation.StoredMessage{
		ID:      "m1",
		Role:    "user",
		Content: "跨会话内容",
		Origin: &conversation.StoredMessageOrigin{
			ConversationID:    "conversation-a",
			ConversationTitle: "真来源",
			Agent:             "pi · deepseek-v4-pro",
			DeliveredAt:       4242,
		},
	}
	raw, err := json.Marshal(original)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	var decoded conversation.StoredMessage
	if err := json.Unmarshal(raw, &decoded); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if decoded.Origin == nil || *decoded.Origin != *original.Origin {
		t.Fatalf("origin = %#v, want %#v", decoded.Origin, original.Origin)
	}
	// A reader's own message must not gain an origin from the round trip.
	plain := conversation.StoredMessage{ID: "m2", Role: "user", Content: "普通消息"}
	encoded, err := json.Marshal(plain)
	if err != nil {
		t.Fatalf("marshal plain: %v", err)
	}
	if strings.Contains(string(encoded), "origin") {
		t.Fatalf("a plain message must not serialize an origin: %s", encoded)
	}
}

// The reverse direction defaults to a result reply: the conversation that asked may grant a
// replier an answer, and that grant never carries a new request.
func TestResultReplyGrantAllowsOnlyAResult(t *testing.T) {
	store := deliveryStore()
	policy := agentCollaborationPolicy{
		AllowCrossConversation:    true,
		ResultReplyByConversation: map[string][]string{"conversation-a": {"conversation-c"}},
	}

	result := deliveryInput("conversation-a", "conversation-c", "结果：已完成")
	result.Kind = "result"
	target, err := validateAgentDeliveryWithPolicy(store, result, policy)
	if err != nil {
		t.Fatalf("a granted result reply must be allowed: %v", err)
	}
	if target != "conversation-a" {
		t.Fatalf("target = %q, want conversation-a", target)
	}

	request := deliveryInput("conversation-a", "conversation-c", "再帮我做一件事")
	request.Kind = "request"
	if _, err := validateAgentDeliveryWithPolicy(store, request, policy); err == nil ||
		!strings.Contains(err.Error(), "not-allowlisted") {
		t.Fatalf("the grant must not allow a reverse request, got %v", err)
	}

	unknown := deliveryInput("conversation-a", "conversation-c", "x")
	unknown.Kind = "please"
	if _, err := validateAgentDeliveryWithPolicy(store, unknown, policy); err == nil {
		t.Fatal("an unknown kind must read as a request and stay refused")
	}

	// Without the switch the grant is inert too.
	off := agentCollaborationPolicy{ResultReplyByConversation: policy.ResultReplyByConversation}
	if _, err := validateAgentDeliveryWithPolicy(store, result, off); err == nil ||
		!strings.Contains(err.Error(), "agent-collaboration-disabled") {
		t.Fatalf("a switched-off gate must stay closed, got %v", err)
	}
}

func TestNormalizeAgentDeliveryKind(t *testing.T) {
	cases := map[string]string{
		"":         agentDeliveryKindRequest,
		"request":  agentDeliveryKindRequest,
		"REQUEST":  agentDeliveryKindRequest,
		" result ": agentDeliveryKindResult,
		"Result":   agentDeliveryKindResult,
		"other":    agentDeliveryKindRequest,
	}
	for input, want := range cases {
		if got := normalizeAgentDeliveryKind(input); got != want {
			t.Fatalf("normalizeAgentDeliveryKind(%q) = %q, want %q", input, got, want)
		}
	}
}
