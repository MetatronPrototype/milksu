package main

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/MilkSU-Official/milksu/internal/config"
	"github.com/MilkSU-Official/milksu/internal/conversation"
	"github.com/MilkSU-Official/milksu/internal/engine"
	"github.com/MilkSU-Official/milksu/internal/remotecontrol"
)

const (
	// remoteSnapshotConversations bounds how many conversations the remote page shows.
	remoteSnapshotConversations = 12
	// remoteSnapshotMessages bounds how many recent messages each conversation shows.
	remoteSnapshotMessages = 30
	// remoteMessageRunes keeps one message small enough for a phone screen.
	remoteMessageRunes = 700
)

// remoteTurnRecorder lazily creates the recorder for remotely driven turns.
func (a *App) remoteTurnRecorder() *remoteTurnRecorder {
	a.remoteControlMu.Lock()
	defer a.remoteControlMu.Unlock()
	if a.remoteTurns == nil {
		a.remoteTurns = newRemoteTurnRecorder()
	}
	return a.remoteTurns
}

// remoteControlManager lazily creates the LAN companion server, so a user who never
// enables it never gets a state file either.
func (a *App) remoteControlManager() *remotecontrol.Manager {
	a.remoteControlMu.Lock()
	defer a.remoteControlMu.Unlock()
	if a.remoteControls == nil {
		a.remoteControls = remotecontrol.New(a.dataDirectory, remoteControlBridge{app: a}, remoteControlBridge{app: a})
	}
	return a.remoteControls
}

func remoteControlSettings(settings config.AppSettings) remotecontrol.Settings {
	configured := remotecontrol.Settings{Enabled: false, BindMode: remotecontrol.BindModeLAN}
	if settings.RemoteControl != nil {
		configured.Enabled = settings.RemoteControl.Enabled
		if strings.TrimSpace(settings.RemoteControl.BindMode) != "" {
			configured.BindMode = settings.RemoteControl.BindMode
		}
		configured.Port = settings.RemoteControl.Port
	}
	return configured
}

// syncRemoteControl makes the listener match the stored settings. It is idempotent, so
// it is safe to call on startup, after a settings save and when the panel is opened.
func (a *App) syncRemoteControl() remotecontrol.Status {
	settings := a.settings.Get()
	status := a.remoteControlManager().Apply(remoteControlSettings(settings))
	// Remember the port that was actually bound, so the address handed to a phone keeps
	// working after a restart instead of moving to a new random port.
	if status.Running && status.Port > 0 && (settings.RemoteControl == nil || settings.RemoteControl.Port != status.Port) {
		next := a.settings.Get()
		configured := config.RemoteControlConfig{Enabled: true, BindMode: status.BindMode, Port: status.Port}
		if next.RemoteControl != nil {
			configured = *next.RemoteControl
			configured.Enabled = true
			configured.BindMode = status.BindMode
			configured.Port = status.Port
		}
		next.RemoteControl = &configured
		if err := a.settings.Save(next); err != nil {
			a.diagnostics.Record("remote-control", "warning", "remote control port could not be remembered")
		}
	}
	return status
}

// GetRemoteControlStatus reports the listener, its URL, the access password and the
// paired devices.
func (a *App) GetRemoteControlStatus() remotecontrol.Status {
	return a.syncRemoteControl()
}

// SetRemoteControl stores the switch, the bind mode and the preferred port.
func (a *App) SetRemoteControl(enabled bool, bindMode string, port int) error {
	normalizedMode := strings.TrimSpace(bindMode)
	if normalizedMode == "" {
		normalizedMode = remotecontrol.BindModeLAN
	}
	if normalizedMode != remotecontrol.BindModeLAN && normalizedMode != remotecontrol.BindModeLocal {
		return fmt.Errorf("未知的访问范围 %q，只支持 lan 或 local", bindMode)
	}
	if port < 0 || port > 65535 {
		return fmt.Errorf("端口 %d 无效", port)
	}
	next := a.settings.Get()
	next.RemoteControl = &config.RemoteControlConfig{
		Enabled:  enabled,
		BindMode: normalizedMode,
		Port:     port,
	}
	if err := a.settings.Save(next); err != nil {
		return err
	}
	status := a.syncRemoteControl()
	if enabled && !status.Running {
		if status.Error != "" {
			return fmt.Errorf("远端控制未能启动：%s", status.Error)
		}
		return fmt.Errorf("远端控制未能启动")
	}
	return nil
}

// RotateRemotePassword issues a new access password and unpairs every device.
func (a *App) RotateRemotePassword() (string, error) {
	manager := a.remoteControlManager()
	return manager.RotatePassword(), nil
}

// RevokeRemoteDevice unpairs one device immediately.
func (a *App) RevokeRemoteDevice(id string) error {
	return a.remoteControlManager().RevokeDevice(id)
}

// remoteActivityWindow is how long a conversation keeps counting as active after its
// last engine event. Generation, tool calls and results all refresh it.
const remoteActivityWindow = 5 * time.Minute

// trackRemoteViewEvent records what the remote page may show: which conversations are
// working, and which permission prompts are waiting. Approving stays a local action, so
// this only records what is pending.
func (a *App) trackRemoteViewEvent(event engine.Event) {
	if sessionID := strings.TrimSpace(event.SessionID); sessionID != "" {
		a.turnActivityMu.Lock()
		if a.turnActivity == nil {
			a.turnActivity = make(map[string]time.Time)
		}
		a.turnActivity[sessionID] = time.Now()
		a.turnActivityMu.Unlock()
	}
	switch event.Type {
	case "approval.requested":
		requestID := strings.TrimSpace(event.RequestID)
		if requestID == "" {
			return
		}
		a.approvalMu.Lock()
		defer a.approvalMu.Unlock()
		if a.pendingApprovals == nil {
			a.pendingApprovals = make(map[string]remotecontrol.Approval)
		}
		a.pendingApprovals[requestID] = remotecontrol.Approval{
			RequestID:      requestID,
			ConversationID: event.SessionID,
			ToolName:       event.ToolName,
			Input:          truncateRunes(event.Input, 400),
			RequestedAt:    event.Timestamp,
		}
	case "approval.resolved":
		a.approvalMu.Lock()
		defer a.approvalMu.Unlock()
		delete(a.pendingApprovals, strings.TrimSpace(event.RequestID))
	}
}

func (a *App) conversationActiveRecently(sessionID string) bool {
	a.turnActivityMu.Lock()
	defer a.turnActivityMu.Unlock()
	at, seen := a.turnActivity[strings.TrimSpace(sessionID)]
	return seen && time.Since(at) < remoteActivityWindow
}

func (a *App) pendingApprovalList() []remotecontrol.Approval {
	a.approvalMu.Lock()
	defer a.approvalMu.Unlock()
	if len(a.pendingApprovals) == 0 {
		return nil
	}
	approvals := make([]remotecontrol.Approval, 0, len(a.pendingApprovals))
	for _, approval := range a.pendingApprovals {
		approvals = append(approvals, approval)
	}
	sort.Slice(approvals, func(i, j int) bool {
		return approvals[i].RequestedAt < approvals[j].RequestedAt
	})
	return approvals
}

// remoteControlBridge adapts the App to the remote page: it supplies the projection and
// performs the actions a control-capable device may request, without adding another
// exported method to the desktop RPC surface.
type remoteControlBridge struct{ app *App }

func (bridge remoteControlBridge) RemoteControlSnapshot(ctx context.Context, _ remotecontrol.Device) (remotecontrol.Snapshot, error) {
	return bridge.app.remoteControlSnapshot(ctx)
}

// remoteControlSnapshot builds the read-only projection the remote page renders.
func (a *App) remoteControlSnapshot(_ context.Context) (remotecontrol.Snapshot, error) {
	settings := a.settings.Get()
	snapshot := remotecontrol.Snapshot{
		GeneratedAt: time.Now().UTC().Format(time.RFC3339),
		Context: remotecontrol.ContextSummary{
			ActiveProvider: settings.ActiveProvider,
			ActiveModel:    settings.ActiveModel,
		},
	}
	snapshot.Approvals = a.pendingApprovalList()
	snapshot.Context.PendingApprovals = len(snapshot.Approvals)
	snapshot.Models = a.remoteModelOptions(settings)
	snapshot.Policies = a.remotePolicyOptions()

	stored, err := a.conversations.List()
	if err != nil {
		return remotecontrol.Snapshot{}, fmt.Errorf("读取会话列表失败：%w", err)
	}
	sort.Slice(stored, func(i, j int) bool {
		return lastMessageAt(stored[i]) > lastMessageAt(stored[j])
	})
	if len(stored) > remoteSnapshotConversations {
		stored = stored[:remoteSnapshotConversations]
	}

	for _, conversation := range stored {
		projection := remotecontrol.Conversation{
			ID:             conversation.ID,
			Title:          conversation.Title,
			WorkspacePath:  conversation.WorkspacePath,
			UpdatedAt:      formatMessageTime(lastMessageAt(conversation)),
			ApprovalPolicy: conversation.ApprovalPolicy,
			Messages:       recentMessages(conversation),
		}
		// The engine's Running flag is per kernel: using it here marked every conversation
		// as running whenever any sidecar was alive. Use this conversation's own activity.
		projection.Running = a.conversationActiveRecently(conversation.ID)
		if projection.Running {
			snapshot.Context.RunningTurns++
		}
		for _, task := range a.engines.StatusForSession(conversation.ID).BackgroundTasks {
			label := task.Name
			if strings.TrimSpace(label) == "" {
				label = task.ID
			}
			projection.BackgroundTasks = append(projection.BackgroundTasks, remotecontrol.Task{
				ID:     task.ID,
				Label:  truncateRunes(label, 80),
				Status: task.Status,
			})
		}
		snapshot.Context.BackgroundTasks += len(projection.BackgroundTasks)
		snapshot.Conversations = append(snapshot.Conversations, projection)
	}
	return snapshot, nil
}

func recentMessages(conversation conversation.StoredConversation) []remotecontrol.Message {
	if len(conversation.Messages) == 0 {
		return nil
	}
	start := 0
	if len(conversation.Messages) > remoteSnapshotMessages {
		start = len(conversation.Messages) - remoteSnapshotMessages
	}
	messages := make([]remotecontrol.Message, 0, len(conversation.Messages)-start)
	for _, message := range conversation.Messages[start:] {
		messages = append(messages, remotecontrol.Message{
			Role: messageRole(message.Role),
			Text: truncateRunes(strings.TrimSpace(message.Content), remoteMessageRunes),
			At:   formatMessageTime(message.Timestamp),
		})
	}
	return messages
}

func messageRole(role string) string {
	switch strings.TrimSpace(role) {
	case "user":
		return "你"
	case "assistant":
		return "助手"
	case "tool":
		return "工具"
	default:
		if trimmed := strings.TrimSpace(role); trimmed != "" {
			return trimmed
		}
		return "记录"
	}
}

func lastMessageAt(conversation conversation.StoredConversation) uint64 {
	if len(conversation.Messages) == 0 {
		return conversation.CreatedAt
	}
	return conversation.Messages[len(conversation.Messages)-1].Timestamp
}

func formatMessageTime(milliseconds uint64) string {
	if milliseconds == 0 {
		return ""
	}
	return time.UnixMilli(int64(milliseconds)).Local().Format("2006-01-02 15:04")
}

func truncateRunes(value string, limit int) string {
	runes := []rune(strings.TrimSpace(value))
	if len(runes) <= limit {
		return string(runes)
	}
	return string(runes[:limit]) + "…"
}

// IssueRemotePairingCode mints a fresh short-lived code the host shows to enrol one
// device. Issuing a code invalidates the previous one. When deviceId is set the code is
// bound to that device, so a phone that moved to another network keeps its permission and
// networks instead of appearing as a second device.
func (a *App) IssueRemotePairingCode(deviceID string) remotecontrol.Status {
	manager := a.remoteControlManager()
	manager.IssuePairingCodeFor(deviceID)
	return a.syncRemoteControl()
}

// SetRemoteDeviceCapability promotes a paired device to control or demotes it to
// read-only. Granting control also clears an expiry or network downgrade.
func (a *App) SetRemoteDeviceCapability(id, capability string) error {
	return a.remoteControlManager().SetDeviceCapability(id, capability)
}

// RenewRemoteDevice extends one device's authorisation.
func (a *App) RenewRemoteDevice(id string) error {
	_, err := a.remoteControlManager().RenewDevice(id)
	return err
}

// GetRemoteAudit returns the most recent remote actions, newest last.
func (a *App) GetRemoteAudit(limit int) []remotecontrol.AuditEntry {
	return a.remoteControlManager().Audit(limit)
}

// SetRemoteDangerousTools keeps bash/edit/write approvals and auto-approving policies on
// this machine when turned off.
func (a *App) SetRemoteDangerousTools(allowed bool) error {
	next := a.settings.Get()
	configured := config.RemoteControlConfig{Enabled: false, BindMode: remotecontrol.BindModeLAN}
	if next.RemoteControl != nil {
		configured = *next.RemoteControl
	}
	value := allowed
	configured.AllowDangerousTools = &value
	next.RemoteControl = &configured
	return a.settings.Save(next)
}

// ApproveRemoteDeviceNetwork remembers the network a paired device is asking from, which
// is how a device that moved keeps working without pairing again.
func (a *App) ApproveRemoteDeviceNetwork(id string) error {
	_, err := a.remoteControlManager().ApproveDeviceNetwork(id)
	return err
}

// ForgetRemoteDeviceNetwork forgets one remembered network, so the device has to be
// verified again the next time it appears there.
func (a *App) ForgetRemoteDeviceNetwork(id, subnet string) error {
	_, err := a.remoteControlManager().ForgetDeviceNetwork(id, subnet)
	return err
}
