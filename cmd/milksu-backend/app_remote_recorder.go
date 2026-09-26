package main

import (
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"

	"github.com/MilkSU-Official/milksu/internal/conversation"
	"github.com/MilkSU-Official/milksu/internal/engine"
)

// Conversation messages are normally persisted by the desktop renderer: it appends what
// the user typed and what the agent answered. A turn that a remote device starts has no
// renderer watching it, so the backend records those turns itself.
//
// The recorder only writes for conversations a remote device started a turn in, and it
// stops as soon as the renderer saves that conversation, so a locally opened conversation
// never gets duplicated messages.
const remoteTurnFlushInterval = 1500 * time.Millisecond

// remoteTurnStartedEventName tells the desktop renderer that a remote device sent a
// prompt. The renderer never typed that prompt, so without this event an open
// conversation would show only the reply: the renderer's next debounced save rewrites
// the stored messages from its own list and drops the prompt again.
const remoteTurnStartedEventName = "remote-turn-started"

type remoteTurnStartedEvent struct {
	ConversationID string                     `json:"conversationId"`
	Message        conversation.StoredMessage `json:"message"`
}

type remoteTurnRecorder struct {
	mu    sync.Mutex
	turns map[string]*remoteTurn
}

type remoteTurn struct {
	// assistantIndex is the position of the streaming assistant message, or -1 while it
	// does not exist yet.
	assistantIndex int
	buffer         string
	lastFlush      time.Time
	updatedAt      time.Time
}

func newRemoteTurnRecorder() *remoteTurnRecorder {
	return &remoteTurnRecorder{turns: make(map[string]*remoteTurn)}
}

func (recorder *remoteTurnRecorder) begin(conversationID string) {
	recorder.mu.Lock()
	defer recorder.mu.Unlock()
	recorder.turns[conversationID] = &remoteTurn{
		assistantIndex: -1,
		updatedAt:      time.Now(),
	}
}

// active reports whether the backend owns this conversation's messages right now.
func (recorder *remoteTurnRecorder) active(conversationID string) bool {
	recorder.mu.Lock()
	defer recorder.mu.Unlock()
	_, ok := recorder.turns[conversationID]
	return ok
}

// release stops recording, which is what happens once the renderer saves the
// conversation itself.
func (recorder *remoteTurnRecorder) release(conversationID string) {
	recorder.mu.Lock()
	defer recorder.mu.Unlock()
	delete(recorder.turns, conversationID)
}

// recordRemoteTurnStart stores the prompt a remote device sent and tells the desktop
// renderer about it, so an open conversation shows the prompt instead of only the reply.
func (a *App) recordRemoteTurnStart(conversationID, prompt string) {
	conversationID = strings.TrimSpace(conversationID)
	if conversationID == "" {
		return
	}
	stored, err := a.conversations.Get(conversationID)
	if err != nil {
		return
	}
	message := conversation.StoredMessage{
		ID:        uuid.NewString(),
		Role:      "user",
		Content:   prompt,
		Timestamp: uint64(time.Now().UnixMilli()),
		// The renderer writes user turns with a status, and the transcript reads it (only
		// "queued" is held back). A backend-written prompt must look the same, otherwise
		// the stored record differs depending on who typed it.
		Status: stringPointer("done"),
	}
	stored.Messages = append(stored.Messages, message)
	if err := a.conversations.Save(stored); err != nil {
		a.diagnostics.Record("remote-control", "warning", "remote prompt could not be stored")
		return
	}
	a.remoteTurnRecorder().begin(conversationID)
	a.emitDesktopEvent(remoteTurnStartedEventName, remoteTurnStartedEvent{
		ConversationID: conversationID,
		Message:        message,
	})
}

// recordRemoteTurnEvent folds one engine event into the conversation a remote device is
// driving. Streaming text is flushed on a short interval so the page keeps up without
// rewriting the conversation file for every token.
func (a *App) recordRemoteTurnEvent(event engine.Event) {
	conversationID := strings.TrimSpace(event.SessionID)
	if conversationID == "" || a.remoteTurns == nil || !a.remoteTurns.active(conversationID) {
		return
	}
	recorder := a.remoteTurns
	recorder.mu.Lock()
	turn, ok := recorder.turns[conversationID]
	recorder.mu.Unlock()
	if !ok {
		return
	}

	recorder.mu.Lock()
	now := time.Now()
	turn.updatedAt = now
	switch event.Type {
	case "assistant.delta":
		turn.buffer += event.Text
	case "assistant.completed":
		if strings.TrimSpace(event.Text) != "" {
			turn.buffer = event.Text
		}
	case "tool.started", "tool.completed":
		// Tool entries are written straight away: they are discrete, not streaming.
		// A tool call also ends the current assistant segment, so the next text becomes
		// its own message instead of overwriting the segment before the tool.
		turn.assistantIndex = -1
		recorder.mu.Unlock()
		a.appendRemoteToolMessage(conversationID, event)
		return
	case "engine.error", "engine.protocol_error":
		recorder.mu.Unlock()
		a.appendRemoteMessage(conversationID, conversation.StoredMessage{
			ID:        uuid.NewString(),
			Role:      "assistant",
			Content:   "运行时错误：" + firstLine(event.Error),
			Timestamp: uint64(now.UnixMilli()),
			Status:    stringPointer("error"),
		})
		return
	}
	flush := event.Type == "assistant.completed" || now.Sub(turn.lastFlush) >= remoteTurnFlushInterval
	text := turn.buffer
	index := turn.assistantIndex
	if flush {
		turn.lastFlush = now
	}
	recorder.mu.Unlock()

	if !flush || strings.TrimSpace(text) == "" {
		return
	}
	position := a.upsertRemoteAssistantMessage(conversationID, index, text)
	recorder.mu.Lock()
	if current, ok := recorder.turns[conversationID]; ok {
		current.assistantIndex = position
	}
	recorder.mu.Unlock()
}

// appendRemoteMessage adds one message to a conversation the backend is recording.
func (a *App) appendRemoteMessage(conversationID string, message conversation.StoredMessage) {
	stored, err := a.conversations.Get(conversationID)
	if err != nil {
		return
	}
	stored.Messages = append(stored.Messages, message)
	if err := a.conversations.Save(stored); err != nil {
		a.diagnostics.Record("remote-control", "warning", "remote turn message could not be stored")
	}
}

// appendRemoteToolMessage records a tool card for a remotely driven turn.
func (a *App) appendRemoteToolMessage(conversationID string, event engine.Event) {
	if strings.TrimSpace(event.ToolName) == "" {
		return
	}
	status := "running"
	if event.Type == "tool.completed" {
		status = "done"
	}
	toolName := event.ToolName
	message := conversation.StoredMessage{
		ID:        uuid.NewString(),
		Role:      "tool",
		Content:   strings.TrimSpace(event.Text),
		Timestamp: uint64(time.Now().UnixMilli()),
		ToolName:  &toolName,
		Status:    &status,
	}
	if strings.TrimSpace(event.ToolCallID) != "" {
		callID := event.ToolCallID
		message.ToolCallID = &callID
	}
	if event.DurationMS > 0 {
		duration := event.DurationMS
		message.DurationMS = &duration
	}
	a.appendRemoteMessage(conversationID, message)
}

// upsertRemoteAssistantMessage creates or updates the streaming assistant message and
// returns its index.
func (a *App) upsertRemoteAssistantMessage(conversationID string, index int, text string) int {
	stored, err := a.conversations.Get(conversationID)
	if err != nil {
		return index
	}
	if index >= 0 && index < len(stored.Messages) && stored.Messages[index].Role == "assistant" {
		stored.Messages[index].Content = text
	} else {
		stored.Messages = append(stored.Messages, conversation.StoredMessage{
			ID:        uuid.NewString(),
			Role:      "assistant",
			Content:   text,
			Timestamp: uint64(time.Now().UnixMilli()),
		})
		index = len(stored.Messages) - 1
	}
	if err := a.conversations.Save(stored); err != nil {
		a.diagnostics.Record("remote-control", "warning", "remote turn reply could not be stored")
	}
	return index
}

func firstLine(value string) string {
	trimmed := strings.TrimSpace(value)
	if index := strings.IndexByte(trimmed, '\n'); index >= 0 {
		trimmed = trimmed[:index]
	}
	runes := []rune(trimmed)
	if len(runes) > 300 {
		return string(runes[:300]) + "…"
	}
	return trimmed
}

func stringPointer(value string) *string { return &value }
