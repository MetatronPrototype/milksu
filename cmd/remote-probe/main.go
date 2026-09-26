// Command remote-probe talks to the companion server over the encrypted channel, so the
// Noise handshake and framing can be verified before any native client exists.
//
// It is a probe, not a product surface: it enrols with a pairing code, then asks for one
// projection and prints a short summary.
//
// Usage:
//
//	remote-probe -url 'http://192.168.1.7:58993/?pair=ABCDEFGHJK&h=1a2b3c4d5e6f7788'
//
// The URL is exactly what the pairing QR carries, so scanning the QR and running this with
// the same string exercises the same path a phone would take.
package main

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"log"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/flynn/noise"
	"github.com/gorilla/websocket"

	"github.com/MilkSU-Official/milksu/internal/remotecontrol"
)

var probeSuite = noise.NewCipherSuite(noise.DH25519, noise.CipherChaChaPoly, noise.HashBLAKE2s)

var probePrologue = []byte("milksu-remote-v1")

type envelope struct {
	Type     string          `json:"type"`
	Code     string          `json:"code,omitempty"`
	ClientID string          `json:"client_id,omitempty"`
	Name     string          `json:"name,omitempty"`
	Method   string          `json:"method,omitempty"`
	OK       bool            `json:"ok"`
	Error    string          `json:"error,omitempty"`
	Data     json.RawMessage `json:"data,omitempty"`
	Device   *struct {
		ID         string `json:"id"`
		Name       string `json:"name"`
		Capability string `json:"capability"`
		State      string `json:"state"`
	} `json:"device,omitempty"`
}

func main() {
	rawURL := flag.String("url", "", "配对二维码里的那个网址（含 ?pair= 与 &h=）")
	code := flag.String("code", "", "绑定码；不给就从 -url 里读")
	fingerprint := flag.String("fingerprint", "", "期望的主机指纹；不给就从 -url 里读")
	method := flag.String("method", "snapshot", "握手后要调的方法")
	name := flag.String("name", "remote-probe", "报给主机的设备名")
	timeout := flag.Duration("timeout", 20*time.Second, "整体超时")
	flag.Parse()

	if strings.TrimSpace(*rawURL) == "" {
		fmt.Fprintln(os.Stderr, "需要 -url，例如：")
		fmt.Fprintln(os.Stderr, "  remote-probe -url 'http://192.168.1.7:58993/?pair=ABCDEFGHJK&h=1a2b3c4d5e6f7788'")
		os.Exit(2)
	}

	parsed, err := url.Parse(*rawURL)
	if err != nil {
		log.Fatalf("网址解析失败：%v", err)
	}
	query := parsed.Query()
	if strings.TrimSpace(*code) == "" {
		*code = strings.TrimSpace(query.Get("pair"))
	}
	if strings.TrimSpace(*fingerprint) == "" {
		*fingerprint = strings.TrimSpace(strings.ToLower(query.Get("h")))
	}
	if *code == "" {
		log.Fatal("没有绑定码：请传 -code，或让 -url 里带 ?pair=")
	}

	socketURL := "ws://" + parsed.Host + "/api/noise"
	fmt.Printf("连接 %s\n", socketURL)
	if *fingerprint == "" {
		fmt.Println("警告：没有给主机指纹，跳过钉住检查。正式客户端必须给。")
	} else {
		fmt.Printf("钉住主机指纹 %s\n", *fingerprint)
	}

	dialer := websocket.Dialer{HandshakeTimeout: *timeout}
	connection, response, err := dialer.Dial(socketURL, nil)
	if err != nil {
		if response != nil {
			log.Fatalf("连接失败：%v（HTTP %d）", err, response.StatusCode)
		}
		log.Fatalf("连接失败：%v", err)
	}
	defer connection.Close()
	_ = connection.SetReadDeadline(time.Now().Add(*timeout))
	connection.SetReadLimit(8 << 20)

	keypair, err := probeSuite.GenerateKeypair(rand.Reader)
	if err != nil {
		log.Fatalf("生成客户端密钥失败：%v", err)
	}
	handshake, err := noise.NewHandshakeState(noise.Config{
		CipherSuite:   probeSuite,
		Pattern:       noise.HandshakeXX,
		Initiator:     true,
		Prologue:      probePrologue,
		StaticKeypair: keypair,
	})
	if err != nil {
		log.Fatalf("初始化握手失败：%v", err)
	}

	// XX：写第一包 → 读第二包 → 写第三包。第二包里带着主机的静态公钥，
	// 所以在交出我们自己的公钥之前就能先核对指纹。
	first, _, _, err := handshake.WriteMessage(nil, nil)
	if err != nil {
		log.Fatalf("握手第一包失败：%v", err)
	}
	if err := connection.WriteMessage(websocket.BinaryMessage, first); err != nil {
		log.Fatalf("发送握手第一包失败：%v", err)
	}
	messageType, second, err := connection.ReadMessage()
	if err != nil {
		log.Fatalf("读取握手第二包失败：%v", err)
	}
	if messageType != websocket.BinaryMessage {
		log.Fatal("握手第二包不是二进制")
	}
	if _, _, _, err := handshake.ReadMessage(nil, second); err != nil {
		log.Fatalf("解析握手第二包失败：%v", err)
	}

	hostKey := handshake.PeerStatic()
	if len(hostKey) != 32 {
		log.Fatal("主机没有交出静态公钥")
	}
	actual := fingerprintOf(hostKey)
	if *fingerprint != "" && !remotecontrol.MatchesFingerprint(hostKey, *fingerprint) {
		log.Fatalf("主机指纹不匹配：期望 %s，实际 %s —— 停下来，不要继续", *fingerprint, actual)
	}
	fmt.Printf("主机指纹核对通过 %s\n", actual)

	third, send, receive, err := handshake.WriteMessage(nil, nil)
	if err != nil {
		log.Fatalf("握手第三包失败：%v", err)
	}
	if err := connection.WriteMessage(websocket.BinaryMessage, third); err != nil {
		log.Fatalf("发送握手第三包失败：%v", err)
	}

	fmt.Println("握手完成，之后的字节都是密文。")

	if err := sendEnvelope(connection, send, envelope{
		Type: "enrol", Code: *code, ClientID: "remote-probe", Name: *name,
	}); err != nil {
		log.Fatalf("发送配对请求失败：%v", err)
	}
	reply, err := readEnvelope(connection, receive)
	if err != nil {
		log.Fatalf("读取配对结果失败：%v", err)
	}
	if !reply.OK {
		log.Fatalf("配对被拒绝：%s", reply.Error)
	}
	if reply.Device != nil {
		fmt.Printf("配对成功：设备 %s，权限 %s，状态 %s\n",
			reply.Device.ID, reply.Device.Capability, reply.Device.State)
	} else {
		fmt.Println("配对成功")
	}

	if err := sendEnvelope(connection, send, envelope{Type: "request", Method: *method}); err != nil {
		log.Fatalf("发送请求失败：%v", err)
	}
	reply, err = readEnvelope(connection, receive)
	if err != nil {
		log.Fatalf("读取响应失败：%v", err)
	}
	if !reply.OK {
		log.Fatalf("请求被拒绝：%s", reply.Error)
	}
	summarise(*method, reply.Data)
}

// fingerprintOf matches the host side: SHA-256 of the static public key, first 8 bytes.
func fingerprintOf(public []byte) string {
	sum := sha256.Sum256(public)
	return hex.EncodeToString(sum[:8])
}

func sendEnvelope(connection *websocket.Conn, send *noise.CipherState, message envelope) error {
	plaintext, err := json.Marshal(message)
	if err != nil {
		return err
	}
	sealed, err := send.Encrypt(nil, nil, plaintext)
	if err != nil {
		return err
	}
	return connection.WriteMessage(websocket.BinaryMessage, sealed)
}

func readEnvelope(connection *websocket.Conn, receive *noise.CipherState) (envelope, error) {
	messageType, frame, err := connection.ReadMessage()
	if err != nil {
		return envelope{}, err
	}
	if messageType != websocket.BinaryMessage {
		return envelope{}, errors.New("帧不是二进制")
	}
	plaintext, err := receive.Decrypt(nil, nil, frame)
	if err != nil {
		return envelope{}, err
	}
	var message envelope
	if err := json.Unmarshal(plaintext, &message); err != nil {
		return envelope{}, err
	}
	return message, nil
}

// summarise prints a short, checkable projection rather than the whole payload.
func summarise(method string, data json.RawMessage) {
	if method != "snapshot" {
		fmt.Printf("%s 返回 %d 字节\n", method, len(data))
		return
	}
	var snapshot struct {
		GeneratedAt string `json:"generated_at"`
		Context     struct {
			ActiveProvider   string `json:"active_provider"`
			ActiveModel      string `json:"active_model"`
			PendingApprovals int    `json:"pending_approvals"`
		} `json:"context"`
		Conversations []struct {
			Title string `json:"title"`
		} `json:"conversations"`
	}
	if err := json.Unmarshal(data, &snapshot); err != nil {
		fmt.Printf("快照解析失败：%v\n", err)
		return
	}
	fmt.Printf("快照：%d 条会话，模型 %s / %s，待审批 %d，生成于 %s\n",
		len(snapshot.Conversations), snapshot.Context.ActiveProvider, snapshot.Context.ActiveModel,
		snapshot.Context.PendingApprovals, snapshot.GeneratedAt)
	for index, conversation := range snapshot.Conversations {
		if index >= 5 {
			fmt.Printf("  …还有 %d 条\n", len(snapshot.Conversations)-index)
			break
		}
		fmt.Printf("  - %s\n", conversation.Title)
	}
}
