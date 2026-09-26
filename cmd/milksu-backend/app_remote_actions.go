package main

import (
	"context"
	"errors"
	"fmt"
	"os"
	"sort"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/MilkSU-Official/milksu/internal/config"
	"github.com/MilkSU-Official/milksu/internal/conversation"
	"github.com/MilkSU-Official/milksu/internal/remotecontrol"
)

// remoteDangerousTools are the tools that run code or write files. When the host turns
// "allow remote dangerous actions" off, these may only be denied from a remote device.
var remoteDangerousTools = map[string]struct{}{
	"bash": {}, "edit": {}, "write": {},
}

// remotePolicyOptions is the approval policy list a remote device may pick from.
var remotePolicyOptions = []struct {
	ID    string
	Label string
}{
	{"read-only", "只读（只允许查看）"},
	{"ask", "每次询问"},
	{"workspace-auto", "工作区内自动批准"},
	{"full-auto", "全部自动批准"},
}

// dangerousToolsAllowed reports the host switch. Absent means allowed: the user asked for
// remote approval, and the switch exists to tighten that later.
func (a *App) dangerousToolsAllowed() bool {
	settings := a.settings.Get()
	if settings.RemoteControl == nil || settings.RemoteControl.AllowDangerousTools == nil {
		return true
	}
	return *settings.RemoteControl.AllowDangerousTools
}

func remotePolicyAllowed(policy string, allowDangerous bool) bool {
	switch policy {
	case "read-only", "ask":
		return true
	case "workspace-auto", "full-auto":
		return allowDangerous
	default:
		return false
	}
}

func remoteToolIsDangerous(tool string) bool {
	_, dangerous := remoteDangerousTools[strings.ToLower(strings.TrimSpace(tool))]
	return dangerous
}

// pendingApprovalTool reports which tool a waiting request belongs to.
func (a *App) pendingApprovalTool(requestID string) string {
	a.approvalMu.Lock()
	defer a.approvalMu.Unlock()
	if approval, ok := a.pendingApprovals[strings.TrimSpace(requestID)]; ok {
		return approval.ToolName
	}
	return ""
}

// RemoteApproveTool lets a control-capable device answer a permission prompt. The host
// switch can restrict this to denials for tools that execute code or write files.
func (bridge remoteControlBridge) RemoteApproveTool(
	_ context.Context,
	conversationID,
	requestID string,
	approved bool,
	scope,
	choice string,
) error {
	conversationID = strings.TrimSpace(conversationID)
	requestID = strings.TrimSpace(requestID)
	if conversationID == "" || requestID == "" {
		return errors.New("缺少对话或请求标识")
	}
	scope = strings.TrimSpace(scope)
	if scope != "" && scope != "conversation" {
		return fmt.Errorf("不支持的授权范围：%s", scope)
	}
	// An ask card is not a dangerous tool: answering it is how the reader moves the agent on.
	ask := strings.TrimSpace(bridge.app.pendingApprovalTool(requestID)) == remoteAskToolName
	if approved && !ask && !bridge.app.dangerousToolsAllowed() {
		tool := bridge.app.pendingApprovalTool(requestID)
		if remoteToolIsDangerous(tool) {
			return fmt.Errorf("主机已关闭「允许远端执行危险操作」：%s 只能在本机批准（可从远端拒绝）", tool)
		}
	}
	return bridge.app.RespondToolApproval(conversationID, requestID, approved, scope, strings.TrimSpace(choice))
}

// RemoteSelectModel switches the active provider and model. Credentials are unchanged, so
// only a model the user already configured can be selected.
func (bridge remoteControlBridge) RemoteSelectModel(_ context.Context, providerID, model string) error {
	providerID = strings.TrimSpace(providerID)
	model = strings.TrimSpace(model)
	if providerID == "" || model == "" {
		return errors.New("缺少模型服务或模型名")
	}
	settings := bridge.app.settings.Get()
	configured, exists := settings.Providers[providerID]
	if !exists {
		return fmt.Errorf("未知的模型服务 %s", providerID)
	}
	if len(configured.Models) > 0 {
		found := false
		for _, candidate := range configured.Models {
			if candidate == model {
				found = true
				break
			}
		}
		if !found {
			return fmt.Errorf("模型服务 %s 不包含 %s", providerID, model)
		}
	}
	settings.ActiveProvider = providerID
	settings.ActiveModel = model
	if err := bridge.app.settings.Save(settings); err != nil {
		return err
	}
	// The sidecar reads credentials at spawn time, so the next turn must run on a fresh
	// process. Existing turns keep running (see Supervisor.InvalidateCredentials).
	bridge.app.rotateEngineCredentials("remote model selection")
	return nil
}

// RemoteSelectApprovalPolicy sets one conversation's approval policy. Auto-approving
// policies need the host's dangerous-action switch.
func (bridge remoteControlBridge) RemoteSelectApprovalPolicy(_ context.Context, conversationID, policy string) error {
	conversationID = strings.TrimSpace(conversationID)
	policy = strings.TrimSpace(policy)
	if conversationID == "" {
		return errors.New("缺少对话标识")
	}
	if !remotePolicyAllowed(policy, bridge.app.dangerousToolsAllowed()) {
		return fmt.Errorf("主机策略不允许远端切换到「%s」", policy)
	}
	stored, err := bridge.app.conversations.Get(conversationID)
	if err != nil {
		return fmt.Errorf("找不到对话：%w", err)
	}
	stored.ApprovalPolicy = policy
	return bridge.app.SaveConversation(stored)
}

// RemoteCreateConversation starts a conversation in an existing workspace. A remote device
// may not invent new directories.
func (bridge remoteControlBridge) RemoteCreateConversation(_ context.Context, title, workspacePath string) (string, error) {
	workspace := strings.TrimSpace(workspacePath)
	if workspace == "" {
		workspace = bridge.app.remoteDefaultWorkspace()
	}
	if workspace != "" {
		info, err := os.Stat(workspace)
		if err != nil || !info.IsDir() {
			return "", fmt.Errorf("工作区不存在或不是目录：%s", workspace)
		}
	}
	trimmedTitle := truncateRunes(title, 60)
	if trimmedTitle == "" {
		trimmedTitle = "远端新建对话"
	}
	record := conversation.StoredConversation{
		ID:            uuid.NewString(),
		Title:         trimmedTitle,
		CreatedAt:     uint64(time.Now().UnixMilli()),
		WorkspacePath: workspace,
		Kernel:        conversation.KernelPi,
	}
	if err := bridge.app.conversations.Save(record); err != nil {
		return "", err
	}
	bridge.app.emitDesktopEvent("conversations-changed", nil)
	return record.ID, nil
}

// RemoteConversation returns one conversation with its recent messages for the chat view.
func (bridge remoteControlBridge) RemoteConversation(_ context.Context, conversationID string) (remotecontrol.Conversation, error) {
	stored, err := bridge.app.conversations.Get(strings.TrimSpace(conversationID))
	if err != nil {
		return remotecontrol.Conversation{}, fmt.Errorf("找不到对话：%w", err)
	}
	projection := remotecontrol.Conversation{
		ID:             stored.ID,
		Title:          stored.Title,
		WorkspacePath:  stored.WorkspacePath,
		UpdatedAt:      formatMessageTime(lastMessageAt(stored)),
		ApprovalPolicy: stored.ApprovalPolicy,
		Messages:       recentMessages(stored),
		Running:        bridge.app.conversationActiveRecently(stored.ID),
	}
	for _, task := range bridge.app.engines.StatusForSession(stored.ID).BackgroundTasks {
		label := task.Name
		if strings.TrimSpace(label) == "" {
			label = task.ID
		}
		projection.BackgroundTasks = append(projection.BackgroundTasks, remotecontrol.Task{
			ID: task.ID, Label: truncateRunes(label, 80), Status: task.Status,
		})
	}
	return projection, nil
}

// remoteDefaultWorkspace reuses the workspace of the most recent conversation, so a
// remotely created conversation lands where the user is actually working.
func (a *App) remoteDefaultWorkspace() string {
	stored, err := a.conversations.List()
	if err != nil {
		return ""
	}
	sort.Slice(stored, func(i, j int) bool {
		return lastMessageAt(stored[i]) > lastMessageAt(stored[j])
	})
	for _, record := range stored {
		if workspace := strings.TrimSpace(record.WorkspacePath); workspace != "" {
			if info, statErr := os.Stat(workspace); statErr == nil && info.IsDir() {
				return workspace
			}
		}
	}
	return ""
}

// remoteModelOptions lists the models a remote device may switch to.
func (a *App) remoteModelOptions(settings config.AppSettings) []remotecontrol.ModelOption {
	options := make([]remotecontrol.ModelOption, 0, 16)
	for providerID, configured := range settings.Providers {
		if !configured.Enabled {
			continue
		}
		for _, model := range configured.Models {
			if strings.TrimSpace(model) == "" {
				continue
			}
			options = append(options, remotecontrol.ModelOption{
				Provider: providerID,
				Model:    model,
				Label:    providerID + " / " + model,
				Active:   providerID == settings.ActiveProvider && model == settings.ActiveModel,
			})
		}
	}
	sort.Slice(options, func(i, j int) bool { return options[i].Label < options[j].Label })
	if len(options) > 24 {
		options = options[:24]
	}
	return options
}

// remotePolicyOptions mirrors the policy list for the page.
func (a *App) remotePolicyOptions() []remotecontrol.PolicyOption {
	options := make([]remotecontrol.PolicyOption, 0, len(remotePolicyOptions))
	for _, option := range remotePolicyOptions {
		options = append(options, remotecontrol.PolicyOption{ID: option.ID, Label: option.Label})
	}
	return options
}

// RemoteSendMessage submits a prompt to one conversation the way the desktop app does.
// The conversation's own workspace, model and approval policy are reused, so a remote
// device cannot silently escalate what the agent may run: with the host switch off,
// bash/edit/write still wait for approval on this machine.
func (bridge remoteControlBridge) RemoteSendMessage(_ context.Context, conversationID, prompt, mode string) error {
	conversationID = strings.TrimSpace(conversationID)
	trimmed := strings.TrimSpace(prompt)
	if conversationID == "" || trimmed == "" {
		return errors.New("缺少对话或消息内容")
	}
	stored, err := bridge.app.conversations.Get(conversationID)
	if err != nil {
		return fmt.Errorf("找不到对话：%w", err)
	}
	// The desktop composer has three choices for a busy conversation; mirror them so a phone
	// can park a prompt instead of cutting into the running turn.
	switch strings.TrimSpace(mode) {
	case "queue":
		return bridge.app.QueueDshMessage(conversationID, trimmed)
	case "steer":
		return bridge.app.SteerMessage(conversationID, trimmed)
	}
	err = bridge.app.SendMessage(
		conversationID,
		trimmed,
		stored.WorkspacePath,
		stored.ModelMode,
		stored.ModelProvider,
		stored.ModelID,
		stored.ThinkingLevel,
		"",
		stored.ExecutionMode,
		stored.ApprovalPolicy,
		stored.MCPConfigDigest,
		stored.MCPServers,
		nil,
		nil,
		0,
	)
	if err != nil {
		return err
	}
	// The renderer is not watching a remote turn, so the backend stores the prompt and
	// the reply itself.
	bridge.app.recordRemoteTurnStart(conversationID, trimmed)
	return nil
}

// RemoteWithdrawQueued drops one parked prompt. The position and the text the page saw are
// both checked, so a queue that moved meanwhile is refused instead of dropping a neighbour.
func (bridge remoteControlBridge) RemoteWithdrawQueued(_ context.Context, conversationID, queue string, index int, expected string) error {
	conversationID = strings.TrimSpace(conversationID)
	queue = strings.TrimSpace(queue)
	if conversationID == "" {
		return errors.New("缺少对话标识")
	}
	if queue != "steering" && queue != "followUp" {
		return fmt.Errorf("不支持的队列：%s", queue)
	}
	if index < 0 {
		return errors.New("队列位置不正确")
	}
	return bridge.app.RemoveQueuedMessage(conversationID, queue, index, expected)
}

// RemoteClearQueued drops every parked prompt of one conversation.
func (bridge remoteControlBridge) RemoteClearQueued(_ context.Context, conversationID string) error {
	conversationID = strings.TrimSpace(conversationID)
	if conversationID == "" {
		return errors.New("缺少对话标识")
	}
	return bridge.app.ClearQueuedMessages(conversationID)
}
