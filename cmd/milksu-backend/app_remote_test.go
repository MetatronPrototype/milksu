package main

import (
	"testing"
	"time"

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
