package remotecontrol

import (
	"crypto/rand"
	"encoding/json"
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
