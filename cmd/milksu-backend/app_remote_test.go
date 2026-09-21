package main

import (
	"context"
	"testing"
	"time"

	"github.com/MilkSU-Official/milksu/internal/conversation"
	"github.com/MilkSU-Official/milksu/internal/engine"
)

// The engine's own status is per kernel, so the remote page needs this per-conversation
// activity window instead of the global running flag.
func TestConversationActivityWindowDrivesTheRunningFlag(t *testing.T) {
	app := &App{}
	app.trackRemoteViewEvent(engine.Event{SessionID: "conversation-1", Type: "assistant.delta"})

	if !app.conversationActiveRecently("conversation-1") {
		t.Fatal("a conversation that just produced an event must read as active")
	}
	if app.conversationActiveRecently("conversation-2") {
		t.Fatal("a conversation without events must not read as active")
	}

	app.turnActivityMu.Lock()
	app.turnActivity["conversation-1"] = time.Now().Add(-remoteActivityWindow - time.Minute)
	app.turnActivityMu.Unlock()
	if app.conversationActiveRecently("conversation-1") {
		t.Fatal("activity older than the window must not read as running")
	}
}

func TestApprovalTrackingKeepsOnlyPendingRequests(t *testing.T) {
	app := &App{}
	app.trackRemoteViewEvent(engine.Event{
		SessionID: "conversation-1", Type: "approval.requested",
		RequestID: "request-1", ToolName: "bash", Input: "rm -rf /tmp/x",
		Timestamp: "2026-09-13T02:00:00Z",
	})
	app.trackRemoteViewEvent(engine.Event{
		SessionID: "conversation-1", Type: "approval.requested",
		RequestID: "request-2", ToolName: "edit",
	})
	if pending := app.pendingApprovalList(); len(pending) != 2 {
		t.Fatalf("pending = %#v, want two requests", pending)
	}

	app.trackRemoteViewEvent(engine.Event{
		SessionID: "conversation-1", Type: "approval.resolved", RequestID: "request-1",
	})
	pending := app.pendingApprovalList()
	if len(pending) != 1 || pending[0].RequestID != "request-2" {
		t.Fatalf("pending after resolve = %#v", pending)
	}
	if pending[0].ToolName != "edit" {
		t.Fatalf("tool name = %q", pending[0].ToolName)
	}

	// An approval without a request id cannot be answered, so it is not shown.
	app.trackRemoteViewEvent(engine.Event{SessionID: "conversation-1", Type: "approval.requested"})
	if len(app.pendingApprovalList()) != 1 {
		t.Fatal("an unnamed request must be ignored")
	}
}

// The ask card's question and choices live in the approval input, so the page can render the
// same options the desktop card shows.
func TestParseAskCardReadsQuestionAndOptions(t *testing.T) {
	question, options := parseAskCard(`{"question":"选哪个？","options":[{"id":"a","label":"A 方案","detail":"快"},{"id":"b","text":"B 方案"}]}`)
	if question != "选哪个？" {
		t.Fatalf("question = %q", question)
	}
	if len(options) != 2 || options[0].ID != "a" || options[0].Label != "A 方案" || options[0].Detail != "快" {
		t.Fatalf("options = %#v", options)
	}
	if options[1].ID != "b" || options[1].Label != "B 方案" {
		t.Fatalf("text-only option = %#v", options[1])
	}

	// A choice without any label is skipped, and non-JSON input is simply not a card.
	if _, empty := parseAskCard(`{"question":"x","options":[{"id":"c"}]}`); len(empty) != 0 {
		t.Fatalf("options = %#v, want none", empty)
	}
	if question, options := parseAskCard("not json"); question != "" || options != nil {
		t.Fatalf("non-JSON input = %q %#v", question, options)
	}
}

// needs_decision mirrors the host sidebar: only a pending request id counts, so an answered
// prompt never keeps the conversation marked as waiting.
func TestConversationDecisionNeedsAPendingRequest(t *testing.T) {
	pending := "pending"
	approved := "approved"
	first := "request-1"
	second := "request-2"
	record := conversation.StoredConversation{
		Messages: []conversation.StoredMessage{
			{ID: "m1", ApprovalRequestID: &first, ApprovalState: &approved},
			{ID: "m2", ApprovalRequestID: &second, ApprovalState: &pending},
		},
	}
	needs, ids := conversationDecision(record)
	if !needs || len(ids) != 1 || ids[0] != "request-2" {
		t.Fatalf("decision = %v %#v", needs, ids)
	}
	if needs, _ := conversationDecision(conversation.StoredConversation{}); needs {
		t.Fatal("an empty conversation must not wait on the reader")
	}
}

// The queue only exists as an event, so the remote page reads this cache.
func TestQueueEventsFeedTheRemoteQueue(t *testing.T) {
	app := &App{}
	app.trackRemoteViewEvent(engine.Event{
		SessionID: "conversation-1", Type: "session.queue_updated",
		Steering: []string{"先保留修改"}, FollowUp: []string{"第一条", "第二条"},
	})
	queue := app.remoteQueueFor("conversation-1")
	if len(queue) != 3 {
		t.Fatalf("queue = %#v", queue)
	}
	if queue[0].Queue != "steering" || queue[0].Index != 0 || queue[0].Text != "先保留修改" {
		t.Fatalf("steering entry = %#v", queue[0])
	}
	if queue[2].Queue != "followUp" || queue[2].Index != 1 || queue[2].Text != "第二条" {
		t.Fatalf("followUp entry = %#v", queue[2])
	}

	// An empty update clears the cache, so a drained queue stops showing.
	app.trackRemoteViewEvent(engine.Event{SessionID: "conversation-1", Type: "session.queue_updated"})
	if queue := app.remoteQueueFor("conversation-1"); len(queue) != 0 {
		t.Fatalf("queue after drain = %#v", queue)
	}
}

// An ask approval reaches the page as a choice card, not as a bare tool prompt.
func TestAskApprovalBecomesAChoiceCard(t *testing.T) {
	app := &App{}
	app.trackRemoteViewEvent(engine.Event{
		SessionID: "conversation-1", Type: "approval.requested",
		RequestID: "request-ask", ToolName: remoteAskToolName, Grantable: true,
		Input:     `{"question":"选哪个？","options":[{"id":"a","label":"A"}]}`,
		Timestamp: "2026-09-21T02:00:00Z",
	})
	pending := app.pendingApprovalList()
	if len(pending) != 1 {
		t.Fatalf("pending = %#v", pending)
	}
	card := pending[0]
	if card.Kind != "ask" || card.Question != "选哪个？" || len(card.Options) != 1 {
		t.Fatalf("ask card = %#v", card)
	}
	if card.Dangerous {
		t.Fatal("an ask card is not a dangerous tool")
	}
}

// The bridge refuses a queue name or an approval scope the host does not understand, instead
// of passing it down to the engine.
func TestRemoteBridgeRefusesUnknownQueueAndScope(t *testing.T) {
	bridge := remoteControlBridge{app: &App{}}
	if err := bridge.RemoteWithdrawQueued(context.Background(), "conversation-1", "nope", 0, ""); err == nil {
		t.Fatal("an unknown queue must be refused")
	}
	if err := bridge.RemoteApproveTool(context.Background(), "conversation-1", "request-1", true, "everything", ""); err == nil {
		t.Fatal("an unknown scope must be refused")
	}
}

// Guidance only joins a turn once the tool it waits behind has finished, so the projection
// has to expose the same signal the composer uses — and an ask card is a question, not work
// that guidance queues behind.
func TestConversationToolRunningFollowsTheComposerRule(t *testing.T) {
	running := "running"
	done := "done"
	toolName := "bash"
	askName := remoteAskToolName

	withMessages := func(messages ...conversation.StoredMessage) conversation.StoredConversation {
		return conversation.StoredConversation{Messages: messages}
	}

	if !conversationToolRunning(withMessages(conversation.StoredMessage{
		Role: "tool", ToolName: &toolName, Status: &running,
	})) {
		t.Fatal("a running tool call must count as waiting for guidance")
	}
	if conversationToolRunning(withMessages(conversation.StoredMessage{
		Role: "tool", ToolName: &askName, Status: &running,
	})) {
		t.Fatal("an ask card is not a tool the guidance waits behind")
	}
	if conversationToolRunning(withMessages(conversation.StoredMessage{
		Role: "tool", ToolName: &toolName, Status: &done,
	})) {
		t.Fatal("a finished tool call must not count")
	}
	if conversationToolRunning(withMessages(conversation.StoredMessage{
		Role: "assistant", Status: &running,
	})) {
		t.Fatal("only tool messages count")
	}
	if conversationToolRunning(withMessages()) {
		t.Fatal("an empty conversation has nothing running")
	}
}
