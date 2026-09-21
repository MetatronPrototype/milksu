// Package remotecontrol serves a password- and pairing-code-gated companion page to
// devices the user paired on purpose: conversations, running turns and background
// tasks, permission prompts and the model context, plus the actions the user allowed
// that device to perform.
//
// Safety model:
//   - nothing listens until the user enables it, and it binds the LAN address instead of
//     0.0.0.0;
//   - a device is enrolled with a short-lived, single-use pairing code and stays
//     read-only until the user promotes it to control from the host;
//   - every device authorisation has an absolute expiry, and a device whose network
//     changed is downgraded to read-only until the host issues a new code;
//   - every remote action is recorded in an audit trail the host can read.
package remotecontrol

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base32"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

// Bind modes.
const (
	BindModeLocal = "local"
	BindModeLAN   = "lan"
)

// Device capabilities. A freshly paired device may only read.
const (
	CapabilityView    = "view"
	CapabilityControl = "control"
)

// Device states explain a downgrade to the user.
const (
	StateActive         = "active"
	StateExpired        = "expired"
	StateNetworkChanged = "network-changed"
)

const (
	stateFileName = "remote-control.json"
	auditFileName = "remote-control-audit.jsonl"
	sessionCookie = "milksu_remote"
	// actionHeader must be present on every write. A cross-site page cannot send it
	// without a preflight, which this server never allows.
	actionHeader = "X-MilkSU-Remote"
	// defaultSessionTTL is how long a pairing stays authorised.
	defaultSessionTTL = 7 * 24 * time.Hour
	// maxSessionTTL bounds what the host may grant.
	maxSessionTTL = 90 * 24 * time.Hour
	// pairingTTL is how long a pairing code stays usable.
	pairingTTL = 5 * time.Minute
	// maxDeviceTokens bounds how many credentials one device may keep. Every address the
	// phone reaches the host by is its own browser origin with its own cookie, so a device
	// that moves between networks needs one credential per network.
	maxDeviceTokens = 4
	// unknownDeviceName is the label used when a request carries no user agent at all.
	unknownDeviceName = "未识别设备"
	// loginWindow and loginAttempts bound pairing/password guessing from one address.
	loginWindow   = 5 * time.Minute
	loginAttempts = 8
	requestLimit  = 5 * time.Second
	// auditLimit bounds the in-memory audit trail; the file keeps the rest.
	auditLimit = 200
	// maxApprovedNetworks bounds how many networks one device may remember.
	maxApprovedNetworks = 5
)

// Rejection reasons reported to the page so it can explain itself.
const (
	reasonNoSession          = "no-session"
	reasonUnknownDevice      = "unknown-device"
	reasonNetworkUnverified  = "network-unverified"
)

// ShutdownTimeout bounds how long Close waits for in-flight requests.
const ShutdownTimeout = 3 * time.Second

// Device is one paired browser or phone.
type Device struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	IP   string `json:"ip"`
	// Networks are the /24 subnets this device is approved to be used from. The host
	// approves a new one when the device moves, and an approved network keeps working
	// when the device comes back to it.
	Networks []string `json:"networks,omitempty"`
	// PendingSubnet is a network the device tried to use that the host has not approved
	// yet; access is blocked until it is verified.
	PendingSubnet string `json:"pending_subnet,omitempty"`
	// Capability is CapabilityView or CapabilityControl.
	Capability string `json:"capability"`
	// State is StateActive, StateExpired or StateNetworkChanged.
	State       string `json:"state"`
	ExpiresAt   string `json:"expires_at"`
	FirstSeenAt string `json:"first_seen_at"`
	LastSeenAt  string `json:"last_seen_at"`
	// CanControl reports whether writes are allowed right now.
	CanControl bool `json:"can_control"`
}

// AuditEntry is one recorded remote action.
type AuditEntry struct {
	At         string `json:"at"`
	DeviceID   string `json:"device_id"`
	DeviceName string `json:"device_name"`
	IP         string `json:"ip"`
	Action     string `json:"action"`
	Detail     string `json:"detail,omitempty"`
	OK         bool   `json:"ok"`
	Error      string `json:"error,omitempty"`
}

// Status is what the settings panel shows.
type Status struct {
	Enabled  bool   `json:"enabled"`
	Running  bool   `json:"running"`
	BindMode string `json:"bind_mode"`
	Port     int    `json:"port"`
	URL      string `json:"url,omitempty"`
	Password string `json:"password,omitempty"`
	// PairingCode is the short-lived code the host shows to enrol one device.
	PairingCode      string `json:"pairing_code,omitempty"`
	PairingExpiresAt string `json:"pairing_expires_at,omitempty"`
	// PairingDeviceID is set when the current code was issued for one specific device.
	PairingDeviceID string `json:"pairing_device_id,omitempty"`
	SessionTTLHours  int      `json:"session_ttl_hours"`
	Devices          []Device `json:"devices"`
	Error            string   `json:"error,omitempty"`
}

// Task is one background task of a conversation.
type Task struct {
	ID     string `json:"id"`
	Label  string `json:"label"`
	Status string `json:"status"`
}

// Message is one conversation message, already truncated for a small screen.
type Message struct {
	Role string `json:"role"`
	Text string `json:"text"`
	At   string `json:"at"`
	// Approval marks the message that is waiting on the reader, so the page can jump to it.
	ApprovalRequestID string `json:"approval_request_id,omitempty"`
	ApprovalState     string `json:"approval_state,omitempty"`
	// Kind is "ask" for a question card, empty otherwise.
	Kind string `json:"kind,omitempty"`
}

// QueuedMessage is one prompt parked behind a running turn.
type QueuedMessage struct {
	Queue string `json:"queue"`
	Index int    `json:"index"`
	Text  string `json:"text"`
}

// Conversation is one conversation projection.
type Conversation struct {
	ID              string    `json:"id"`
	Title           string    `json:"title"`
	WorkspacePath   string    `json:"workspace_path,omitempty"`
	UpdatedAt       string    `json:"updated_at"`
	ApprovalPolicy  string    `json:"approval_policy,omitempty"`
	Running         bool      `json:"running"`
	BackgroundTasks []Task    `json:"background_tasks,omitempty"`
	Messages        []Message `json:"messages,omitempty"`
	// NeedsDecision reports a message in this conversation waiting on the reader (a tool
	// approval or an ask question). The host's sidebar uses the same rule.
	NeedsDecision bool `json:"needs_decision,omitempty"`
	// PendingRequestIDs are the requests waiting in this conversation.
	PendingRequestIDs []string `json:"pending_request_ids,omitempty"`
	// Queue holds the prompts parked behind the running turn, in order.
	Queue []QueuedMessage `json:"queue,omitempty"`
	// ToolRunning reports whether a tool call is still running. The host uses the same signal
	// to decide whether injected guidance is still waiting to join the turn.
	ToolRunning bool `json:"tool_running,omitempty"`
}

// ApprovalOption is one choice on an ask card.
type ApprovalOption struct {
	ID     string `json:"id"`
	Label  string `json:"label"`
	Detail string `json:"detail,omitempty"`
}

// ApprovalJustification is the requester's own purpose/safety note, mirroring the host card.
type ApprovalJustification struct {
	Purpose string `json:"purpose,omitempty"`
	Safety  string `json:"safety,omitempty"`
}

// Approval is one prompt waiting for the user. A prompt is either a tool approval or an ask
// question (milksu_ask) with choices; the page renders them differently but both are
// answered through the same action.
type Approval struct {
	RequestID      string                 `json:"request_id"`
	ConversationID string                 `json:"conversation_id"`
	ToolName       string                 `json:"tool_name"`
	Input          string                 `json:"input,omitempty"`
	RequestedAt    string                 `json:"requested_at"`
	Kind           string                 `json:"kind,omitempty"`
	Question       string                 `json:"question,omitempty"`
	Options        []ApprovalOption       `json:"options,omitempty"`
	Reason         string                 `json:"reason,omitempty"`
	Justification  *ApprovalJustification `json:"justification,omitempty"`
	// GrantsConversation reports whether the host offers "allow for this conversation".
	GrantsConversation bool `json:"grants_conversation,omitempty"`
	// Dangerous marks a tool the host may restrict to local approval.
	Dangerous bool `json:"dangerous,omitempty"`
}

// ModelOption is one model a remote device may switch to.
type ModelOption struct {
	Provider string `json:"provider"`
	Model    string `json:"model"`
	Label    string `json:"label"`
	Active   bool   `json:"active"`
}

// PolicyOption is one approval policy a remote device may select.
type PolicyOption struct {
	ID     string `json:"id"`
	Label  string `json:"label"`
	Active bool   `json:"active"`
}

// ContextSummary is the model/context state shown at the top of the page.
type ContextSummary struct {
	ActiveProvider   string `json:"active_provider"`
	ActiveModel      string `json:"active_model"`
	RunningTurns     int    `json:"running_turns"`
	PendingApprovals int    `json:"pending_approvals"`
	BackgroundTasks  int    `json:"background_tasks"`
}

// Snapshot is the projection the page renders.
type Snapshot struct {
	GeneratedAt   string          `json:"generated_at"`
	Context       ContextSummary  `json:"context"`
	Conversations []Conversation  `json:"conversations"`
	Approvals     []Approval      `json:"approvals"`
	Models        []ModelOption   `json:"models,omitempty"`
	Policies      []PolicyOption  `json:"policies,omitempty"`
	Device        Device          `json:"device"`
}

// Provider supplies the live projection. The backend implements it.
type Provider interface {
	RemoteControlSnapshot(ctx context.Context, device Device) (Snapshot, error)
	// RemoteConversation returns one conversation with its recent messages, for the
	// chat view.
	RemoteConversation(ctx context.Context, conversationID string) (Conversation, error)
}

// Controller performs the actions a control-capable device may request. Every method is
// also recorded in the audit trail by the manager.
type Controller interface {
	// RemoteApproveTool answers a waiting prompt. scope may be "conversation" to grant the
	// same tool for the rest of the conversation; choice answers an ask card (an option id,
	// or "other:<text>" for free text).
	RemoteApproveTool(ctx context.Context, conversationID, requestID string, approved bool, scope, choice string) error
	// RemoteSendMessage submits a prompt to a conversation, exactly like typing it in
	// the desktop app. mode is "" to send it, "queue" to park it behind the running turn,
	// or "steer" to guide the running turn. The agent's approval policy still decides what
	// may run.
	RemoteSendMessage(ctx context.Context, conversationID, prompt, mode string) error
	// RemoteWithdrawQueued removes one parked prompt: queue is "steering" or "followUp",
	// index is its position and expected is the text the page saw.
	RemoteWithdrawQueued(ctx context.Context, conversationID, queue string, index int, expected string) error
	// RemoteClearQueued drops every parked prompt of one conversation.
	RemoteClearQueued(ctx context.Context, conversationID string) error
	RemoteSelectModel(ctx context.Context, provider, model string) error
	RemoteSelectApprovalPolicy(ctx context.Context, conversationID, policy string) error
	RemoteCreateConversation(ctx context.Context, title, workspacePath string) (string, error)
}

// authResult explains the outcome of resolving a device from a request, so a device on an
// unverified network learns why it is blocked instead of seeing a bare 401.
type authResult struct {
	OK     bool
	Reason string
}

// Settings is the subset of app settings the manager needs.
type Settings struct {
	Enabled  bool
	BindMode string
	Port     int
	// SessionTTL overrides defaultSessionTTL when positive.
	SessionTTL time.Duration
}

// Manager owns the listener, the pairing state and the paired devices.
type Manager struct {
	dataDirectory string
	provider      Provider
	controller    Controller

	mu            sync.Mutex
	password      string
	devices       []deviceRecord
	pairingCode   string
	pairingAt     time.Time
	pairingUsed   bool
	// pairingDeviceID binds the current code to one paired device, when the host issued it
	// for that device.
	pairingDeviceID string
	sessionTTL    time.Duration
	audit         []AuditEntry
	server        *http.Server
	listener      net.Listener
	url           string
	bindMode      string
	port          int
	lastError     string
	loginFailures map[string][]time.Time

	// subMu guards the change listeners. Each subscriber keeps at most one pending ping,
	// because a ping only tells the page to re-read the whole projection.
	subMu       sync.Mutex
	subscribers map[chan struct{}]struct{}
}

type deviceRecord struct {
	Device
	TokenHash string `json:"token_hash"`
	// Tokens holds every credential this device may present. A phone that reaches the host
	// from a second network gets a second origin, hence a second cookie; both stay valid,
	// so coming back to the first network still works. TokenHash stays the newest one so an
	// older build can still authenticate the device.
	Tokens []string `json:"tokens,omitempty"`
	// ClientID is a stable per-browser identifier the companion page keeps in local
	// storage. A phone that lost its cookie is recognised by it (or failing that by
	// address and user agent) and keeps the same device row instead of being added again.
	ClientID string `json:"client_id,omitempty"`
	// LegacySubnet carries the single bound network written by earlier versions, so an
	// existing pairing keeps working after the upgrade.
	LegacySubnet string `json:"subnet,omitempty"`
}

type persistedState struct {
	Password string         `json:"password"`
	Devices  []deviceRecord `json:"devices"`
}

// New prepares a manager. Nothing is served until Apply enables it.
func New(dataDirectory string, provider Provider, controller Controller) *Manager {
	manager := &Manager{
		dataDirectory: dataDirectory,
		provider:      provider,
		controller:    controller,
		bindMode:      BindModeLAN,
		sessionTTL:    defaultSessionTTL,
		loginFailures: make(map[string][]time.Time),
	}
	manager.load()
	return manager
}

func (m *Manager) statePath() string  { return filepath.Join(m.dataDirectory, stateFileName) }
func (m *Manager) auditPath() string  { return filepath.Join(m.dataDirectory, auditFileName) }

// load reads the password and paired devices. A missing or unreadable file yields a
// fresh password, so a corrupt state never leaves the server without authentication.
func (m *Manager) load() {
	m.mu.Lock()
	defer m.mu.Unlock()
	raw, err := os.ReadFile(m.statePath())
	if err == nil {
		var parsed persistedState
		if json.Unmarshal(raw, &parsed) == nil && strings.TrimSpace(parsed.Password) != "" {
			m.password = parsed.Password
			m.devices = parsed.Devices
			for index := range m.devices {
				if len(m.devices[index].Networks) == 0 && strings.TrimSpace(m.devices[index].LegacySubnet) != "" {
					m.devices[index].Networks = []string{strings.TrimSpace(m.devices[index].LegacySubnet)}
				}
			}
			return
		}
	}
	m.password = randomPassword()
	_ = m.persistLocked()
}

func (m *Manager) persistLocked() error {
	if err := os.MkdirAll(m.dataDirectory, 0o700); err != nil {
		return err
	}
	payload, err := json.MarshalIndent(persistedState{Password: m.password, Devices: m.devices}, "", "  ")
	if err != nil {
		return err
	}
	temporary := m.statePath() + ".tmp"
	if err := os.WriteFile(temporary, payload, 0o600); err != nil {
		return err
	}
	return os.Rename(temporary, m.statePath())
}

func (m *Manager) appendAuditLocked(entry AuditEntry) {
	entry.At = time.Now().UTC().Format(time.RFC3339)
	if entry.At == "" {
		return
	}
	m.audit = append(m.audit, entry)
	if len(m.audit) > auditLimit {
		m.audit = m.audit[len(m.audit)-auditLimit:]
	}
	payload, err := json.Marshal(entry)
	if err != nil {
		return
	}
	file, err := os.OpenFile(m.auditPath(), os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o600)
	if err != nil {
		return
	}
	defer file.Close()
	_, _ = file.Write(append(payload, '\n'))
}

// Audit returns the most recent remote actions, newest last.
func (m *Manager) Audit(limit int) []AuditEntry {
	m.mu.Lock()
	defer m.mu.Unlock()
	if limit <= 0 || limit > len(m.audit) {
		limit = len(m.audit)
	}
	entries := make([]AuditEntry, limit)
	copy(entries, m.audit[len(m.audit)-limit:])
	return entries
}

func randomPassword() string { return randomHex(6) }

func randomHex(size int) string {
	buffer := make([]byte, size)
	if _, err := rand.Read(buffer); err != nil {
		return fmt.Sprintf("%x", time.Now().UnixNano())
	}
	return hex.EncodeToString(buffer)
}

var pairingAlphabet = base32.NewEncoding("ABCDEFGHJKLMNPQRSTUVWXYZ23456789").WithPadding(base32.NoPadding)

func randomPairingCode() string {
	buffer := make([]byte, 6)
	if _, err := rand.Read(buffer); err != nil {
		return strings.ToUpper(randomHex(6))[:8]
	}
	return pairingAlphabet.EncodeToString(buffer)[:10]
}

// IssuePairingCode mints a short-lived, single-use code. Issuing a new code invalidates
// the previous one, so only the code on screen can enrol a device.
func (m *Manager) IssuePairingCode() (string, string) {
	return m.IssuePairingCodeFor("")
}

// IssuePairingCodeFor issues a pairing code. When deviceID names a paired device, the code
// is bound to it, so enrolling with it keeps that device's row, permission and networks
// even from an address the host has never seen.
func (m *Manager) IssuePairingCodeFor(deviceID string) (string, string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.pairingCode = randomPairingCode()
	m.pairingAt = time.Now()
	m.pairingUsed = false
	m.pairingDeviceID = strings.TrimSpace(deviceID)
	return m.pairingCode, m.pairingAt.Add(pairingTTL).UTC().Format(time.RFC3339)
}

// Apply starts, stops or reconfigures the listener to match the settings.
func (m *Manager) Apply(settings Settings) Status {
	m.mu.Lock()
	bindMode := strings.TrimSpace(settings.BindMode)
	if bindMode != BindModeLocal && bindMode != BindModeLAN {
		bindMode = BindModeLAN
	}
	if settings.SessionTTL > 0 && settings.SessionTTL <= maxSessionTTL {
		m.sessionTTL = settings.SessionTTL
	}
	needsRestart := m.listener == nil ||
		m.bindMode != bindMode ||
		(settings.Port != 0 && m.port != settings.Port)
	running := m.listener != nil
	m.mu.Unlock()

	if !settings.Enabled {
		if running {
			m.stop()
		}
		m.mu.Lock()
		m.bindMode = bindMode
		m.mu.Unlock()
		return m.Status()
	}
	if running && !needsRestart {
		return m.Status()
	}
	if running {
		m.stop()
	}
	if err := m.start(bindMode, settings.Port); err != nil {
		m.mu.Lock()
		m.lastError = err.Error()
		m.mu.Unlock()
	}
	return m.Status()
}

func (m *Manager) start(bindMode string, port int) error {
	host := "127.0.0.1"
	if bindMode == BindModeLAN {
		lan := LANAddress()
		if lan == "" {
			return errors.New("找不到局域网地址：请先连接 Wi-Fi 或有线网络，或改用「仅本机」")
		}
		host = lan
	}
	address := net.JoinHostPort(host, fmt.Sprintf("%d", port))
	listener, err := net.Listen("tcp", address)
	if err != nil {
		return fmt.Errorf("监听 %s 失败：%w", address, err)
	}
	actualPort := listener.Addr().(*net.TCPAddr).Port
	server := &http.Server{
		Handler:           m.routes(),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       requestLimit,
		WriteTimeout:      30 * time.Second,
		IdleTimeout:       60 * time.Second,
	}

	m.mu.Lock()
	m.server = server
	m.listener = listener
	m.bindMode = bindMode
	m.port = actualPort
	m.url = fmt.Sprintf("http://%s/", net.JoinHostPort(host, fmt.Sprintf("%d", actualPort)))
	m.lastError = ""
	m.mu.Unlock()

	go func() {
		_ = server.Serve(listener)
	}()
	return nil
}

func (m *Manager) stop() {
	m.mu.Lock()
	server := m.server
	m.server = nil
	m.listener = nil
	m.url = ""
	m.mu.Unlock()
	if server == nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), ShutdownTimeout)
	defer cancel()
	_ = server.Shutdown(ctx)
}

// Close stops the server.
func (m *Manager) Close() error {
	m.stop()
	return nil
}

// Subscribe returns a channel that pings whenever something the page shows may have changed,
// plus the cancel function the caller must run when it stops listening.
func (m *Manager) Subscribe() (<-chan struct{}, func()) {
	changes := make(chan struct{}, 1)
	m.subMu.Lock()
	if m.subscribers == nil {
		m.subscribers = make(map[chan struct{}]struct{})
	}
	m.subscribers[changes] = struct{}{}
	m.subMu.Unlock()
	cancel := func() {
		m.subMu.Lock()
		delete(m.subscribers, changes)
		m.subMu.Unlock()
	}
	return changes, cancel
}

// NotifyChange wakes every listener. It never blocks: a listener that is already behind keeps
// a single pending ping, which is enough because the page re-reads the whole state.
func (m *Manager) NotifyChange() {
	m.subMu.Lock()
	defer m.subMu.Unlock()
	for changes := range m.subscribers {
		select {
		case changes <- struct{}{}:
		default:
		}
	}
}

// handleEvents streams a ping whenever the projection changes, so the page stops polling on a
// fixed timer. The stream carries no state on purpose: the page re-reads /api/state, which
// keeps one source of truth and one authorisation path.
func (m *Manager) handleEvents(writer http.ResponseWriter, request *http.Request) {
	if _, auth := m.deviceForRequest(request); !auth.OK {
		writeAuthFailure(writer, auth)
		return
	}
	flusher, ok := writer.(http.Flusher)
	if !ok {
		http.Error(writer, "streaming unsupported", http.StatusInternalServerError)
		return
	}
	writer.Header().Set("Content-Type", "text/event-stream; charset=utf-8")
	writer.Header().Set("Connection", "keep-alive")
	writer.WriteHeader(http.StatusOK)
	_, _ = writer.Write([]byte(": connected\n\n"))
	flusher.Flush()

	changes, cancel := m.Subscribe()
	defer cancel()
	keepalive := time.NewTicker(20 * time.Second)
	defer keepalive.Stop()
	for {
		select {
		case <-request.Context().Done():
			return
		case <-keepalive.C:
			if _, err := writer.Write([]byte(": keepalive\n\n")); err != nil {
				return
			}
			flusher.Flush()
		case <-changes:
			if _, err := writer.Write([]byte("event: changed\ndata: {}\n\n")); err != nil {
				return
			}
			flusher.Flush()
		}
	}
}

// Status reports the current listener, URL, pairing code and devices.
func (m *Manager) Status() Status {
	m.mu.Lock()
	defer m.mu.Unlock()
	now := time.Now()
	status := Status{
		Enabled:         m.listener != nil,
		Running:         m.listener != nil,
		BindMode:        m.bindMode,
		Port:            m.port,
		URL:             m.url,
		Password:        m.password,
		SessionTTLHours: int(m.sessionTTL.Hours()),
		Error:           m.lastError,
		Devices:         make([]Device, 0, len(m.devices)),
	}
	if m.pairingCode != "" && !m.pairingUsed && now.Before(m.pairingAt.Add(pairingTTL)) {
		status.PairingCode = m.pairingCode
		status.PairingExpiresAt = m.pairingAt.Add(pairingTTL).UTC().Format(time.RFC3339)
		status.PairingDeviceID = m.pairingDeviceID
	}
	for _, record := range m.devices {
		status.Devices = append(status.Devices, m.projectDeviceLocked(record, now))
	}
	sort.Slice(status.Devices, func(i, j int) bool {
		return status.Devices[i].LastSeenAt > status.Devices[j].LastSeenAt
	})
	return status
}

// projectDeviceLocked reports the device as it is right now, including an expiry or a
// network change that revoked its ability to act.
func (m *Manager) projectDeviceLocked(record deviceRecord, now time.Time) Device {
	device := record.Device
	device.CanControl = false
	switch {
	case device.State == StateExpired || (device.ExpiresAt != "" && expiredAt(device.ExpiresAt, now)):
		device.State = StateExpired
	case device.State == StateNetworkChanged:
	default:
		device.State = StateActive
	}
	if device.Capability == CapabilityControl && device.State == StateActive {
		device.CanControl = true
	}
	return device
}

func expiredAt(value string, now time.Time) bool {
	parsed, err := time.Parse(time.RFC3339, value)
	if err != nil {
		return true
	}
	return now.After(parsed)
}

// RotatePassword issues a new host password and unpairs every device, because the old
// password is what protected them.
func (m *Manager) RotatePassword() string {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.password = randomPassword()
	m.devices = nil
	m.pairingCode = ""
	m.pairingUsed = true
	_ = m.persistLocked()
	return m.password
}

// SetDeviceCapability promotes a paired device to control or demotes it to read-only.
func (m *Manager) SetDeviceCapability(id, capability string) error {
	normalized := strings.TrimSpace(capability)
	if normalized != CapabilityView && normalized != CapabilityControl {
		return fmt.Errorf("未知的设备权限 %q", capability)
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	for index := range m.devices {
		if m.devices[index].ID != strings.TrimSpace(id) {
			continue
		}
		m.devices[index].Capability = normalized
		if normalized == CapabilityControl {
			// Granting control also restores a device that had expired or moved, and
			// approves the network it is asking from.
			m.devices[index].State = StateActive
			m.devices[index].ExpiresAt = time.Now().Add(m.sessionTTLLocked()).UTC().Format(time.RFC3339)
			m.approvePendingNetworkLocked(index)
		}
		return m.persistLocked()
	}
	return fmt.Errorf("找不到设备 %s", id)
}

// RenewDevice extends one device's authorisation and clears a downgrade.
func (m *Manager) RenewDevice(id string) (Device, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for index := range m.devices {
		if m.devices[index].ID != strings.TrimSpace(id) {
			continue
		}
		m.devices[index].ExpiresAt = time.Now().Add(m.sessionTTL).UTC().Format(time.RFC3339)
		m.devices[index].State = StateActive
		if err := m.persistLocked(); err != nil {
			return Device{}, err
		}
		return m.projectDeviceLocked(m.devices[index], time.Now()), nil
	}
	return Device{}, fmt.Errorf("找不到设备 %s", id)
}

// ApproveDeviceNetwork remembers the network a device is asking from, which is how a
// device that moved keeps working without pairing again.
func (m *Manager) ApproveDeviceNetwork(id string) (Device, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for index := range m.devices {
		if m.devices[index].ID != strings.TrimSpace(id) {
			continue
		}
		if m.devices[index].PendingSubnet == "" {
			return Device{}, errors.New("这台设备当前没有待核验的网络")
		}
		m.approvePendingNetworkLocked(index)
		if m.devices[index].Capability == CapabilityControl {
			m.devices[index].State = StateActive
		}
		if err := m.persistLocked(); err != nil {
			return Device{}, err
		}
		return m.projectDeviceLocked(m.devices[index], time.Now()), nil
	}
	return Device{}, fmt.Errorf("找不到设备 %s", id)
}

// ForgetDeviceNetwork drops one remembered network, so the device must be verified again
// the next time it appears there.
func (m *Manager) ForgetDeviceNetwork(id, subnet string) (Device, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	target := strings.TrimSpace(subnet)
	for index := range m.devices {
		if m.devices[index].ID != strings.TrimSpace(id) {
			continue
		}
		kept := make([]string, 0, len(m.devices[index].Networks))
		for _, network := range m.devices[index].Networks {
			if network != target {
				kept = append(kept, network)
			}
		}
		m.devices[index].Networks = kept
		if err := m.persistLocked(); err != nil {
			return Device{}, err
		}
		return m.projectDeviceLocked(m.devices[index], time.Now()), nil
	}
	return Device{}, fmt.Errorf("找不到设备 %s", id)
}

// approvePendingNetworkLocked remembers the network the device asked from.
func (m *Manager) approvePendingNetworkLocked(index int) {
	pending := strings.TrimSpace(m.devices[index].PendingSubnet)
	if pending == "" {
		return
	}
	for _, network := range m.devices[index].Networks {
		if network == pending {
			m.devices[index].PendingSubnet = ""
			return
		}
	}
	m.devices[index].Networks = append(m.devices[index].Networks, pending)
	if len(m.devices[index].Networks) > maxApprovedNetworks {
		m.devices[index].Networks = m.devices[index].Networks[len(m.devices[index].Networks)-maxApprovedNetworks:]
	}
	m.devices[index].PendingSubnet = ""
}

// RevokeDevice unpairs one device immediately.
func (m *Manager) RevokeDevice(id string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	trimmed := strings.TrimSpace(id)
	if trimmed == "" {
		return errors.New("设备 id 不能为空")
	}
	kept := make([]deviceRecord, 0, len(m.devices))
	found := false
	for _, record := range m.devices {
		if record.ID == trimmed {
			found = true
			continue
		}
		kept = append(kept, record)
	}
	if !found {
		return fmt.Errorf("找不到设备 %s", trimmed)
	}
	m.devices = kept
	return m.persistLocked()
}

func (m *Manager) routes() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/", m.handlePage)
	mux.HandleFunc("/api/state", m.handleState)
	mux.HandleFunc("/api/events", m.handleEvents)
	mux.HandleFunc("/api/mode", m.handleMode)
	mux.HandleFunc("/api/audit", m.handleAudit)
	mux.HandleFunc("/api/conversation", m.handleConversation)
	mux.HandleFunc("/api/action/send", m.handleSend)
	mux.HandleFunc("/api/pair", m.handlePair)
	mux.HandleFunc("/api/login", m.handleLogin)
	mux.HandleFunc("/api/logout", m.handleLogout)
	mux.HandleFunc("/api/action/approve", m.handleApprove)
	mux.HandleFunc("/api/action/queue", m.handleWithdrawQueued)
	mux.HandleFunc("/api/action/queue/clear", m.handleClearQueued)
	mux.HandleFunc("/api/action/model", m.handleSelectModel)
	mux.HandleFunc("/api/action/policy", m.handleSelectPolicy)
	mux.HandleFunc("/api/action/conversation", m.handleCreateConversation)
	mux.HandleFunc("/healthz", func(writer http.ResponseWriter, _ *http.Request) {
		writer.Header().Set("Content-Type", "text/plain; charset=utf-8")
		_, _ = writer.Write([]byte("ok"))
	})
	return m.secureHeaders(mux)
}

func (m *Manager) secureHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		writer.Header().Set("Cache-Control", "no-store")
		writer.Header().Set("X-Content-Type-Options", "nosniff")
		writer.Header().Set("X-Frame-Options", "DENY")
		writer.Header().Set("Referrer-Policy", "no-referrer")
		writer.Header().Set(
			"Content-Security-Policy",
			"default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'",
		)
		next.ServeHTTP(writer, request)
	})
}

func (m *Manager) handlePage(writer http.ResponseWriter, request *http.Request) {
	if request.URL.Path != "/" {
		http.NotFound(writer, request)
		return
	}
	writer.Header().Set("Content-Type", "text/html; charset=utf-8")
	_, _ = writer.Write([]byte(dashboardHTML))
}

// handlePair enrols a device with the host's pairing code. The device starts read-only.
func (m *Manager) handlePair(writer http.ResponseWriter, request *http.Request) {
	if request.Method != http.MethodPost {
		http.Error(writer, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if !m.allowLoginAttempt(remoteIP(request)) {
		http.Error(writer, "尝试次数过多，请稍后再试", http.StatusTooManyRequests)
		return
	}
	var payload struct {
		Code string `json:"code"`
		// ClientID identifies the browser asking to enrol; older pages omit it.
		ClientID string `json:"client_id"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(writer, request.Body, 4<<10)).Decode(&payload); err != nil {
		http.Error(writer, "请求格式不正确", http.StatusBadRequest)
		return
	}
	boundDeviceID, ok := m.consumePairingCode(payload.Code)
	if !ok {
		http.Error(writer, "绑定码不正确或已过期", http.StatusUnauthorized)
		return
	}

	token := randomHex(32)
	ip := remoteIP(request)
	subnet := subnetOf(ip)
	name := deviceName(request)
	clientID := strings.TrimSpace(payload.ClientID)
	ttl := m.effectiveSessionTTL()
	now := time.Now()
	expiresAt := now.Add(ttl).UTC().Format(time.RFC3339)

	m.mu.Lock()
	index := m.enrollingDeviceIndexLocked(clientID, name, ip, boundDeviceID)
	reused := index >= 0
	var device Device
	if reused {
		// The same phone is enrolling again (typically because its cookie is gone, or because
		// it moved to another network). It keeps its device row, its capability and every
		// network it already proved.
		record := &m.devices[index]
		record.Name = name
		record.IP = ip
		record.ClientID = clientID
		record.State = StateActive
		record.ExpiresAt = expiresAt
		record.PendingSubnet = ""
		record.LastSeenAt = now.UTC().Format(time.RFC3339)
		addedNetwork := ""
		if subnet != "" && !hasString(record.Networks, subnet) {
			record.Networks = append(record.Networks, subnet)
			addedNetwork = subnet
		}
		rememberToken(record, hashToken(token))
		device = record.Device
		detail := "重新配对：复用原设备，保留已有权限"
		if addedNetwork != "" {
			detail += "，已记住网络 " + addedNetwork
		}
		m.appendAuditLocked(AuditEntry{
			DeviceID: device.ID, DeviceName: device.Name, IP: device.IP,
			Action: "pair", Detail: detail, OK: true,
		})
	} else {
		networks := make([]string, 0, 1)
		if subnet != "" {
			networks = append(networks, subnet)
		}
		device = Device{
			ID:          randomHex(6),
			Name:        name,
			IP:          ip,
			Networks:    networks,
			Capability:  CapabilityView,
			State:       StateActive,
			ExpiresAt:   expiresAt,
			FirstSeenAt: now.UTC().Format(time.RFC3339),
			LastSeenAt:  now.UTC().Format(time.RFC3339),
		}
		m.devices = append(m.devices, deviceRecord{
			Device:    device,
			ClientID:  clientID,
			TokenHash: hashToken(token),
			Tokens:    []string{hashToken(token)},
		})
		m.appendAuditLocked(AuditEntry{
			DeviceID: device.ID, DeviceName: device.Name, IP: device.IP,
			Action: "pair", Detail: "以绑定码配对（默认只读）", OK: true,
		})
	}
	err := m.persistLocked()
	m.mu.Unlock()
	if err != nil {
		http.Error(writer, "保存配对状态失败", http.StatusInternalServerError)
		return
	}

	setSessionCookie(writer, token, ttl)
	writer.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(writer).Encode(map[string]any{
		"ok":         true,
		"device_id":  device.ID,
		"capability": device.Capability,
		"expires_at": device.ExpiresAt,
		"reused":     reused,
	})
}

func (m *Manager) consumePairingCode(candidate string) (string, bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.pairingCode == "" || m.pairingUsed {
		return "", false
	}
	if time.Since(m.pairingAt) > pairingTTL {
		return "", false
	}
	if subtle.ConstantTimeCompare([]byte(strings.ToUpper(strings.TrimSpace(candidate))), []byte(m.pairingCode)) != 1 {
		return "", false
	}
	m.pairingUsed = true
	return m.pairingDeviceID, true
}

// handleLogin accepts the host password only on a local-only listener, where the traffic
// never leaves the machine. On the LAN a device must be enrolled with a pairing code.
func (m *Manager) handleLogin(writer http.ResponseWriter, request *http.Request) {
	if request.Method != http.MethodPost {
		http.Error(writer, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	m.mu.Lock()
	localOnly := m.bindMode == BindModeLocal
	m.mu.Unlock()
	if !localOnly {
		http.Error(writer, "局域网访问需要用绑定码配对（见设置页显示的绑定码）", http.StatusForbidden)
		return
	}
	if !m.allowLoginAttempt(remoteIP(request)) {
		http.Error(writer, "尝试次数过多，请稍后再试", http.StatusTooManyRequests)
		return
	}
	var payload struct {
		Password string `json:"password"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(writer, request.Body, 4<<10)).Decode(&payload); err != nil {
		http.Error(writer, "请求格式不正确", http.StatusBadRequest)
		return
	}
	if !m.passwordMatches(payload.Password) {
		http.Error(writer, "访问口令不正确", http.StatusUnauthorized)
		return
	}

	token := randomHex(32)
	ip := remoteIP(request)
	now := time.Now()
	ttl := m.sessionTTL
	if ttl <= 0 {
		ttl = defaultSessionTTL
	}
	m.mu.Lock()
	device := deviceRecord{
		Device: Device{
			ID:          randomHex(6),
			Name:        "本机浏览器",
			IP:          ip,
			Networks:    []string{subnetOf(ip)},
			Capability:  CapabilityControl,
			State:       StateActive,
			ExpiresAt:   now.Add(ttl).UTC().Format(time.RFC3339),
			FirstSeenAt: now.UTC().Format(time.RFC3339),
			LastSeenAt:  now.UTC().Format(time.RFC3339),
		},
		TokenHash: hashToken(token),
	}
	m.devices = append(m.devices, device)
	m.appendAuditLocked(AuditEntry{
		DeviceID: device.ID, DeviceName: device.Name, IP: device.IP,
		Action: "login", Detail: "本机口令登录（可操作）", OK: true,
	})
	err := m.persistLocked()
	m.mu.Unlock()
	if err != nil {
		http.Error(writer, "保存配对状态失败", http.StatusInternalServerError)
		return
	}
	setSessionCookie(writer, token, ttl)
	writer.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(writer).Encode(map[string]any{"ok": true, "device_id": device.ID, "capability": CapabilityControl})
}

func (m *Manager) handleLogout(writer http.ResponseWriter, request *http.Request) {
	if request.Method != http.MethodPost {
		http.Error(writer, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if device, ok := m.deviceRecordForRequest(request); ok {
		_ = m.RevokeDevice(device.ID)
	}
	http.SetCookie(writer, &http.Cookie{Name: sessionCookie, Value: "", Path: "/", MaxAge: -1})
	writer.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(writer).Encode(map[string]any{"ok": true})
}

func (m *Manager) handleState(writer http.ResponseWriter, request *http.Request) {
	device, auth := m.deviceForRequest(request)
	if !auth.OK {
		writeAuthFailure(writer, auth)
		return
	}
	snapshot := Snapshot{GeneratedAt: time.Now().UTC().Format(time.RFC3339), Device: device}
	if m.provider != nil {
		ctx, cancel := context.WithTimeout(request.Context(), 8*time.Second)
		defer cancel()
		live, err := m.provider.RemoteControlSnapshot(ctx, device)
		if err != nil {
			http.Error(writer, err.Error(), http.StatusInternalServerError)
			return
		}
		live.Device = device
		if live.GeneratedAt == "" {
			live.GeneratedAt = snapshot.GeneratedAt
		}
		snapshot = live
	}
	writer.Header().Set("Content-Type", "application/json; charset=utf-8")
	_ = json.NewEncoder(writer).Encode(snapshot)
}

// handleMode tells the page whether the host password is usable here. It exposes no
// secret: it only reports how this listener was configured.
func (m *Manager) handleMode(writer http.ResponseWriter, _ *http.Request) {
	m.mu.Lock()
	localOnly := m.bindMode == BindModeLocal
	m.mu.Unlock()
	writer.Header().Set("Content-Type", "application/json; charset=utf-8")
	_ = json.NewEncoder(writer).Encode(map[string]any{"local_only": localOnly})
}

// handleAudit returns only this device's own actions, so a paired phone cannot read what
// another device did.
func (m *Manager) handleAudit(writer http.ResponseWriter, request *http.Request) {
	device, auth := m.deviceForRequest(request)
	if !auth.OK {
		writeAuthFailure(writer, auth)
		return
	}
	m.mu.Lock()
	entries := make([]AuditEntry, 0, 20)
	for _, entry := range m.audit {
		if entry.DeviceID == device.ID {
			entries = append(entries, entry)
		}
	}
	m.mu.Unlock()
	if len(entries) > 20 {
		entries = entries[len(entries)-20:]
	}
	writer.Header().Set("Content-Type", "application/json; charset=utf-8")
	_ = json.NewEncoder(writer).Encode(entries)
}

// handleConversation returns one conversation with its recent messages so the page can
// show a chat view without downloading everything.
func (m *Manager) handleConversation(writer http.ResponseWriter, request *http.Request) {
	if _, auth := m.deviceForRequest(request); !auth.OK {
		writeAuthFailure(writer, auth)
		return
	}
	if m.provider == nil {
		http.Error(writer, "主机未接通数据接口", http.StatusServiceUnavailable)
		return
	}
	conversationID := strings.TrimSpace(request.URL.Query().Get("id"))
	if conversationID == "" {
		http.Error(writer, "缺少对话标识", http.StatusBadRequest)
		return
	}
	ctx, cancel := context.WithTimeout(request.Context(), 8*time.Second)
	defer cancel()
	conversation, err := m.provider.RemoteConversation(ctx, conversationID)
	if err != nil {
		http.Error(writer, err.Error(), http.StatusNotFound)
		return
	}
	writer.Header().Set("Content-Type", "application/json; charset=utf-8")
	_ = json.NewEncoder(writer).Encode(conversation)
}

// maxRemotePromptRunes bounds one remotely submitted prompt.
const maxRemotePromptRunes = 8000

func (m *Manager) handleSend(writer http.ResponseWriter, request *http.Request) {
	var payload struct {
		ConversationID string `json:"conversation_id"`
		Prompt         string `json:"prompt"`
		// Mode is "" to send the prompt, "queue" to park it behind the running turn, or
		// "steer" to guide the running turn (the same three choices the desktop composer has).
		Mode string `json:"mode"`
	}
	m.writeAction(writer, request, "send", func(ctx context.Context, _ Device) (string, error) {
		if err := json.NewDecoder(http.MaxBytesReader(writer, request.Body, 64<<10)).Decode(&payload); err != nil {
			return "", errors.New("请求格式不正确")
		}
		prompt := strings.TrimSpace(payload.Prompt)
		if prompt == "" {
			return "", errors.New("消息不能为空")
		}
		if len([]rune(prompt)) > maxRemotePromptRunes {
			return "", fmt.Errorf("消息过长（上限 %d 字）", maxRemotePromptRunes)
		}
		mode := strings.TrimSpace(payload.Mode)
		switch mode {
		case "", "queue", "steer":
		default:
			return "", fmt.Errorf("不支持的发送方式：%s", mode)
		}
		conversationID := strings.TrimSpace(payload.ConversationID)
		if conversationID == "" {
			return "", errors.New("缺少对话标识")
		}
		if err := m.controller.RemoteSendMessage(ctx, conversationID, prompt, mode); err != nil {
			return "", err
		}
		switch mode {
		case "queue":
			return "排队到 " + conversationID, nil
		case "steer":
			return "引导 " + conversationID, nil
		default:
			return "发送到 " + conversationID, nil
		}
	})
}

// writeAction runs one control action after checking the device may act. Every attempt
// is audited, allowed or not.
func (m *Manager) writeAction(
	writer http.ResponseWriter,
	request *http.Request,
	action string,
	handler func(ctx context.Context, device Device) (string, error),
) {
	if request.Method != http.MethodPost {
		http.Error(writer, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if strings.TrimSpace(request.Header.Get(actionHeader)) == "" {
		http.Error(writer, "missing action header", http.StatusForbidden)
		return
	}
	device, auth := m.deviceForRequest(request)
	if !auth.OK {
		writeAuthFailure(writer, auth)
		return
	}
	if !device.CanControl {
		m.mu.Lock()
		m.appendAuditLocked(AuditEntry{
			DeviceID: device.ID, DeviceName: device.Name, IP: device.IP,
			Action: action, OK: false, Error: "设备是只读权限（" + device.State + "）",
		})
		m.mu.Unlock()
		http.Error(writer, "该设备为只读权限；请在主机设置里升级为「可操作」", http.StatusForbidden)
		return
	}
	if m.controller == nil {
		http.Error(writer, "主机未接通控制接口", http.StatusServiceUnavailable)
		return
	}
	detail, err := handler(request.Context(), device)
	m.mu.Lock()
	m.appendAuditLocked(AuditEntry{
		DeviceID: device.ID, DeviceName: device.Name, IP: device.IP,
		Action: action, Detail: detail, OK: err == nil, Error: errorText(err),
	})
	m.mu.Unlock()
	// Another device may be watching: wake it, whatever the outcome was.
	m.NotifyChange()
	if err != nil {
		http.Error(writer, err.Error(), http.StatusBadRequest)
		return
	}
	writer.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(writer).Encode(map[string]any{"ok": true, "detail": detail})
}

// writeAuthFailure explains a rejected request. The reason also travels in a header so
// the page can show a specific message.
func writeAuthFailure(writer http.ResponseWriter, auth authResult) {
	reason := auth.Reason
	message := "访问已失效，请在主机上重新生成绑定码"
	switch reason {
	case reasonNetworkUnverified:
		message = "本设备当前所在网络未获主机核验：请在主机「设置 → 网络 / 远端控制」里核验此网络，或重新生成绑定码"
	case reasonUnknownDevice:
		message = "本设备已被注销，请在主机上重新生成绑定码"
	}
	writer.Header().Set("X-MilkSU-Remote-Reason", reason)
	http.Error(writer, message, http.StatusUnauthorized)
}

func errorText(err error) string {
	if err == nil {
		return ""
	}
	return err.Error()
}

func (m *Manager) handleApprove(writer http.ResponseWriter, request *http.Request) {
	var payload struct {
		ConversationID string `json:"conversation_id"`
		RequestID      string `json:"request_id"`
		Approved       bool   `json:"approved"`
		// Scope is "conversation" to allow the same tool for the rest of the conversation.
		Scope string `json:"scope"`
		// Choice answers an ask card: an option id, or "other:<text>" for free text.
		Choice string `json:"choice"`
	}
	m.writeAction(writer, request, "approve", func(ctx context.Context, _ Device) (string, error) {
		if err := json.NewDecoder(http.MaxBytesReader(writer, request.Body, 8<<10)).Decode(&payload); err != nil {
			return "", errors.New("请求格式不正确")
		}
		scope := strings.TrimSpace(payload.Scope)
		if scope != "" && scope != "conversation" {
			return "", fmt.Errorf("不支持的授权范围：%s", scope)
		}
		choice := strings.TrimSpace(payload.Choice)
		if err := m.controller.RemoteApproveTool(ctx, payload.ConversationID, payload.RequestID, payload.Approved, scope, choice); err != nil {
			return "", err
		}
		verdict := "拒绝"
		if payload.Approved {
			verdict = "批准"
		}
		if scope == "conversation" {
			verdict += "（本对话内）"
		}
		if choice != "" {
			verdict += " 选择 " + choice
		}
		return verdict + " " + payload.RequestID, nil
	})
}

// handleWithdrawQueued removes one parked prompt. The page sends back the position and the
// text it saw, so a queue that moved meanwhile is refused instead of dropping a neighbour.
func (m *Manager) handleWithdrawQueued(writer http.ResponseWriter, request *http.Request) {
	var payload struct {
		ConversationID string `json:"conversation_id"`
		Queue          string `json:"queue"`
		Index          int    `json:"index"`
		Expected       string `json:"expected"`
	}
	m.writeAction(writer, request, "queue-withdraw", func(ctx context.Context, _ Device) (string, error) {
		if err := json.NewDecoder(http.MaxBytesReader(writer, request.Body, 8<<10)).Decode(&payload); err != nil {
			return "", errors.New("请求格式不正确")
		}
		if err := m.controller.RemoteWithdrawQueued(
			ctx,
			strings.TrimSpace(payload.ConversationID),
			strings.TrimSpace(payload.Queue),
			payload.Index,
			payload.Expected,
		); err != nil {
			return "", err
		}
		return fmt.Sprintf("撤回排队 #%d", payload.Index), nil
	})
}

// handleClearQueued drops every parked prompt of one conversation.
func (m *Manager) handleClearQueued(writer http.ResponseWriter, request *http.Request) {
	var payload struct {
		ConversationID string `json:"conversation_id"`
	}
	m.writeAction(writer, request, "queue-clear", func(ctx context.Context, _ Device) (string, error) {
		if err := json.NewDecoder(http.MaxBytesReader(writer, request.Body, 8<<10)).Decode(&payload); err != nil {
			return "", errors.New("请求格式不正确")
		}
		conversationID := strings.TrimSpace(payload.ConversationID)
		if err := m.controller.RemoteClearQueued(ctx, conversationID); err != nil {
			return "", err
		}
		return "清空排队 " + conversationID, nil
	})
}

func (m *Manager) handleSelectModel(writer http.ResponseWriter, request *http.Request) {
	var payload struct {
		Provider string `json:"provider"`
		Model    string `json:"model"`
	}
	m.writeAction(writer, request, "model", func(ctx context.Context, _ Device) (string, error) {
		if err := json.NewDecoder(http.MaxBytesReader(writer, request.Body, 8<<10)).Decode(&payload); err != nil {
			return "", errors.New("请求格式不正确")
		}
		if err := m.controller.RemoteSelectModel(ctx, payload.Provider, payload.Model); err != nil {
			return "", err
		}
		return payload.Provider + "/" + payload.Model, nil
	})
}

func (m *Manager) handleSelectPolicy(writer http.ResponseWriter, request *http.Request) {
	var payload struct {
		ConversationID string `json:"conversation_id"`
		Policy         string `json:"policy"`
	}
	m.writeAction(writer, request, "policy", func(ctx context.Context, _ Device) (string, error) {
		if err := json.NewDecoder(http.MaxBytesReader(writer, request.Body, 8<<10)).Decode(&payload); err != nil {
			return "", errors.New("请求格式不正确")
		}
		if err := m.controller.RemoteSelectApprovalPolicy(ctx, payload.ConversationID, payload.Policy); err != nil {
			return "", err
		}
		return payload.ConversationID + " → " + payload.Policy, nil
	})
}

func (m *Manager) handleCreateConversation(writer http.ResponseWriter, request *http.Request) {
	var payload struct {
		Title         string `json:"title"`
		WorkspacePath string `json:"workspace_path"`
	}
	m.writeAction(writer, request, "conversation", func(ctx context.Context, _ Device) (string, error) {
		if err := json.NewDecoder(http.MaxBytesReader(writer, request.Body, 8<<10)).Decode(&payload); err != nil {
			return "", errors.New("请求格式不正确")
		}
		id, err := m.controller.RemoteCreateConversation(ctx, payload.Title, payload.WorkspacePath)
		if err != nil {
			return "", err
		}
		return "新建对话 " + id, nil
	})
}

// sessionTTLLocked reports the configured authorisation lifetime. Callers already hold
// the lock; effectiveSessionTTL is the locking wrapper for everyone else.
func (m *Manager) sessionTTLLocked() time.Duration {
	if m.sessionTTL <= 0 {
		return defaultSessionTTL
	}
	return m.sessionTTL
}

func (m *Manager) effectiveSessionTTL() time.Duration {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.sessionTTLLocked()
}

func (m *Manager) passwordMatches(candidate string) bool {
	m.mu.Lock()
	expected := m.password
	m.mu.Unlock()
	return subtle.ConstantTimeCompare([]byte(strings.TrimSpace(candidate)), []byte(expected)) == 1
}

// deviceForRequest resolves the paired device behind a request. A device on a network the
// host already approved keeps working; a device on a new network is blocked until the
// host verifies that network, and the network is remembered once it is.
func (m *Manager) deviceForRequest(request *http.Request) (Device, authResult) {
	cookie, err := request.Cookie(sessionCookie)
	if err != nil || strings.TrimSpace(cookie.Value) == "" {
		return Device{}, authResult{Reason: reasonNoSession}
	}
	hash := hashToken(cookie.Value)
	ip := remoteIP(request)
	subnet := subnetOf(ip)
	now := time.Now()

	m.mu.Lock()
	defer m.mu.Unlock()
	for index := range m.devices {
		record := &m.devices[index]
		if !matchesToken(*record, hash) {
			continue
		}
		if subnet != "" && !hasString(record.Networks, subnet) {
			firstAttempt := record.PendingSubnet != subnet
			record.PendingSubnet = subnet
			record.State = StateNetworkChanged
			record.IP = ip
			record.LastSeenAt = now.UTC().Format(time.RFC3339)
			if firstAttempt {
				m.appendAuditLocked(AuditEntry{
					DeviceID: record.ID, DeviceName: record.Name, IP: ip,
					Action: "network-unverified", Detail: subnet,
					OK: false, Error: "新网络待主机核验",
				})
			}
			_ = m.persistLocked()
			return Device{}, authResult{Reason: reasonNetworkUnverified}
		}
		if record.ExpiresAt != "" && expiredAt(record.ExpiresAt, now) && record.State != StateExpired {
			record.State = StateExpired
			_ = m.persistLocked()
		}
		record.IP = ip
		record.LastSeenAt = now.UTC().Format(time.RFC3339)
		return m.projectDeviceLocked(*record, now), authResult{OK: true}
	}
	return Device{}, authResult{Reason: reasonUnknownDevice}
}

// deviceRecordForRequest looks the device up without the network gate, so a device on a
// new network can still unpair itself.
func (m *Manager) deviceRecordForRequest(request *http.Request) (Device, bool) {
	cookie, err := request.Cookie(sessionCookie)
	if err != nil || strings.TrimSpace(cookie.Value) == "" {
		return Device{}, false
	}
	hash := hashToken(cookie.Value)
	m.mu.Lock()
	defer m.mu.Unlock()
	for index := range m.devices {
		if matchesToken(m.devices[index], hash) {
			return m.devices[index].Device, true
		}
	}
	return Device{}, false
}

func hasString(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}

func (m *Manager) allowLoginAttempt(ip string) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	cutoff := time.Now().Add(-loginWindow)
	kept := make([]time.Time, 0, len(m.loginFailures[ip]))
	for _, at := range m.loginFailures[ip] {
		if at.After(cutoff) {
			kept = append(kept, at)
		}
	}
	if len(kept) >= loginAttempts {
		m.loginFailures[ip] = kept
		return false
	}
	m.loginFailures[ip] = append(kept, time.Now())
	return true
}

// LANAddress returns the machine's LAN IPv4 address, or empty when there is none. The
// server binds that address instead of 0.0.0.0, so it never answers on interfaces the
// user did not intend (VPN, tunnels, virtual bridges).
func LANAddress() string {
	interfaces, err := net.Interfaces()
	if err != nil {
		return ""
	}
	for _, iface := range interfaces {
		if iface.Flags&net.FlagUp == 0 || iface.Flags&net.FlagLoopback != 0 {
			continue
		}
		if strings.HasPrefix(iface.Name, "utun") || strings.HasPrefix(iface.Name, "bridge") ||
			strings.HasPrefix(iface.Name, "awdl") || strings.HasPrefix(iface.Name, "llw") {
			continue
		}
		addresses, err := iface.Addrs()
		if err != nil {
			continue
		}
		for _, address := range addresses {
			network, ok := address.(*net.IPNet)
			if !ok {
				continue
			}
			ipv4 := network.IP.To4()
			if ipv4 == nil || ipv4.IsLoopback() || ipv4.IsLinkLocalUnicast() {
				continue
			}
			return ipv4.String()
		}
	}
	return ""
}

func remoteIP(request *http.Request) string {
	host, _, err := net.SplitHostPort(request.RemoteAddr)
	if err != nil {
		return request.RemoteAddr
	}
	return host
}

// subnetOf reduces an address to its /24, which is stable enough across DHCP renewals
// while still catching a device that moved to another network.
func subnetOf(ip string) string {
	parsed := net.ParseIP(strings.TrimSpace(ip))
	if parsed == nil {
		return ""
	}
	ipv4 := parsed.To4()
	if ipv4 == nil {
		return ""
	}
	return fmt.Sprintf("%d.%d.%d.0/24", ipv4[0], ipv4[1], ipv4[2])
}

func deviceName(request *http.Request) string {
	agent := strings.TrimSpace(request.UserAgent())
	if agent == "" {
		return unknownDeviceName
	}
	runes := []rune(agent)
	if len(runes) > 80 {
		return string(runes[:80])
	}
	return agent
}

// enrollingDeviceIndexLocked finds an existing record for a device that is enrolling again,
// so a phone that lost its cookie is not added as a second device. The stable client id is
// tried first; the same address and user agent are the fallback for pages that cannot keep
// one.
func (m *Manager) enrollingDeviceIndexLocked(clientID, name, ip, boundDeviceID string) int {
	if boundDeviceID != "" {
		for index := range m.devices {
			if m.devices[index].ID == boundDeviceID {
				return index
			}
		}
	}
	if clientID != "" {
		for index := range m.devices {
			if m.devices[index].ClientID == clientID {
				return index
			}
		}
	}
	if ip != "" && name != "" {
		for index := range m.devices {
			if m.devices[index].IP == ip && m.devices[index].Name == name {
				return index
			}
		}
	}
	// The same phone arriving from another network: the address and the browser origin are
	// both new, so fall back to the platform and browser it is. Only a fingerprint that
	// names exactly one device is used — two identical phones must never be merged.
	fingerprint := deviceFingerprint(name)
	if fingerprint == "" {
		return -1
	}
	found := -1
	for index := range m.devices {
		if deviceFingerprint(m.devices[index].Name) != fingerprint {
			continue
		}
		if found >= 0 {
			return -1
		}
		found = index
	}
	return found
}

// deviceFingerprint reduces a user agent to platform and browser family, so the same phone is
// still recognised after an iOS update changed the version numbers in its agent string. It
// returns empty when the label identifies no real device.
func deviceFingerprint(name string) string {
	agent := strings.TrimSpace(name)
	if agent == "" || agent == unknownDeviceName {
		return ""
	}
	platform := ""
	switch {
	case strings.Contains(agent, "iPhone"):
		platform = "iPhone"
	case strings.Contains(agent, "iPad"):
		platform = "iPad"
	case strings.Contains(agent, "Android"):
		platform = "Android"
	case strings.Contains(agent, "Macintosh"), strings.Contains(agent, "Mac OS X"):
		platform = "Mac"
	case strings.Contains(agent, "Windows"):
		platform = "Windows"
	}
	browser := ""
	switch {
	case strings.Contains(agent, "Edg/"):
		browser = "Edge"
	case strings.Contains(agent, "CriOS"), strings.Contains(agent, "Chrome/"):
		browser = "Chrome"
	case strings.Contains(agent, "FxiOS"), strings.Contains(agent, "Firefox/"):
		browser = "Firefox"
	case strings.Contains(agent, "Safari/"):
		browser = "Safari"
	}
	if platform == "" && browser == "" {
		return ""
	}
	return platform + "|" + browser
}

// tokensOf lists every credential a device may present, newest first.
func tokensOf(record deviceRecord) []string {
	tokens := make([]string, 0, len(record.Tokens)+1)
	for _, token := range record.Tokens {
		if token != "" {
			tokens = append(tokens, token)
		}
	}
	if record.TokenHash != "" && !hasString(tokens, record.TokenHash) {
		tokens = append(tokens, record.TokenHash)
	}
	return tokens
}

// matchesToken compares in constant time, so a wrong credential never leaks how much of a
// hash was right.
func matchesToken(record deviceRecord, hash string) bool {
	matched := false
	for _, token := range tokensOf(record) {
		if subtle.ConstantTimeCompare([]byte(token), []byte(hash)) == 1 {
			matched = true
		}
	}
	return matched
}

// rememberToken adds a credential and keeps the newest maxDeviceTokens ones.
func rememberToken(record *deviceRecord, hash string) {
	kept := make([]string, 0, maxDeviceTokens)
	for _, token := range tokensOf(*record) {
		if token != hash && !hasString(kept, token) {
			kept = append(kept, token)
		}
	}
	kept = append(kept, hash)
	if len(kept) > maxDeviceTokens {
		kept = kept[len(kept)-maxDeviceTokens:]
	}
	record.Tokens = kept
	record.TokenHash = hash
}

// setSessionCookie hands the device its credential. Its lifetime matches the device record,
// so pairing once is remembered for the whole session TTL instead of ending as soon as the
// browser drops a session cookie.
func setSessionCookie(writer http.ResponseWriter, token string, ttl time.Duration) {
	if ttl <= 0 {
		ttl = defaultSessionTTL
	}
	http.SetCookie(writer, &http.Cookie{
		Name:     sessionCookie,
		Value:    token,
		Path:     "/",
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		Expires:  time.Now().Add(ttl),
		MaxAge:   int(ttl.Seconds()),
	})
}

func hashToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}
