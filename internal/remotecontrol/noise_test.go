package remotecontrol

import (
	"crypto/rand"
	"encoding/json"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/flynn/noise"
	"github.com/gorilla/websocket"
)

// noiseClient is a minimal initiator used by the tests. It is deliberately separate from
// cmd/remote-probe so a change to the probe cannot quietly change what the tests prove.
type noiseClient struct {
	connection *websocket.Conn
	send       *noise.CipherState
	receive    *noise.CipherState
	// hostKey is the static public key the host presented during the handshake.
	hostKey []byte
}

func dialNoise(t *testing.T, status Status) *noiseClient {
	t.Helper()
	keypair, err := noiseSuite.GenerateKeypair(rand.Reader)
	if err != nil {
		t.Fatalf("generate client key: %v", err)
	}
	return dialNoiseWithKey(t, status, keypair)
}

func dialNoiseWithKey(t *testing.T, status Status, keypair noise.DHKey) *noiseClient {
	t.Helper()
	socket := strings.TrimSuffix(strings.Replace(status.URL, "http", "ws", 1), "/") + "/api/noise"
	connection, _, err := websocket.DefaultDialer.Dial(socket, nil)
	if err != nil {
		t.Fatalf("dial %s: %v", socket, err)
	}
	t.Cleanup(func() { _ = connection.Close() })
	_ = connection.SetReadDeadline(time.Now().Add(10 * time.Second))

	handshake, err := noise.NewHandshakeState(noise.Config{
		CipherSuite:   noiseSuite,
		Pattern:       noise.HandshakeXX,
		Initiator:     true,
		Prologue:      noisePrologue,
		StaticKeypair: keypair,
	})
	if err != nil {
		t.Fatalf("handshake state: %v", err)
	}

	first, _, _, err := handshake.WriteMessage(nil, nil)
	if err != nil {
		t.Fatalf("handshake message 1: %v", err)
	}
	if err := connection.WriteMessage(websocket.BinaryMessage, first); err != nil {
		t.Fatalf("write message 1: %v", err)
	}
	_, second, err := connection.ReadMessage()
	if err != nil {
		t.Fatalf("read message 2: %v", err)
	}
	if _, _, _, err := handshake.ReadMessage(nil, second); err != nil {
		t.Fatalf("consume message 2: %v", err)
	}
	hostKey := handshake.PeerStatic()
	if len(hostKey) != 32 {
		t.Fatalf("host presented no static key")
	}
	third, send, receive, err := handshake.WriteMessage(nil, nil)
	if err != nil {
		t.Fatalf("handshake message 3: %v", err)
	}
	if err := connection.WriteMessage(websocket.BinaryMessage, third); err != nil {
		t.Fatalf("write message 3: %v", err)
	}
	return &noiseClient{connection: connection, send: send, receive: receive, hostKey: hostKey}
}

func (client *noiseClient) exchange(t *testing.T, message noiseEnvelope) noiseEnvelope {
	t.Helper()
	plaintext, err := json.Marshal(message)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	sealed, err := client.send.Encrypt(nil, nil, plaintext)
	if err != nil {
		t.Fatalf("encrypt: %v", err)
	}
	if err := client.connection.WriteMessage(websocket.BinaryMessage, sealed); err != nil {
		t.Fatalf("write: %v", err)
	}
	_, frame, err := client.connection.ReadMessage()
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	opened, err := client.receive.Decrypt(nil, nil, frame)
	if err != nil {
		t.Fatalf("decrypt: %v", err)
	}
	var reply noiseEnvelope
	if err := json.Unmarshal(opened, &reply); err != nil {
		t.Fatalf("unmarshal reply: %v", err)
	}
	return reply
}

func TestNoiseChannelPairsAndServesTheSnapshot(t *testing.T) {
	manager, status, _ := startManager(t)
	code, _ := manager.IssuePairingCode()

	client := dialNoise(t, status)
	// 客户端钉住的指纹必须就是主机自己报出来的那一个。
	if !MatchesFingerprint(client.hostKey, manager.Fingerprint()) {
		t.Fatalf("host key does not match the published fingerprint %s", manager.Fingerprint())
	}

	enrolled := client.exchange(t, noiseEnvelope{Type: "enrol", Code: code, Name: "探针"})
	if !enrolled.OK {
		t.Fatalf("enrol refused: %s", enrolled.Error)
	}
	if enrolled.Device == nil || enrolled.Device.Capability != CapabilityView {
		t.Fatalf("a new device must enroll read-only, got %#v", enrolled.Device)
	}

	reply := client.exchange(t, noiseEnvelope{Type: "request", Method: "snapshot"})
	if !reply.OK {
		t.Fatalf("snapshot refused: %s", reply.Error)
	}
	var snapshot Snapshot
	if err := json.Unmarshal(reply.Data, &snapshot); err != nil {
		t.Fatalf("snapshot payload: %v", err)
	}

	// 快照载荷由 provider 提供（测试里是空桩），而设备绑定是服务端填的，
	// 所以设备身份看 identity 这一路。
	identity := client.exchange(t, noiseEnvelope{Type: "request", Method: "identity"})
	if !identity.OK || identity.Device == nil {
		t.Fatalf("identity refused: %s", identity.Error)
	}
	if identity.Device.ID != enrolled.Device.ID {
		t.Fatalf("identity answered for %q, enrolled %q", identity.Device.ID, enrolled.Device.ID)
	}
}

func TestNoiseChannelRefusesAWrongPairingCode(t *testing.T) {
	manager, status, _ := startManager(t)
	manager.IssuePairingCode()

	client := dialNoise(t, status)
	reply := client.exchange(t, noiseEnvelope{Type: "enrol", Code: "WRONGCODE0", Name: "探针"})
	if reply.OK {
		t.Fatal("a wrong pairing code must not enrol")
	}
	if devices := manager.Status().Devices; len(devices) != 0 {
		t.Fatalf("refused enrolment still added a device: %#v", devices)
	}
}

func TestNoiseChannelResumesAPairedDeviceWithoutANewCode(t *testing.T) {
	manager, status, _ := startManager(t)
	keypair, err := noiseSuite.GenerateKeypair(rand.Reader)
	if err != nil {
		t.Fatalf("generate key: %v", err)
	}

	code, _ := manager.IssuePairingCode()
	first := dialNoiseWithKey(t, status, keypair)
	enrolled := first.exchange(t, noiseEnvelope{Type: "enrol", Code: code, Name: "探针"})
	if !enrolled.OK {
		t.Fatalf("first enrol refused: %s", enrolled.Error)
	}
	_ = first.connection.Close()

	// 第二次不再给绑定码：主机应该认静态公钥，并且还是同一台设备。
	second := dialNoiseWithKey(t, status, keypair)
	resumed := second.exchange(t, noiseEnvelope{Type: "enrol", Name: "探针"})
	if !resumed.OK {
		t.Fatalf("resume refused without a code: %s", resumed.Error)
	}
	if resumed.Device == nil || resumed.Device.ID != enrolled.Device.ID {
		t.Fatalf("resume created another device: %#v vs %#v", resumed.Device, enrolled.Device)
	}
}

func TestNoiseChannelRefusesAnUnknownMethod(t *testing.T) {
	manager, status, _ := startManager(t)
	code, _ := manager.IssuePairingCode()

	client := dialNoise(t, status)
	if reply := client.exchange(t, noiseEnvelope{Type: "enrol", Code: code}); !reply.OK {
		t.Fatalf("enrol refused: %s", reply.Error)
	}
	if reply := client.exchange(t, noiseEnvelope{Type: "request", Method: "credentials"}); reply.OK {
		t.Fatal("the encrypted channel must not answer methods outside its list")
	}
}

func TestNoiseFingerprintSurvivesARestart(t *testing.T) {
	directory := t.TempDir()
	first := New(directory, stubProvider{}, &stubController{})
	before := first.Fingerprint()
	if before == "" {
		t.Fatal("no fingerprint was published")
	}
	if err := first.Close(); err != nil {
		t.Fatalf("close: %v", err)
	}

	second := New(directory, stubProvider{}, &stubController{})
	if after := second.Fingerprint(); after != before {
		t.Fatalf("fingerprint changed across a restart: %s -> %s", before, after)
	}
	if err := second.Close(); err != nil {
		t.Fatalf("close: %v", err)
	}
}

// 只读设备不能在加密通道上写，而且不能碰到控制器 —— 和 HTTP 通道同一条规则。
func TestNoiseChannelRefusesWritesFromAReadOnlyDevice(t *testing.T) {
	manager, status, controller := startManager(t)
	code, _ := manager.IssuePairingCode()
	client := dialNoise(t, status)
	if reply := client.exchange(t, noiseEnvelope{Type: "enrol", Code: code}); !reply.OK {
		t.Fatalf("enrol refused: %s", reply.Error)
	}

	refused := client.exchange(t, noiseEnvelope{
		Type: "request", Method: "send",
		Params: json.RawMessage(`{"conversation_id":"conversation-1","prompt":"跑一下测试"}`),
	})
	if refused.OK {
		t.Fatal("a read-only device must not send over the encrypted channel")
	}
	if len(controller.sent) != 0 {
		t.Fatalf("read-only send reached the controller: %#v", controller.sent)
	}
}

// 升级为可控之后，加密通道上的发消息和审批要走同一套控制器、留同一套审计。
func TestNoiseChannelSendsAndApprovesOnceControlIsGranted(t *testing.T) {
	manager, status, controller := startManager(t)
	code, _ := manager.IssuePairingCode()
	client := dialNoise(t, status)
	enrolled := client.exchange(t, noiseEnvelope{Type: "enrol", Code: code, Name: "探针"})
	if !enrolled.OK {
		t.Fatalf("enrol refused: %s", enrolled.Error)
	}
	if err := manager.SetDeviceCapability(enrolled.Device.ID, CapabilityControl); err != nil {
		t.Fatalf("promote: %v", err)
	}

	sent := client.exchange(t, noiseEnvelope{
		Type: "request", Method: "send",
		Params: json.RawMessage(`{"conversation_id":"conversation-1","prompt":"跑一下测试"}`),
	})
	if !sent.OK {
		t.Fatalf("send refused: %s", sent.Error)
	}
	if len(controller.sent) != 1 || controller.sent[0] != "conversation-1:跑一下测试" {
		t.Fatalf("controller sent = %#v", controller.sent)
	}

	approved := client.exchange(t, noiseEnvelope{
		Type: "request", Method: "approve",
		Params: json.RawMessage(`{"conversation_id":"conversation-1","request_id":"req-1","approved":true,"scope":"conversation","choice":"other:自己写"}`),
	})
	if !approved.OK {
		t.Fatalf("approve refused: %s", approved.Error)
	}
	if len(controller.approvals) != 1 || controller.approvals[0] != "approve:conversation-1:req-1:conversation:other:自己写" {
		t.Fatalf("approvals = %#v", controller.approvals)
	}

	// 审计要和 HTTP 通道同口径，否则两条路的行为就不一致了。
	actions := make([]string, 0, 8)
	for _, entry := range manager.Audit(20) {
		actions = append(actions, entry.Action)
	}
	if !slices.Contains(actions, "send") || !slices.Contains(actions, "approve") {
		t.Fatalf("audit is missing the encrypted writes: %#v", actions)
	}
}

// 加密通道的参数校验必须和 HTTP 通道一致。
func TestNoiseChannelValidatesParametersLikeTheHTTPChannel(t *testing.T) {
	manager, status, controller := startManager(t)
	code, _ := manager.IssuePairingCode()
	client := dialNoise(t, status)
	enrolled := client.exchange(t, noiseEnvelope{Type: "enrol", Code: code})
	if !enrolled.OK {
		t.Fatalf("enrol refused: %s", enrolled.Error)
	}
	if err := manager.SetDeviceCapability(enrolled.Device.ID, CapabilityControl); err != nil {
		t.Fatalf("promote: %v", err)
	}

	for name, params := range map[string]string{
		"空消息":    `{"conversation_id":"conversation-1","prompt":"   "}`,
		"未知发送方式": `{"conversation_id":"conversation-1","prompt":"x","mode":"telepathy"}`,
		"缺少对话":   `{"prompt":"x"}`,
	} {
		reply := client.exchange(t, noiseEnvelope{Type: "request", Method: "send", Params: json.RawMessage(params)})
		if reply.OK {
			t.Fatalf("%s should be refused", name)
		}
	}
	if len(controller.sent) != 0 {
		t.Fatalf("a refused send still reached the controller: %#v", controller.sent)
	}

	if reply := client.exchange(t, noiseEnvelope{Type: "request", Method: "conversation", Params: json.RawMessage(`{}`)}); reply.OK {
		t.Fatal("conversation without an id must be refused")
	}
	read := client.exchange(t, noiseEnvelope{
		Type: "request", Method: "conversation",
		Params: json.RawMessage(`{"conversation_id":"conversation-1"}`),
	})
	if !read.OK {
		t.Fatalf("reading a conversation was refused: %s", read.Error)
	}
}

// 撤销必须当场生效，而不是等对方重连。验收里的「撤销后旧票作废」就是这一条。
func TestNoiseChannelStopsWorkingWhenTheDeviceIsRevoked(t *testing.T) {
	manager, status, _ := startManager(t)
	code, _ := manager.IssuePairingCode()
	client := dialNoise(t, status)
	enrolled := client.exchange(t, noiseEnvelope{Type: "enrol", Code: code})
	if !enrolled.OK {
		t.Fatalf("enrol refused: %s", enrolled.Error)
	}
	if reply := client.exchange(t, noiseEnvelope{Type: "request", Method: "snapshot"}); !reply.OK {
		t.Fatalf("snapshot refused before revoke: %s", reply.Error)
	}

	if err := manager.RevokeDevice(enrolled.Device.ID); err != nil {
		t.Fatalf("revoke: %v", err)
	}

	// 同一条连接上再发请求：必须被拒，而且不能是因为对方自己断开。
	refused := client.exchange(t, noiseEnvelope{Type: "request", Method: "snapshot"})
	if refused.OK {
		t.Fatal("a revoked device kept working on its existing connection")
	}
}

// 剩下五个动作也要在加密通道上可用，而且和 HTTP 通道走同一套校验与审计。
func TestNoiseChannelCarriesTheRemainingActions(t *testing.T) {
	manager, status, controller := startManager(t)
	code, _ := manager.IssuePairingCode()
	client := dialNoise(t, status)
	enrolled := client.exchange(t, noiseEnvelope{Type: "enrol", Code: code})
	if !enrolled.OK {
		t.Fatalf("enrol refused: %s", enrolled.Error)
	}
	if err := manager.SetDeviceCapability(enrolled.Device.ID, CapabilityControl); err != nil {
		t.Fatalf("promote: %v", err)
	}

	for _, step := range []struct {
		method string
		params string
	}{
		{"queue.withdraw", `{"conversation_id":"conversation-1","queue":"steering","index":2,"expected":"排队的那句"}`},
		{"queue.clear", `{"conversation_id":"conversation-1"}`},
		{"model", `{"provider":"deepseek","model":"deepseek-chat"}`},
		{"policy", `{"conversation_id":"conversation-1","policy":"ask"}`},
		{"conversation.create", `{"title":"手机新建","workspace_path":"/tmp/ws"}`},
	} {
		reply := client.exchange(t, noiseEnvelope{Type: "request", Method: step.method, Params: json.RawMessage(step.params)})
		if !reply.OK {
			t.Fatalf("%s refused: %s", step.method, reply.Error)
		}
	}

	if len(controller.withdrawn) != 1 || controller.withdrawn[0] != "conversation-1:steering:排队的那句" {
		t.Fatalf("withdrawn = %#v", controller.withdrawn)
	}
	if len(controller.withdrawnIndex) != 1 || controller.withdrawnIndex[0] != 2 {
		t.Fatalf("withdrawn index = %#v", controller.withdrawnIndex)
	}
	if len(controller.cleared) != 1 || controller.cleared[0] != "conversation-1" {
		t.Fatalf("cleared = %#v", controller.cleared)
	}
	if len(controller.models) != 1 || controller.models[0] != "deepseek/deepseek-chat" {
		t.Fatalf("models = %#v", controller.models)
	}
	if len(controller.policies) != 1 || controller.policies[0] != "conversation-1=ask" {
		t.Fatalf("policies = %#v", controller.policies)
	}
	if len(controller.created) != 1 || controller.created[0] != "手机新建@/tmp/ws" {
		t.Fatalf("created = %#v", controller.created)
	}

	actions := make([]string, 0, 16)
	for _, entry := range manager.Audit(30) {
		actions = append(actions, entry.Action)
	}
	for _, want := range []string{"queue-withdraw", "queue-clear", "model", "policy", "conversation"} {
		if !slices.Contains(actions, want) {
			t.Fatalf("audit is missing %s: %#v", want, actions)
		}
	}
}

// 只读设备对新增的写动作同样要被拒，不能碰控制器。
func TestNoiseChannelRefusesTheRemainingWritesWhenReadOnly(t *testing.T) {
	manager, status, controller := startManager(t)
	code, _ := manager.IssuePairingCode()
	client := dialNoise(t, status)
	if reply := client.exchange(t, noiseEnvelope{Type: "enrol", Code: code}); !reply.OK {
		t.Fatalf("enrol refused: %s", reply.Error)
	}

	for _, step := range []struct {
		method string
		params string
	}{
		{"queue.withdraw", `{"conversation_id":"conversation-1","queue":"steering","index":0}`},
		{"queue.clear", `{"conversation_id":"conversation-1"}`},
		{"model", `{"provider":"deepseek","model":"deepseek-chat"}`},
		{"policy", `{"conversation_id":"conversation-1","policy":"ask"}`},
		{"conversation.create", `{"title":"手机新建"}`},
	} {
		reply := client.exchange(t, noiseEnvelope{Type: "request", Method: step.method, Params: json.RawMessage(step.params)})
		if reply.OK {
			t.Fatalf("%s must be refused for a read-only device", step.method)
		}
	}
	if len(controller.withdrawn)+len(controller.cleared)+len(controller.models)+len(controller.policies)+len(controller.created) != 0 {
		t.Fatal("a read-only device reached the controller")
	}
}

func TestMatchesFingerprintRejectsAnotherHost(t *testing.T) {
	_, hostPublic, err := generateHostKey()
	if err != nil {
		t.Fatalf("generate host key: %v", err)
	}
	trusted := hostFingerprint(hostPublic)

	if !MatchesFingerprint(hostPublic, trusted) {
		t.Fatal("the pinned host must match")
	}
	if !MatchesFingerprint(hostPublic, strings.ToUpper(trusted)) {
		t.Fatal("fingerprint comparison should ignore case")
	}
	if MatchesFingerprint(hostPublic, "") {
		t.Fatal("an empty pin must never match")
	}
	if MatchesFingerprint(hostPublic, strings.Repeat("0", len(trusted))) {
		t.Fatal("a different fingerprint must not match")
	}
}
