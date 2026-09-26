package remotecontrol

// 这一层是给原生客户端用的加密通道：WebSocket 上跑 Noise XX，握手之后管道里只有密文。
//
// 浏览器的陪看页仍然走明文 HTTP。那是过渡期的降级通道（最终形态是原生 App），
// 网页退休之后「局域网是明文」这条就自然消失了，不必为了它写浏览器端 Noise。
//
// 和 HTTP 通道的关系：配对码、设备名单、权限、换网核验、审计全部复用同一套；
// 这里只换传输。

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/flynn/noise"
	"golang.org/x/crypto/curve25519"

	"github.com/gorilla/websocket"
)

// noisePrologue 把这条通道绑到协议名上。两边不一致就握不上手，避免把别的
// WebSocket 流量误当成这个协议。
var noisePrologue = []byte("milksu-remote-v1")

// noiseSuite 是这条通道的密码套件：X25519 + ChaCha20-Poly1305 + SHA-256。
//
// 用 SHA-256 而不是 Noise 默认的 BLAKE2s：苹果的 CryptoKit 没有 BLAKE2s，换成
// SHA-256 之后 iOS 端用系统自带的加密就能实现整个握手，不必在手机上引第三方加密库。
// Noise_XX_25519_ChaChaPoly_SHA256 是 Noise 规范里的标准套件，不是自创组合。
var noiseSuite = noise.NewCipherSuite(noise.DH25519, noise.CipherChaChaPoly, noise.HashSHA256)

const (
	// noiseFrameLimit bounds one decrypted application message.
	noiseFrameLimit = 8 << 20
	// noiseHandshakeTimeout bounds the whole handshake, not each message.
	noiseHandshakeTimeout = 20 * time.Second
)

// generateHostKey mints the host's Noise static keypair.
func generateHostKey() ([]byte, []byte, error) {
	keypair, err := noiseSuite.GenerateKeypair(rand.Reader)
	if err != nil {
		return nil, nil, err
	}
	return keypair.Private, keypair.Public, nil
}

// hostPublicFromPrivate derives the public half. Noise 的 DH25519 就是 X25519，
// 所以公钥是私钥对基点的标量乘。
func hostPublicFromPrivate(private []byte) []byte {
	public, err := curve25519.X25519(private, curve25519.Basepoint)
	if err != nil {
		return nil
	}
	return public
}

// hostFingerprint 是二维码里给客户端钉住的那串短指纹。它必须短到能放进二维码、
// 又长到猜不出来：取公钥 SHA-256 的前 8 字节。
func hostFingerprint(public []byte) string {
	if len(public) == 0 {
		return ""
	}
	sum := sha256.Sum256(public)
	return hex.EncodeToString(sum[:8])
}

// MatchesFingerprint reports whether a host's static public key is the one a client pinned.
// The probe and any native client share this, so the pinning rule has one implementation.
func MatchesFingerprint(public []byte, expected string) bool {
	expected = strings.ToLower(strings.TrimSpace(expected))
	if expected == "" {
		return false
	}
	return hostFingerprint(public) == expected
}

// Fingerprint reports the host fingerprint clients pin. It is empty while the
// companion server has never been enabled, because no key exists yet.
func (m *Manager) Fingerprint() string {
	m.mu.Lock()
	defer m.mu.Unlock()
	return hostFingerprint(m.hostPublic)
}

// noiseEnvelope 是握手之后管道里跑的那一种消息。明文 HTTP 通道用一堆
// 不同的 URL，这里统一收成一个信封，方法名放在 method 里。
type noiseEnvelope struct {
	Type string `json:"type"`
	// enrol 用：一次性配对码，以及客户端自报的名字。
	Code     string `json:"code,omitempty"`
	ClientID string `json:"client_id,omitempty"`
	Name     string `json:"name,omitempty"`
	// request 用：要调的方法名。
	Method string `json:"method,omitempty"`
	// Params carries the method-specific payload. The HTTP channel reads these from the
	// request body or the query string; here they ride in the same encrypted frame.
	Params json.RawMessage `json:"params,omitempty"`
	// response 用。
	OK     bool            `json:"ok"`
	Error  string          `json:"error,omitempty"`
	Detail string          `json:"detail,omitempty"`
	Data   json.RawMessage `json:"data,omitempty"`
	Device *Device         `json:"device,omitempty"`
}

// handleNoiseChannel upgrades one connection and serves it over Noise.
func (m *Manager) handleNoiseChannel(writer http.ResponseWriter, request *http.Request) {
	if request.Method != http.MethodGet {
		http.Error(writer, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if !m.allowLoginAttempt(remoteIP(request)) {
		http.Error(writer, "尝试次数过多，请稍后再试", http.StatusTooManyRequests)
		return
	}
	upgrader := websocket.Upgrader{
		ReadBufferSize:  4096,
		WriteBufferSize: 4096,
		// 原生客户端不带 Origin；这里只要求不是浏览器页面发起的跨站请求。
		CheckOrigin: func(request *http.Request) bool {
			origin := request.Header.Get("Origin")
			return origin == "" || strings.HasPrefix(origin, "http://"+request.Host) ||
				strings.HasPrefix(origin, "https://"+request.Host)
		},
	}
	connection, err := upgrader.Upgrade(writer, request, nil)
	if err != nil {
		return
	}
	defer connection.Close()
	connection.SetReadLimit(noiseFrameLimit)

	ip := remoteIP(request)
	subnet := subnetOf(ip)
	if err := m.serveNoiseConnection(connection, request, ip, subnet); err != nil {
		// 客户端会看到连接被关掉；具体原因只写进电脑侧日志，不回给对端，
		// 免得把「配对码对不对」这种信息泄露出去。
		_ = connection.WriteControl(websocket.CloseMessage,
			websocket.FormatCloseMessage(websocket.ClosePolicyViolation, "closed"),
			time.Now().Add(2*time.Second))
	}
}

// serveNoiseConnection runs the handshake and then the request loop.
func (m *Manager) serveNoiseConnection(connection *websocket.Conn, request *http.Request, ip, subnet string) error {
	m.mu.Lock()
	hostPrivate := append([]byte(nil), m.hostPrivate...)
	hostPublic := append([]byte(nil), m.hostPublic...)
	m.mu.Unlock()
	if len(hostPrivate) != 32 {
		return errors.New("主机密钥还没生成")
	}

	handshake, err := noise.NewHandshakeState(noise.Config{
		CipherSuite:   noiseSuite,
		Pattern:       noise.HandshakeXX,
		Initiator:     false,
		Prologue:      noisePrologue,
		StaticKeypair: noise.DHKey{Private: hostPrivate, Public: hostPublic},
	})
	if err != nil {
		return err
	}

	send, receive, err := m.runNoiseHandshake(connection, handshake)
	if err != nil {
		return err
	}

	peerStatic := handshake.PeerStatic()
	if len(peerStatic) != 32 {
		return errors.New("对端没有交出静态公钥")
	}

	if _, err := m.authoriseNoisePeer(connection, send, receive, peerStatic, request, ip, subnet); err != nil {
		return err
	}
	return m.serveNoiseRequests(connection, send, receive, hex.EncodeToString(peerStatic), ip)
}

// runNoiseHandshake exchanges the three XX messages and returns the transport states.
func (m *Manager) runNoiseHandshake(connection *websocket.Conn, handshake *noise.HandshakeState) (*noise.CipherState, *noise.CipherState, error) {
	deadline := time.Now().Add(noiseHandshakeTimeout)
	if err := connection.SetReadDeadline(deadline); err != nil {
		return nil, nil, err
	}
	defer func() { _ = connection.SetReadDeadline(time.Time{}) }()

	// XX：读第一包 → 写第二包 → 读第三包。
	messageType, first, err := connection.ReadMessage()
	if err != nil {
		return nil, nil, err
	}
	if messageType != websocket.BinaryMessage {
		return nil, nil, errors.New("握手包必须是二进制")
	}
	if _, _, _, err := handshake.ReadMessage(nil, first); err != nil {
		return nil, nil, err
	}
	second, _, _, err := handshake.WriteMessage(nil, nil)
	if err != nil {
		return nil, nil, err
	}
	if err := connection.WriteMessage(websocket.BinaryMessage, second); err != nil {
		return nil, nil, err
	}
	messageType, third, err := connection.ReadMessage()
	if err != nil {
		return nil, nil, err
	}
	if messageType != websocket.BinaryMessage {
		return nil, nil, errors.New("握手包必须是二进制")
	}
	// ReadMessage 返回的两个 CipherState 是「发起方→响应方」在前、「响应方→发起方」在后，
	// 跟角色无关。所以对响应方（我们）来说第一个是**接收**、第二个才是发送。写反了
	// 握手会成功、第一发数据就解密失败 —— 这个坑由 TestNoiseChannelPairsAndServesTheSnapshot 看着。
	_, receive, send, err := handshake.ReadMessage(nil, third)
	if err != nil {
		return nil, nil, err
	}
	// 握手完成后必须先验指纹再收应用数据：客户端要确认它连的是屏幕上那台电脑。
	if err := m.verifyPinnedClient(handshake.PeerStatic()); err != nil {
		return nil, nil, err
	}
	return send, receive, nil
}

// verifyPinnedClient has no host-side pinning yet: the client pins the host, not the other
// way round. It exists so the check has one obvious place when the app adds its own.
func (m *Manager) verifyPinnedClient([]byte) error { return nil }

// authoriseNoisePeer turns the peer's static key into a device. A known key resumes the
// existing device; an unknown one must present a valid pairing code and is then enrolled
// read-only, exactly like the browser flow.
func (m *Manager) authoriseNoisePeer(connection *websocket.Conn, send, receive *noise.CipherState, peerStatic []byte, request *http.Request, ip, subnet string) (Device, error) {
	payload, err := readNoiseMessage(connection, receive)
	if err != nil {
		return Device{}, err
	}
	var envelope noiseEnvelope
	if err := json.Unmarshal(payload, &envelope); err != nil {
		return Device{}, err
	}
	if envelope.Type != "enrol" {
		return Device{}, errors.New("第一条消息必须是 enrol")
	}

	key := hex.EncodeToString(peerStatic)
	if device, ok := m.deviceForNoiseKey(key); ok {
		return device, writeNoiseMessage(connection, send, noiseEnvelope{
			Type:   "enrol.result",
			OK:     true,
			Device: &device,
		})
	}

	boundDeviceID, ok := m.consumePairingCode(envelope.Code)
	if !ok {
		_ = writeNoiseMessage(connection, send, noiseEnvelope{
			Type: "enrol.result", OK: false, Error: "绑定码不正确或已过期",
		})
		return Device{}, errors.New("绑定码不正确或已过期")
	}
	device, err := m.enrolNoiseDevice(key, envelope.ClientID, envelope.Name, request, ip, subnet, boundDeviceID)
	if err != nil {
		return Device{}, err
	}
	if err := writeNoiseMessage(connection, send, noiseEnvelope{
		Type: "enrol.result", OK: true, Device: &device,
	}); err != nil {
		return Device{}, err
	}
	return device, nil
}

// deviceForNoiseKey resumes a device that already proved this static key.
func (m *Manager) deviceForNoiseKey(key string) (Device, bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for index := range m.devices {
		if m.devices[index].NoisePublicKey != key {
			continue
		}
		now := time.Now()
		m.devices[index].LastSeenAt = now.UTC().Format(time.RFC3339)
		return m.projectDeviceLocked(m.devices[index], now), true
	}
	return Device{}, false
}

// enrolNoiseDevice records a new device that presented a valid pairing code. It reuses the
// browser enrolment rules so a phone that lost its state, or moved network, keeps one row.
func (m *Manager) enrolNoiseDevice(key, clientID, name string, request *http.Request, ip, subnet, boundDeviceID string) (Device, error) {
	if strings.TrimSpace(name) == "" {
		name = deviceName(request)
	}
	ttl := m.effectiveSessionTTL()
	now := time.Now()
	expiresAt := now.Add(ttl).UTC().Format(time.RFC3339)

	m.mu.Lock()
	defer m.mu.Unlock()
	index := m.enrollingDeviceIndexLocked(strings.TrimSpace(clientID), name, ip, boundDeviceID)
	var device Device
	if index >= 0 {
		record := &m.devices[index]
		record.Name = name
		record.IP = ip
		record.ClientID = strings.TrimSpace(clientID)
		record.NoisePublicKey = key
		record.State = StateActive
		record.ExpiresAt = expiresAt
		record.PendingSubnet = ""
		record.LastSeenAt = now.UTC().Format(time.RFC3339)
		detail := "重新配对：复用原设备，保留已有权限"
		if subnet != "" && !hasString(record.Networks, subnet) {
			record.Networks = append(record.Networks, subnet)
			detail += "，已记住网络 " + subnet
		}
		device = record.Device
		m.appendAuditLocked(AuditEntry{
			DeviceID: device.ID, DeviceName: device.Name, IP: device.IP,
			Action: "pair", Detail: detail + "（加密通道）", OK: true,
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
			Device:         device,
			ClientID:       strings.TrimSpace(clientID),
			NoisePublicKey: key,
		})
		m.appendAuditLocked(AuditEntry{
			DeviceID: device.ID, DeviceName: device.Name, IP: device.IP,
			Action: "pair", Detail: "以绑定码配对（加密通道，默认只读）", OK: true,
		})
	}
	if err := m.persistLocked(); err != nil {
		return Device{}, err
	}
	return device, nil
}

// serveNoiseRequests answers the request loop.
//
// 它每一轮都按静态公钥重新解析设备，而不是用手握时那一份快照。否则升级、换网降级、
// 过期和撤销都要等到重连才生效 —— 对撤销而言那是安全事故：被撤销的设备会继续用它
// 旧的权限直到自己断开。HTTP 通道每个请求都重算，这里必须同口径。
func (m *Manager) serveNoiseRequests(connection *websocket.Conn, send, receive *noise.CipherState, key, ip string) error {
	for {
		payload, err := readNoiseMessage(connection, receive)
		if err != nil {
			return err
		}
		var envelope noiseEnvelope
		if err := json.Unmarshal(payload, &envelope); err != nil {
			return err
		}
		device, ok := m.deviceForNoiseKey(key)
		if !ok {
			// 设备已被撤销：明确回一句再断开，别让对方以为还能用。
			_ = writeNoiseMessage(connection, send, noiseEnvelope{
				Type: "response", OK: false, Error: "该设备已被主机撤销",
			})
			return errors.New("设备已被撤销")
		}
		reply := m.handleNoiseRequest(envelope, device, ip)
		if err := writeNoiseMessage(connection, send, reply); err != nil {
			return err
		}
	}
}

// handleNoiseRequest maps one method name onto the same projection and the same permission
// rules the HTTP channel uses. Reads need any paired device; writes go through performWrite,
// so a read-only device is refused here exactly as it is over HTTP.
func (m *Manager) handleNoiseRequest(envelope noiseEnvelope, device Device, ip string) noiseEnvelope {
	if envelope.Type != "request" {
		return noiseEnvelope{Type: "response", OK: false, Error: "未知的消息类型"}
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	switch envelope.Method {
	case "identity":
		return noiseEnvelope{Type: "response", OK: true, Device: &device}

	case "snapshot":
		if m.provider == nil {
			return noiseEnvelope{Type: "response", OK: false, Error: "主机未接通数据接口"}
		}
		snapshot, err := m.provider.RemoteControlSnapshot(ctx, device)
		if err != nil {
			return noiseEnvelope{Type: "response", OK: false, Error: err.Error()}
		}
		return noiseResponse(snapshot)

	case "conversation":
		var params struct {
			ConversationID string `json:"conversation_id"`
		}
		if err := json.Unmarshal(envelope.Params, &params); err != nil {
			return noiseEnvelope{Type: "response", OK: false, Error: "参数格式不正确"}
		}
		if strings.TrimSpace(params.ConversationID) == "" {
			return noiseEnvelope{Type: "response", OK: false, Error: "缺少对话标识"}
		}
		if m.provider == nil {
			return noiseEnvelope{Type: "response", OK: false, Error: "主机未接通数据接口"}
		}
		conversation, err := m.provider.RemoteConversation(ctx, params.ConversationID)
		if err != nil {
			return noiseEnvelope{Type: "response", OK: false, Error: err.Error()}
		}
		return noiseResponse(conversation)

	case "send":
		var params struct {
			ConversationID string `json:"conversation_id"`
			Prompt         string `json:"prompt"`
			Mode           string `json:"mode"`
		}
		if err := json.Unmarshal(envelope.Params, &params); err != nil {
			return noiseEnvelope{Type: "response", OK: false, Error: "参数格式不正确"}
		}
		return m.noiseWrite(device, "send", func(ctx context.Context) (string, error) {
			return sendRemoteMessage(ctx, m.controller, params.ConversationID, params.Prompt, params.Mode)
		})

	case "approve":
		var params struct {
			ConversationID string `json:"conversation_id"`
			RequestID      string `json:"request_id"`
			Approved       bool   `json:"approved"`
			Scope          string `json:"scope"`
			Choice         string `json:"choice"`
		}
		if err := json.Unmarshal(envelope.Params, &params); err != nil {
			return noiseEnvelope{Type: "response", OK: false, Error: "参数格式不正确"}
		}
		return m.noiseWrite(device, "approve", func(ctx context.Context) (string, error) {
			return approveRemoteTool(ctx, m.controller, params.ConversationID, params.RequestID,
				params.Approved, params.Scope, params.Choice)
		})

	case "queue.withdraw":
		var params struct {
			ConversationID string `json:"conversation_id"`
			Queue          string `json:"queue"`
			Index          int    `json:"index"`
			Expected       string `json:"expected"`
		}
		if err := json.Unmarshal(envelope.Params, &params); err != nil {
			return noiseEnvelope{Type: "response", OK: false, Error: "参数格式不正确"}
		}
		return m.noiseWrite(device, "queue-withdraw", func(ctx context.Context) (string, error) {
			return withdrawQueuedMessage(ctx, m.controller, params.ConversationID, params.Queue, params.Index, params.Expected)
		})

	case "queue.clear":
		var params struct {
			ConversationID string `json:"conversation_id"`
		}
		if err := json.Unmarshal(envelope.Params, &params); err != nil {
			return noiseEnvelope{Type: "response", OK: false, Error: "参数格式不正确"}
		}
		return m.noiseWrite(device, "queue-clear", func(ctx context.Context) (string, error) {
			return clearQueuedMessages(ctx, m.controller, params.ConversationID)
		})

	case "model":
		var params struct {
			Provider string `json:"provider"`
			Model    string `json:"model"`
		}
		if err := json.Unmarshal(envelope.Params, &params); err != nil {
			return noiseEnvelope{Type: "response", OK: false, Error: "参数格式不正确"}
		}
		return m.noiseWrite(device, "model", func(ctx context.Context) (string, error) {
			return selectRemoteModel(ctx, m.controller, params.Provider, params.Model)
		})

	case "policy":
		var params struct {
			ConversationID string `json:"conversation_id"`
			Policy         string `json:"policy"`
		}
		if err := json.Unmarshal(envelope.Params, &params); err != nil {
			return noiseEnvelope{Type: "response", OK: false, Error: "参数格式不正确"}
		}
		return m.noiseWrite(device, "policy", func(ctx context.Context) (string, error) {
			return selectRemotePolicy(ctx, m.controller, params.ConversationID, params.Policy)
		})

	case "conversation.create":
		var params struct {
			Title         string `json:"title"`
			WorkspacePath string `json:"workspace_path"`
		}
		if err := json.Unmarshal(envelope.Params, &params); err != nil {
			return noiseEnvelope{Type: "response", OK: false, Error: "参数格式不正确"}
		}
		return m.noiseWrite(device, "conversation", func(ctx context.Context) (string, error) {
			return createRemoteConversation(ctx, m.controller, params.Title, params.WorkspacePath)
		})

	default:
		return noiseEnvelope{Type: "response", OK: false, Error: fmt.Sprintf("未知的方法 %q", envelope.Method)}
	}
}

// noiseWrite runs one write under the shared rules and turns the outcome into a response.
func (m *Manager) noiseWrite(device Device, action string, handler func(ctx context.Context) (string, error)) noiseEnvelope {
	detail, err := m.performWrite(context.Background(), action, device, handler)
	if err != nil {
		return noiseEnvelope{Type: "response", OK: false, Error: err.Error()}
	}
	return noiseEnvelope{Type: "response", OK: true, Detail: detail}
}

// noiseResponse encodes one projection as the response payload.
func noiseResponse(value any) noiseEnvelope {
	encoded, err := json.Marshal(value)
	if err != nil {
		return noiseEnvelope{Type: "response", OK: false, Error: err.Error()}
	}
	return noiseEnvelope{Type: "response", OK: true, Data: encoded}
}

// readNoiseMessage reads one WebSocket frame and decrypts it.
func readNoiseMessage(connection *websocket.Conn, receive *noise.CipherState) ([]byte, error) {
	messageType, frame, err := connection.ReadMessage()
	if err != nil {
		return nil, err
	}
	if messageType != websocket.BinaryMessage {
		return nil, errors.New("帧必须是二进制")
	}
	if len(frame) > noiseFrameLimit {
		return nil, errors.New("帧过大")
	}
	return receive.Decrypt(nil, nil, frame)
}

// writeNoiseMessage encrypts one envelope and sends it as one binary frame.
func writeNoiseMessage(connection *websocket.Conn, send *noise.CipherState, envelope noiseEnvelope) error {
	plaintext, err := json.Marshal(envelope)
	if err != nil {
		return err
	}
	sealed, err := send.Encrypt(nil, nil, plaintext)
	if err != nil {
		return err
	}
	return connection.WriteMessage(websocket.BinaryMessage, sealed)
}
