package main

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/google/uuid"

	"github.com/MilkSU-Official/milksu/internal/appdata"
	"github.com/MilkSU-Official/milksu/internal/conversation"
	"github.com/MilkSU-Official/milksu/internal/engine"
)

// A turn a remote device starts has no renderer watching it, so the backend has to store
// the prompt, the streamed reply and the tool cards itself.
func TestRemoteTurnRecorderStoresPromptReplyAndTools(t *testing.T) {
	t.Setenv("MILKSU_APPDATA_DIR", t.TempDir())
	store, err := conversation.NewStore()
	if err != nil {
		t.Fatal(err)
	}
	app := &App{
		conversations: store,
		diagnostics:   appdata.NewDiagnosticRecorder(32),
	}
	record := conversation.StoredConversation{
		ID:     uuid.NewString(),
		Title:  "远端自检",
		Kernel: conversation.KernelPi,
	}
	if err := store.Save(record); err != nil {
		t.Fatal(err)
	}

	app.recordRemoteTurnStart(record.ID, "跑一下测试")
	app.recordRemoteTurnEvent(engine.Event{SessionID: record.ID, Type: "assistant.delta", Text: "好的"})
	app.recordRemoteTurnEvent(engine.Event{SessionID: record.ID, Type: "assistant.completed", Text: "好的，已经完成。"})
	app.recordRemoteTurnEvent(engine.Event{
		SessionID: record.ID, Type: "tool.completed",
		ToolName: "bash", ToolCallID: "call-1", DurationMS: 12, Text: "ok",
	})

	stored, err := store.Get(record.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(stored.Messages) != 3 {
		t.Fatalf("messages = %d, want user + reply + tool", len(stored.Messages))
	}
	if stored.Messages[0].Role != "user" || stored.Messages[0].Content != "跑一下测试" {
		t.Fatalf("first message = %#v", stored.Messages[0])
	}
	// 后端自己写的用户消息要和渲染进程写的同形：转写只拦 status="queued"，
	// 缺字段的旧记录曾经让远端那句话在主机侧看不见。
	if stored.Messages[0].Status == nil || *stored.Messages[0].Status != "done" {
		t.Fatalf("remote prompt status = %#v, want done", stored.Messages[0].Status)
	}
	if stored.Messages[1].Role != "assistant" || stored.Messages[1].Content != "好的，已经完成。" {
		t.Fatalf("assistant message = %#v", stored.Messages[1])
	}
	if stored.Messages[2].Role != "tool" || stored.Messages[2].ToolName == nil || *stored.Messages[2].ToolName != "bash" {
		t.Fatalf("tool message = %#v", stored.Messages[2])
	}

	// A streaming reply must update the same assistant message instead of piling up
	// one message per token.
	app.recordRemoteTurnEvent(engine.Event{SessionID: record.ID, Type: "assistant.delta", Text: "第二段"})
	app.recordRemoteTurnEvent(engine.Event{SessionID: record.ID, Type: "assistant.completed", Text: "第二段完成"})
	stored, err = store.Get(record.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(stored.Messages) != 4 {
		t.Fatalf("messages after a second reply = %d, want 4", len(stored.Messages))
	}
	if stored.Messages[3].Content != "第二段完成" {
		t.Fatalf("second reply = %#v", stored.Messages[3])
	}
}

// recordingDesktopHost captures the events the backend pushes to the renderer.
type recordingDesktopHost struct {
	events []recordedDesktopEvent
}

type recordedDesktopEvent struct {
	name  string
	value any
}

func (host *recordingDesktopHost) Emit(name string, value any) {
	host.events = append(host.events, recordedDesktopEvent{name: name, value: value})
}

func (host *recordingDesktopHost) Call(context.Context, string, any, any) error { return nil }

// An open conversation is persisted by the renderer, which never typed the remote prompt.
// The backend therefore has to broadcast the prompt: otherwise the renderer's next save
// rewrites the stored messages without it and the host shows only the reply.
func TestRemoteTurnStartBroadcastsThePromptToTheRenderer(t *testing.T) {
	t.Setenv("MILKSU_APPDATA_DIR", t.TempDir())
	store, err := conversation.NewStore()
	if err != nil {
		t.Fatal(err)
	}
	host := &recordingDesktopHost{}
	app := &App{
		ctx:           context.Background(),
		host:          host,
		conversations: store,
		diagnostics:   appdata.NewDiagnosticRecorder(32),
	}
	record := conversation.StoredConversation{
		ID:     uuid.NewString(),
		Title:  "远端提示",
		Kernel: conversation.KernelPi,
	}
	if err := store.Save(record); err != nil {
		t.Fatal(err)
	}

	app.recordRemoteTurnStart(record.ID, "从手机发的消息")

	if len(host.events) != 1 {
		t.Fatalf("events = %#v, want exactly one broadcast", host.events)
	}
	if host.events[0].name != remoteTurnStartedEventName {
		t.Fatalf("event name = %q", host.events[0].name)
	}
	broadcast, ok := host.events[0].value.(remoteTurnStartedEvent)
	if !ok {
		t.Fatalf("payload = %#v", host.events[0].value)
	}
	if broadcast.ConversationID != record.ID {
		t.Fatalf("conversation = %q, want %q", broadcast.ConversationID, record.ID)
	}
	if broadcast.Message.Role != "user" || broadcast.Message.Content != "从手机发的消息" {
		t.Fatalf("message = %#v", broadcast.Message)
	}
	if broadcast.Message.ID == "" {
		t.Fatal("the broadcast message must carry the id written to disk")
	}

	// The renderer reads the payload by these names, so pin the wire format.
	raw, err := json.Marshal(broadcast)
	if err != nil {
		t.Fatal(err)
	}
	var wire map[string]any
	if err := json.Unmarshal(raw, &wire); err != nil {
		t.Fatal(err)
	}
	if _, ok := wire["conversationId"].(string); !ok {
		t.Fatalf("conversationId missing from %s", raw)
	}
	payloadMessage, ok := wire["message"].(map[string]any)
	if !ok {
		t.Fatalf("message missing from %s", raw)
	}
	for _, field := range []string{"id", "role", "content", "timestamp"} {
		if _, ok := payloadMessage[field]; !ok {
			t.Fatalf("message.%s missing from %s", field, raw)
		}
	}

	// The broadcast and the stored message share one id, so the renderer appending the
	// broadcast and then saving keeps exactly one copy.
	stored, err := store.Get(record.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(stored.Messages) != 1 || stored.Messages[0].ID != broadcast.Message.ID {
		t.Fatalf("stored messages = %#v, broadcast id = %q", stored.Messages, broadcast.Message.ID)
	}
}

// Once the desktop renderer saves a conversation it owns the messages again, so the
// backend must stop writing to avoid duplicates.
func TestRemoteTurnRecorderStopsWhenTheRendererTakesOver(t *testing.T) {
	t.Setenv("MILKSU_APPDATA_DIR", t.TempDir())
	store, err := conversation.NewStore()
	if err != nil {
		t.Fatal(err)
	}
	app := &App{
		conversations: store,
		diagnostics:   appdata.NewDiagnosticRecorder(32),
	}
	record := conversation.StoredConversation{ID: uuid.NewString(), Title: "接管", Kernel: conversation.KernelPi}
	if err := store.Save(record); err != nil {
		t.Fatal(err)
	}

	app.recordRemoteTurnStart(record.ID, "远端消息")
	stored, err := store.Get(record.ID)
	if err != nil {
		t.Fatal(err)
	}
	if err := app.SaveConversation(stored); err != nil {
		t.Fatal(err)
	}

	app.recordRemoteTurnEvent(engine.Event{SessionID: record.ID, Type: "assistant.completed", Text: "不该被写入"})
	final, err := store.Get(record.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(final.Messages) != 1 {
		t.Fatalf("messages = %d, want only the remotely stored prompt", len(final.Messages))
	}
}
