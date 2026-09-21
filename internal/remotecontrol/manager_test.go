package remotecontrol

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"
)

type stubProvider struct{ snapshot Snapshot }

func (provider stubProvider) RemoteControlSnapshot(context.Context, Device) (Snapshot, error) {
	return provider.snapshot, nil
}

func (provider stubProvider) RemoteConversation(_ context.Context, conversationID string) (Conversation, error) {
	if conversationID != "conversation-1" {
		return Conversation{}, errors.New("找不到对话")
	}
	return Conversation{
		ID: "conversation-1", Title: "示例对话", ApprovalPolicy: "ask",
		Messages: []Message{{Role: "你", Text: "你好", At: "2026-09-13 03:00"}},
	}, nil
}

type stubController struct {
	mu             sync.Mutex
	sent           []string
	approvals      []string
	models         []string
	policies       []string
	created        []string
	withdrawn      []string
	withdrawnIndex []int
	cleared        []string
	fail           error
}

func (controller *stubController) RemoteApproveTool(_ context.Context, conversationID, requestID string, approved bool, scope, choice string) error {
	controller.mu.Lock()
	defer controller.mu.Unlock()
	if controller.fail != nil {
		return controller.fail
	}
	verdict := "deny"
	if approved {
		verdict = "approve"
	}
	record := verdict + ":" + conversationID + ":" + requestID
	if scope != "" {
		record += ":" + scope
	}
	if choice != "" {
		record += ":" + choice
	}
	controller.approvals = append(controller.approvals, record)
	return nil
}

func (controller *stubController) RemoteSendMessage(_ context.Context, conversationID, prompt, mode string) error {
	controller.mu.Lock()
	defer controller.mu.Unlock()
	if controller.fail != nil {
		return controller.fail
	}
	record := conversationID + ":" + prompt
	if mode != "" {
		record += ":" + mode
	}
	controller.sent = append(controller.sent, record)
	return nil
}

func (controller *stubController) RemoteWithdrawQueued(_ context.Context, conversationID, queue string, index int, expected string) error {
	controller.mu.Lock()
	defer controller.mu.Unlock()
	if controller.fail != nil {
		return controller.fail
	}
	controller.withdrawn = append(controller.withdrawn, conversationID+":"+queue+":"+expected)
	controller.withdrawnIndex = append(controller.withdrawnIndex, index)
	return nil
}

func (controller *stubController) RemoteClearQueued(_ context.Context, conversationID string) error {
	controller.mu.Lock()
	defer controller.mu.Unlock()
	if controller.fail != nil {
		return controller.fail
	}
	controller.cleared = append(controller.cleared, conversationID)
	return nil
}

func (controller *stubController) RemoteSelectModel(_ context.Context, provider, model string) error {
	controller.mu.Lock()
	defer controller.mu.Unlock()
	if controller.fail != nil {
		return controller.fail
	}
	controller.models = append(controller.models, provider+"/"+model)
	return nil
}

func (controller *stubController) RemoteSelectApprovalPolicy(_ context.Context, conversationID, policy string) error {
	controller.mu.Lock()
	defer controller.mu.Unlock()
	if controller.fail != nil {
		return controller.fail
	}
	controller.policies = append(controller.policies, conversationID+"="+policy)
	return nil
}

func (controller *stubController) RemoteCreateConversation(_ context.Context, title, workspace string) (string, error) {
	controller.mu.Lock()
	defer controller.mu.Unlock()
	if controller.fail != nil {
		return "", controller.fail
	}
	controller.created = append(controller.created, title+"@"+workspace)
	return "conversation-new", nil
}

func startManager(t *testing.T) (*Manager, Status, *stubController) {
	t.Helper()
	controller := &stubController{}
	manager := New(t.TempDir(), stubProvider{}, controller)
	status := manager.Apply(Settings{Enabled: true, BindMode: BindModeLocal})
	if !status.Running || status.URL == "" {
		t.Fatalf("manager did not start: %#v", status)
	}
	t.Cleanup(func() { _ = manager.Close() })
	return manager, status, controller
}

func post(t *testing.T, url, payload string, cookie *http.Cookie, withHeader bool) *http.Response {
	t.Helper()
	request, err := http.NewRequest(http.MethodPost, url, strings.NewReader(payload))
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set("Content-Type", "application/json")
	if withHeader {
		request.Header.Set(actionHeader, "1")
	}
	if cookie != nil {
		request.AddCookie(cookie)
	}
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatalf("POST %s failed: %v", url, err)
	}
	return response
}

func getState(t *testing.T, status Status, cookie *http.Cookie) *http.Response {
	t.Helper()
	request, err := http.NewRequest(http.MethodGet, status.URL+"api/state", nil)
	if err != nil {
		t.Fatal(err)
	}
	if cookie != nil {
		request.AddCookie(cookie)
	}
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatalf("GET state failed: %v", err)
	}
	return response
}

// pair enrols a device with a fresh pairing code and returns its cookie.
func pair(t *testing.T, manager *Manager, status Status) *http.Cookie {
	t.Helper()
	code, _ := manager.IssuePairingCode()
	response := post(t, status.URL+"api/pair", `{"code":"`+code+`"}`, nil, false)
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		t.Fatalf("pair = %d, want 200", response.StatusCode)
	}
	for _, cookie := range response.Cookies() {
		if cookie.Name == sessionCookie {
			return cookie
		}
	}
	t.Fatal("pairing did not set a session cookie")
	return nil
}

// A paired device is read-only until the host promotes it.
func TestPairedDeviceStartsReadOnlyAndNeedsTheHostToAct(t *testing.T) {
	manager, status, controller := startManager(t)
	cookie := pair(t, manager, status)

	devices := manager.Status().Devices
	if len(devices) != 1 || devices[0].Capability != CapabilityView || devices[0].CanControl {
		t.Fatalf("paired device = %#v, want a read-only device", devices)
	}

	denied := post(t, status.URL+"api/action/model", `{"provider":"p","model":"m"}`, cookie, true)
	defer denied.Body.Close()
	if denied.StatusCode != http.StatusForbidden {
		t.Fatalf("read-only device action = %d, want 403", denied.StatusCode)
	}
	if len(controller.models) != 0 {
		t.Fatal("a read-only device must not reach the controller")
	}
	if audit := manager.Audit(0); len(audit) == 0 || audit[len(audit)-1].OK {
		t.Fatalf("a denied action must be audited: %#v", audit)
	}

	if err := manager.SetDeviceCapability(devices[0].ID, CapabilityControl); err != nil {
		t.Fatalf("promote failed: %v", err)
	}
	allowed := post(t, status.URL+"api/action/model", `{"provider":"p","model":"m"}`, cookie, true)
	defer allowed.Body.Close()
	if allowed.StatusCode != http.StatusOK {
		t.Fatalf("control-capable action = %d, want 200", allowed.StatusCode)
	}
	if len(controller.models) != 1 || controller.models[0] != "p/m" {
		t.Fatalf("controller models = %#v", controller.models)
	}
}

// Writes need the custom header, which a cross-site page cannot send.
func TestWritesRequireTheActionHeader(t *testing.T) {
	manager, status, controller := startManager(t)
	cookie := pair(t, manager, status)
	device := manager.Status().Devices[0]
	if err := manager.SetDeviceCapability(device.ID, CapabilityControl); err != nil {
		t.Fatal(err)
	}

	response := post(t, status.URL+"api/action/model", `{"provider":"p","model":"m"}`, cookie, false)
	defer response.Body.Close()
	if response.StatusCode != http.StatusForbidden {
		t.Fatalf("action without the header = %d, want 403", response.StatusCode)
	}
	if len(controller.models) != 0 {
		t.Fatal("a request without the action header must not reach the controller")
	}
}

// Without a pairing code nothing gets in, and a code works exactly once.
func TestPairingCodeIsSingleUseAndExpires(t *testing.T) {
	manager, status, _ := startManager(t)

	anonymous := getState(t, status, nil)
	defer anonymous.Body.Close()
	if anonymous.StatusCode != http.StatusUnauthorized {
		t.Fatalf("anonymous state = %d, want 401", anonymous.StatusCode)
	}
	wrong := post(t, status.URL+"api/pair", `{"code":"NOPE1234"}`, nil, false)
	defer wrong.Body.Close()
	if wrong.StatusCode != http.StatusUnauthorized {
		t.Fatalf("wrong pairing code = %d, want 401", wrong.StatusCode)
	}

	code, _ := manager.IssuePairingCode()
	first := post(t, status.URL+"api/pair", `{"code":"`+code+`"}`, nil, false)
	defer first.Body.Close()
	if first.StatusCode != http.StatusOK {
		t.Fatalf("pairing = %d, want 200", first.StatusCode)
	}
	reused := post(t, status.URL+"api/pair", `{"code":"`+code+`"}`, nil, false)
	defer reused.Body.Close()
	if reused.StatusCode != http.StatusUnauthorized {
		t.Fatalf("reused pairing code = %d, want 401", reused.StatusCode)
	}

	expiredCode, _ := manager.IssuePairingCode()
	manager.mu.Lock()
	manager.pairingAt = time.Now().Add(-pairingTTL - time.Minute)
	manager.mu.Unlock()
	expired := post(t, status.URL+"api/pair", `{"code":"`+expiredCode+`"}`, nil, false)
	defer expired.Body.Close()
	if expired.StatusCode != http.StatusUnauthorized {
		t.Fatalf("expired pairing code = %d, want 401", expired.StatusCode)
	}
}

// The host password is accepted on a local-only listener and refused on the LAN.
func TestHostPasswordIsLocalOnly(t *testing.T) {
	manager, status, _ := startManager(t)
	login := post(t, status.URL+"api/login", `{"password":"`+status.Password+`"}`, nil, false)
	defer login.Body.Close()
	if login.StatusCode != http.StatusOK {
		t.Fatalf("local password login = %d, want 200", login.StatusCode)
	}
	if devices := manager.Status().Devices; len(devices) != 1 || devices[0].Capability != CapabilityControl {
		t.Fatalf("local login must grant control: %#v", devices)
	}

	manager.mu.Lock()
	manager.bindMode = BindModeLAN
	manager.mu.Unlock()
	refused := post(t, status.URL+"api/login", `{"password":"`+status.Password+`"}`, nil, false)
	defer refused.Body.Close()
	if refused.StatusCode != http.StatusForbidden {
		t.Fatalf("LAN password login = %d, want 403", refused.StatusCode)
	}
}

// An expired authorisation keeps read access but loses the ability to act, and the host
// can restore it.
func TestExpiredDeviceIsDowngradedUntilRenewed(t *testing.T) {
	manager, status, controller := startManager(t)
	cookie := pair(t, manager, status)
	device := manager.Status().Devices[0]
	if err := manager.SetDeviceCapability(device.ID, CapabilityControl); err != nil {
		t.Fatal(err)
	}

	manager.mu.Lock()
	manager.devices[0].ExpiresAt = time.Now().Add(-time.Hour).UTC().Format(time.RFC3339)
	manager.mu.Unlock()

	read := getState(t, status, cookie)
	defer read.Body.Close()
	if read.StatusCode != http.StatusOK {
		t.Fatalf("expired device read = %d, want 200 (read-only, not locked out)", read.StatusCode)
	}
	action := post(t, status.URL+"api/action/model", `{"provider":"p","model":"m"}`, cookie, true)
	defer action.Body.Close()
	if action.StatusCode != http.StatusForbidden {
		t.Fatalf("expired device action = %d, want 403", action.StatusCode)
	}
	if len(controller.models) != 0 {
		t.Fatal("an expired device must not reach the controller")
	}
	if updated := manager.Status().Devices[0]; updated.State != StateExpired || updated.CanControl {
		t.Fatalf("device after expiry = %#v", updated)
	}

	if _, err := manager.RenewDevice(device.ID); err != nil {
		t.Fatalf("renew failed: %v", err)
	}
	restored := post(t, status.URL+"api/action/model", `{"provider":"p","model":"m"}`, cookie, true)
	defer restored.Body.Close()
	if restored.StatusCode != http.StatusOK {
		t.Fatalf("action after renew = %d, want 200", restored.StatusCode)
	}
}

// A device remembers the networks the host approved: the same network keeps working, a new
// one has to be verified, and coming back to an approved network works again.
func TestNetworksAreRememberedAndANewOneNeedsVerification(t *testing.T) {
	manager, _, _ := startManager(t)
	handler := manager.routes()

	serve := func(method, target, body string, cookie *http.Cookie, ip string) *httptest.ResponseRecorder {
		var reader io.Reader
		if body != "" {
			reader = strings.NewReader(body)
		}
		request := httptest.NewRequest(method, target, reader)
		request.RemoteAddr = ip
		if cookie != nil {
			request.AddCookie(cookie)
		}
		if method == http.MethodPost {
			request.Header.Set(actionHeader, "1")
		}
		recorder := httptest.NewRecorder()
		handler.ServeHTTP(recorder, request)
		return recorder
	}

	code, _ := manager.IssuePairingCode()
	pairRecorder := serve(http.MethodPost, "/api/pair", `{"code":"`+code+`"}`, nil, "192.168.233.10:51000")
	if pairRecorder.Code != http.StatusOK {
		t.Fatalf("pair = %d, want 200", pairRecorder.Code)
	}
	var cookie *http.Cookie
	for _, candidate := range pairRecorder.Result().Cookies() {
		if candidate.Name == sessionCookie {
			cookie = candidate
		}
	}
	device := manager.Status().Devices[0]
	if len(device.Networks) != 1 || device.Networks[0] != "192.168.233.0/24" {
		t.Fatalf("approved networks = %#v", device.Networks)
	}
	if err := manager.SetDeviceCapability(device.ID, CapabilityControl); err != nil {
		t.Fatal(err)
	}

	// Same network, new DHCP address: still fine.
	if code := serve(http.MethodGet, "/api/state", "", cookie, "192.168.233.99:51000").Code; code != http.StatusOK {
		t.Fatalf("read from the approved network = %d, want 200", code)
	}

	// Another network: blocked, and remembered as pending verification.
	moved := serve(http.MethodGet, "/api/state", "", cookie, "10.9.9.9:51000")
	if moved.Code != http.StatusUnauthorized {
		t.Fatalf("read from a new network = %d, want 401", moved.Code)
	}
	if reason := moved.Header().Get("X-MilkSU-Remote-Reason"); reason != reasonNetworkUnverified {
		t.Fatalf("rejection reason = %q", reason)
	}
	blocked := manager.Status().Devices[0]
	if blocked.PendingSubnet != "10.9.9.0/24" || blocked.State != StateNetworkChanged {
		t.Fatalf("device after moving = %#v", blocked)
	}
	if recorder := serve(http.MethodPost, "/api/action/model", `{"provider":"p","model":"m"}`, cookie, "10.9.9.9:51000"); recorder.Code != http.StatusUnauthorized {
		t.Fatalf("action from a new network = %d, want 401", recorder.Code)
	}

	// The host verifies the new network: the device works again there.
	if _, err := manager.ApproveDeviceNetwork(device.ID); err != nil {
		t.Fatalf("approve network failed: %v", err)
	}
	if code := serve(http.MethodGet, "/api/state", "", cookie, "10.9.9.9:51000").Code; code != http.StatusOK {
		t.Fatalf("read after verification = %d, want 200", code)
	}
	if code := serve(http.MethodPost, "/api/action/model", `{"provider":"p","model":"m"}`, cookie, "10.9.9.9:51000").Code; code != http.StatusOK {
		t.Fatalf("action after verification = %d, want 200", code)
	}

	// Back home: the original network was remembered.
	if code := serve(http.MethodGet, "/api/state", "", cookie, "192.168.233.5:51000").Code; code != http.StatusOK {
		t.Fatalf("read after returning home = %d, want 200", code)
	}
	if networks := manager.Status().Devices[0].Networks; len(networks) != 2 {
		t.Fatalf("remembered networks = %#v, want both", networks)
	}

	// A third network is unknown again.
	if code := serve(http.MethodGet, "/api/state", "", cookie, "172.16.5.5:51000").Code; code != http.StatusUnauthorized {
		t.Fatalf("read from a third network = %d, want 401", code)
	}

	// The host may forget a network, which forces verification next time.
	if _, err := manager.ForgetDeviceNetwork(device.ID, "10.9.9.0/24"); err != nil {
		t.Fatalf("forget network failed: %v", err)
	}
	if code := serve(http.MethodGet, "/api/state", "", cookie, "10.9.9.9:51000").Code; code != http.StatusUnauthorized {
		t.Fatalf("read from a forgotten network = %d, want 401", code)
	}
}

func TestRevokedDeviceLosesAccessImmediately(t *testing.T) {
	manager, status, _ := startManager(t)
	cookie := pair(t, manager, status)

	if err := manager.RevokeDevice(manager.Status().Devices[0].ID); err != nil {
		t.Fatalf("revoke failed: %v", err)
	}
	response := getState(t, status, cookie)
	defer response.Body.Close()
	if response.StatusCode != http.StatusUnauthorized {
		t.Fatalf("revoked device state = %d, want 401", response.StatusCode)
	}
	if len(manager.Status().Devices) != 0 {
		t.Fatal("the device must be gone from the list")
	}
	if err := manager.RevokeDevice("missing"); err == nil {
		t.Fatal("revoking an unknown device must fail")
	}
}

// A new host password also unpairs every device, because the old password protected them.
func TestRotatePasswordUnpairsEveryDevice(t *testing.T) {
	manager, status, _ := startManager(t)
	cookie := pair(t, manager, status)

	rotated := manager.RotatePassword()
	if rotated == "" || rotated == status.Password {
		t.Fatalf("rotated password = %q", rotated)
	}
	if len(manager.Status().Devices) != 0 {
		t.Fatal("rotation must unpair every device")
	}
	stale := getState(t, status, cookie)
	defer stale.Body.Close()
	if stale.StatusCode != http.StatusUnauthorized {
		t.Fatalf("stale cookie = %d, want 401", stale.StatusCode)
	}
}

func TestDisabledManagerStopsListening(t *testing.T) {
	manager, status, _ := startManager(t)
	disabled := manager.Apply(Settings{Enabled: false})
	if disabled.Running {
		t.Fatalf("status after disabling = %#v", disabled)
	}
	if _, err := http.Get(status.URL + "healthz"); err == nil {
		t.Fatal("the listener must be closed once remote control is off")
	}
}

// Controller failures must be reported and audited, never reported as success.
func TestControllerFailureIsAudited(t *testing.T) {
	manager, status, controller := startManager(t)
	cookie := pair(t, manager, status)
	if err := manager.SetDeviceCapability(manager.Status().Devices[0].ID, CapabilityControl); err != nil {
		t.Fatal(err)
	}
	controller.fail = errors.New("主机拒绝了这次操作")

	response := post(t, status.URL+"api/action/approve", `{"conversation_id":"c","request_id":"r","approved":true}`, cookie, true)
	defer response.Body.Close()
	if response.StatusCode != http.StatusBadRequest {
		t.Fatalf("failing action = %d, want 400", response.StatusCode)
	}
	audit := manager.Audit(1)
	if len(audit) != 1 || audit[0].OK || audit[0].Error == "" {
		t.Fatalf("audit = %#v, want a failed entry with a reason", audit)
	}
}

func TestPageIsSelfContained(t *testing.T) {
	_, status, _ := startManager(t)
	response, err := http.Get(status.URL)
	if err != nil {
		t.Fatalf("GET / failed: %v", err)
	}
	defer response.Body.Close()
	body, _ := io.ReadAll(response.Body)
	page := string(body)
	if !strings.Contains(page, "远端视图") {
		t.Fatal("the page must identify itself")
	}
	if strings.Contains(page, `src="http`) || strings.Contains(page, `href="http`) {
		t.Fatal("the page must not load external assets")
	}
}

// Sending a prompt is an action like any other: a read-only device cannot do it.
func TestSendRequiresControlCapability(t *testing.T) {
	manager, _, controller := startManager(t)
	handler := manager.routes()

	code, _ := manager.IssuePairingCode()
	pairRequest := httptest.NewRequest(http.MethodPost, "/api/pair", strings.NewReader(`{"code":"`+code+`"}`))
	pairRequest.RemoteAddr = "192.168.233.10:51000"
	pairRecorder := httptest.NewRecorder()
	handler.ServeHTTP(pairRecorder, pairRequest)
	var cookie *http.Cookie
	for _, candidate := range pairRecorder.Result().Cookies() {
		if candidate.Name == sessionCookie {
			cookie = candidate
		}
	}

	send := func() *httptest.ResponseRecorder {
		request := httptest.NewRequest(http.MethodPost, "/api/action/send", strings.NewReader(`{"conversation_id":"conversation-1","prompt":"跑一下测试"}`))
		request.RemoteAddr = "192.168.233.10:51000"
		request.AddCookie(cookie)
		request.Header.Set(actionHeader, "1")
		recorder := httptest.NewRecorder()
		handler.ServeHTTP(recorder, request)
		return recorder
	}

	if code := send().Code; code != http.StatusForbidden {
		t.Fatalf("read-only send = %d, want 403", code)
	}
	if len(controller.sent) != 0 {
		t.Fatal("a read-only device must not reach the controller")
	}

	device := manager.Status().Devices[0]
	if err := manager.SetDeviceCapability(device.ID, CapabilityControl); err != nil {
		t.Fatal(err)
	}
	if code := send().Code; code != http.StatusOK {
		t.Fatalf("control send = %d, want 200", code)
	}
	if len(controller.sent) != 1 || controller.sent[0] != "conversation-1:跑一下测试" {
		t.Fatalf("controller sent = %#v", controller.sent)
	}

	// An empty prompt is refused.
	empty := httptest.NewRequest(http.MethodPost, "/api/action/send", strings.NewReader(`{"conversation_id":"conversation-1","prompt":"   "}`))
	empty.RemoteAddr = "192.168.233.10:51000"
	empty.AddCookie(cookie)
	empty.Header.Set(actionHeader, "1")
	emptyRecorder := httptest.NewRecorder()
	handler.ServeHTTP(emptyRecorder, empty)
	if emptyRecorder.Code != http.StatusBadRequest {
		t.Fatalf("empty prompt = %d, want 400", emptyRecorder.Code)
	}
}

// The chat view needs the conversation endpoint behind the same authorisation.
func TestConversationEndpointNeedsAuthorisation(t *testing.T) {
	manager, _, _ := startManager(t)
	handler := manager.routes()

	anonymous := httptest.NewRequest(http.MethodGet, "/api/conversation?id=conversation-1", nil)
	anonymousRecorder := httptest.NewRecorder()
	handler.ServeHTTP(anonymousRecorder, anonymous)
	if anonymousRecorder.Code != http.StatusUnauthorized {
		t.Fatalf("anonymous conversation = %d, want 401", anonymousRecorder.Code)
	}

	code, _ := manager.IssuePairingCode()
	pairRequest := httptest.NewRequest(http.MethodPost, "/api/pair", strings.NewReader(`{"code":"`+code+`"}`))
	pairRequest.RemoteAddr = "192.168.233.10:51000"
	pairRecorder := httptest.NewRecorder()
	handler.ServeHTTP(pairRecorder, pairRequest)
	var cookie *http.Cookie
	for _, candidate := range pairRecorder.Result().Cookies() {
		if candidate.Name == sessionCookie {
			cookie = candidate
		}
	}
	allowed := httptest.NewRequest(http.MethodGet, "/api/conversation?id=conversation-1", nil)
	allowed.RemoteAddr = "192.168.233.10:51000"
	allowed.AddCookie(cookie)
	allowedRecorder := httptest.NewRecorder()
	handler.ServeHTTP(allowedRecorder, allowed)
	if allowedRecorder.Code != http.StatusOK {
		t.Fatalf("paired conversation = %d, want 200", allowedRecorder.Code)
	}
	if body := allowedRecorder.Body.String(); !strings.Contains(body, "示例对话") {
		t.Fatalf("conversation body = %s", body)
	}
}

// A phone that was paired once must stay paired: the cookie lives as long as the device
// record, so closing the browser does not force the user to type a new pairing code.
func TestPairingCookieOutlivesTheBrowserSession(t *testing.T) {
	manager, status, _ := startManager(t)
	cookie := pair(t, manager, status)

	if cookie.MaxAge <= 0 {
		t.Fatalf("pairing cookie MaxAge = %d, want a persistent cookie", cookie.MaxAge)
	}
	if cookie.Expires.IsZero() || time.Until(cookie.Expires) < 6*24*time.Hour {
		t.Fatalf("pairing cookie expires at %v, want roughly the session TTL", cookie.Expires)
	}
	if !cookie.HttpOnly {
		t.Fatal("pairing cookie must stay HttpOnly")
	}
}

// Enrolling the same device again (a lost cookie, a fresh pairing code) updates the existing
// row instead of adding another device, and the host's decision about it stays.
func TestEnrollingAgainReusesTheDeviceAndKeepsItsPermission(t *testing.T) {
	manager, status, _ := startManager(t)

	enrol := func(clientID string) *http.Response {
		t.Helper()
		code, _ := manager.IssuePairingCode()
		body := `{"code":"` + code + `"}`
		if clientID != "" {
			body = `{"code":"` + code + `","client_id":"` + clientID + `"}`
		}
		return post(t, status.URL+"api/pair", body, nil, false)
	}

	first := enrol("phone-1")
	first.Body.Close()
	if first.StatusCode != http.StatusOK {
		t.Fatalf("first pair = %d, want 200", first.StatusCode)
	}
	device := manager.Status().Devices[0]
	if err := manager.SetDeviceCapability(device.ID, CapabilityControl); err != nil {
		t.Fatalf("promote failed: %v", err)
	}

	second := enrol("phone-1")
	second.Body.Close()
	if second.StatusCode != http.StatusOK {
		t.Fatalf("second pair = %d, want 200", second.StatusCode)
	}
	devices := manager.Status().Devices
	if len(devices) != 1 {
		t.Fatalf("devices after re-enrolling = %d, want 1: %#v", len(devices), devices)
	}
	if devices[0].ID != device.ID {
		t.Fatalf("device id = %s, want the original %s", devices[0].ID, device.ID)
	}
	if devices[0].Capability != CapabilityControl || !devices[0].CanControl {
		t.Fatalf("re-enrolling dropped the host's permission: %#v", devices[0])
	}

	// A page that cannot keep a client id still reuses the row for the same address and agent.
	third := enrol("")
	third.Body.Close()
	if devices := manager.Status().Devices; len(devices) != 1 {
		t.Fatalf("devices after a client-id-less re-enrol = %d, want 1: %#v", len(devices), devices)
	}
}

// serveVia routes one request through the manager with a chosen address and user agent, so a
// test can pretend the same phone appears on a second network.
func serveVia(manager *Manager, method, target, body, ip, agent string, cookie *http.Cookie) *httptest.ResponseRecorder {
	var reader io.Reader
	if body != "" {
		reader = strings.NewReader(body)
	}
	request := httptest.NewRequest(method, target, reader)
	request.RemoteAddr = ip
	if agent != "" {
		request.Header.Set("User-Agent", agent)
	}
	if cookie != nil {
		request.AddCookie(cookie)
	}
	if method == http.MethodPost {
		request.Header.Set(actionHeader, "1")
	}
	recorder := httptest.NewRecorder()
	manager.routes().ServeHTTP(recorder, request)
	return recorder
}

func cookieFrom(recorder *httptest.ResponseRecorder) *http.Cookie {
	for _, cookie := range recorder.Result().Cookies() {
		if cookie.Name == sessionCookie {
			return cookie
		}
	}
	return nil
}

const iPhoneAgent = "Mozilla/5.0 (iPhone; CPU iPhone OS 27_0_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.0 Mobile/15E148 Safari/604.1"
const androidAgent = "Mozilla/5.0 (Linux; Android 16; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Mobile Safari/537.36"

// A phone that moves to another network enrols again with a new code. It must stay the same
// device, keep its permission, remember both networks, and keep working from either one.
func TestMovingToAnotherNetworkKeepsTheSameDevice(t *testing.T) {
	manager, _, _ := startManager(t)

	firstCode, _ := manager.IssuePairingCode()
	first := serveVia(manager, http.MethodPost, "/api/pair", `{"code":"`+firstCode+`"}`, "192.168.233.10:51000", iPhoneAgent, nil)
	if first.Code != http.StatusOK {
		t.Fatalf("first pair = %d, want 200", first.Code)
	}
	cookieA := cookieFrom(first)
	device := manager.Status().Devices[0]
	if err := manager.SetDeviceCapability(device.ID, CapabilityControl); err != nil {
		t.Fatalf("promote failed: %v", err)
	}

	secondCode, _ := manager.IssuePairingCode()
	second := serveVia(manager, http.MethodPost, "/api/pair", `{"code":"`+secondCode+`"}`, "192.168.0.44:52000", iPhoneAgent, nil)
	if second.Code != http.StatusOK {
		t.Fatalf("second pair = %d, want 200", second.Code)
	}
	cookieB := cookieFrom(second)

	devices := manager.Status().Devices
	if len(devices) != 1 {
		t.Fatalf("devices after moving network = %d, want 1: %#v", len(devices), devices)
	}
	if devices[0].ID != device.ID {
		t.Fatalf("device id = %s, want the original %s", devices[0].ID, device.ID)
	}
	if devices[0].Capability != CapabilityControl || !devices[0].CanControl {
		t.Fatalf("moving network dropped the host's permission: %#v", devices[0])
	}
	for _, subnet := range []string{"192.168.233.0/24", "192.168.0.0/24"} {
		if !hasString(devices[0].Networks, subnet) {
			t.Fatalf("networks = %#v, want both to be remembered", devices[0].Networks)
		}
	}

	// Both networks keep their own credential, so going back does not need another code.
	backOnA := serveVia(manager, http.MethodGet, "/api/state", "", "192.168.233.10:51000", iPhoneAgent, cookieA)
	if backOnA.Code != http.StatusOK {
		t.Fatalf("the first network's cookie = %d, want 200", backOnA.Code)
	}
	onB := serveVia(manager, http.MethodGet, "/api/state", "", "192.168.0.44:52000", iPhoneAgent, cookieB)
	if onB.Code != http.StatusOK {
		t.Fatalf("the new network's cookie = %d, want 200", onB.Code)
	}
}

// Two identical phones must never be guessed into one device: when a fingerprint names more
// than one row, enrolling adds a row instead of merging an unrelated device's permission.
func TestAmbiguousDeviceIsNotMergedAndABoundCodeStillWorks(t *testing.T) {
	manager, _, _ := startManager(t)

	firstCode, _ := manager.IssuePairingCode()
	serveVia(manager, http.MethodPost, "/api/pair", `{"code":"`+firstCode+`"}`, "192.168.233.10:51000", iPhoneAgent, nil)
	original := manager.Status().Devices[0]

	// A second row with the same fingerprint, as a legacy state file could hold.
	manager.mu.Lock()
	duplicate := manager.devices[0]
	duplicate.Device.ID = "legacy-dup"
	duplicate.Device.IP = "192.168.233.99"
	duplicate.TokenHash = hashToken("legacy-token")
	duplicate.Tokens = nil
	manager.devices = append(manager.devices, duplicate)
	manager.mu.Unlock()
	if err := manager.SetDeviceCapability(original.ID, CapabilityControl); err != nil {
		t.Fatalf("promote failed: %v", err)
	}

	// Ambiguous fingerprint: a plain code must not pick one of the two.
	code, _ := manager.IssuePairingCode()
	serveVia(manager, http.MethodPost, "/api/pair", `{"code":"`+code+`"}`, "192.168.0.44:52000", iPhoneAgent, nil)
	if devices := manager.Status().Devices; len(devices) != 3 {
		t.Fatalf("devices after an ambiguous enrol = %d, want 3 (no merging)", len(devices))
	}

	// A code issued for one device is explicit, so it reuses exactly that row.
	boundCode, _ := manager.IssuePairingCodeFor(original.ID)
	bound := serveVia(manager, http.MethodPost, "/api/pair", `{"code":"`+boundCode+`"}`, "192.168.0.44:52000", androidAgent, nil)
	if bound.Code != http.StatusOK {
		t.Fatalf("bound pair = %d, want 200", bound.Code)
	}
	if devices := manager.Status().Devices; len(devices) != 3 {
		t.Fatalf("devices after a bound enrol = %d, want 3", len(devices))
	}
	devices := manager.Status().Devices
	var reused Device
	for _, device := range devices {
		if device.ID == original.ID {
			reused = device
		}
	}
	if reused.ID == "" {
		t.Fatal("the bound code did not reuse the device it was issued for")
	}
	if reused.Capability != CapabilityControl || !reused.CanControl {
		t.Fatalf("a bound code dropped the permission: %#v", reused)
	}
	if !hasString(reused.Networks, "192.168.0.0/24") {
		t.Fatalf("networks = %#v, want the new network remembered", reused.Networks)
	}
	if status := manager.Status(); status.PairingDeviceID != "" {
		t.Fatalf("pairing device id = %q, want it cleared once the code was used", status.PairingDeviceID)
	}
}

// A remote device may answer a prompt with the same two extra bits the desktop card offers:
// allow the tool for this conversation, and pick a choice on an ask card.
func TestApproveCarriesScopeAndChoice(t *testing.T) {
	manager, status, controller := startManager(t)
	cookie := pair(t, manager, status)
	device := manager.Status().Devices[0]
	if err := manager.SetDeviceCapability(device.ID, CapabilityControl); err != nil {
		t.Fatalf("promote failed: %v", err)
	}

	granted := post(t, status.URL+"api/action/approve",
		`{"conversation_id":"conversation-1","request_id":"req-1","approved":true,"scope":"conversation","choice":"other:自己写"}`,
		cookie, true)
	granted.Body.Close()
	if granted.StatusCode != http.StatusOK {
		t.Fatalf("approve with scope = %d, want 200", granted.StatusCode)
	}
	if len(controller.approvals) != 1 || controller.approvals[0] != "approve:conversation-1:req-1:conversation:other:自己写" {
		t.Fatalf("approvals = %#v", controller.approvals)
	}

	denied := post(t, status.URL+"api/action/approve",
		`{"conversation_id":"conversation-1","request_id":"req-2","approved":false}`,
		cookie, true)
	denied.Body.Close()
	if len(controller.approvals) != 2 || controller.approvals[1] != "deny:conversation-1:req-2" {
		t.Fatalf("approvals = %#v", controller.approvals)
	}

	// An unknown scope is refused instead of silently granting something else.
	bad := post(t, status.URL+"api/action/approve",
		`{"conversation_id":"conversation-1","request_id":"req-3","approved":true,"scope":"everything"}`,
		cookie, true)
	bad.Body.Close()
	if bad.StatusCode != http.StatusBadRequest {
		t.Fatalf("unknown scope = %d, want 400", bad.StatusCode)
	}
}

// Sending mirrors the desktop composer: the page may send, park behind the running turn, or
// steer it, and only those three modes are accepted.
func TestSendCarriesTheQueueMode(t *testing.T) {
	manager, status, controller := startManager(t)
	cookie := pair(t, manager, status)
	device := manager.Status().Devices[0]
	if err := manager.SetDeviceCapability(device.ID, CapabilityControl); err != nil {
		t.Fatalf("promote failed: %v", err)
	}

	queued := post(t, status.URL+"api/action/send", `{"conversation_id":"conversation-1","prompt":"排队这条","mode":"queue"}`, cookie, true)
	queued.Body.Close()
	if queued.StatusCode != http.StatusOK {
		t.Fatalf("queue send = %d, want 200", queued.StatusCode)
	}
	steered := post(t, status.URL+"api/action/send", `{"conversation_id":"conversation-1","prompt":"引导这条","mode":"steer"}`, cookie, true)
	steered.Body.Close()
	if steered.StatusCode != http.StatusOK {
		t.Fatalf("steer send = %d, want 200", steered.StatusCode)
	}
	bad := post(t, status.URL+"api/action/send", `{"conversation_id":"conversation-1","prompt":"x","mode":"nope"}`, cookie, true)
	bad.Body.Close()
	if bad.StatusCode != http.StatusBadRequest {
		t.Fatalf("unknown mode = %d, want 400", bad.StatusCode)
	}

	if len(controller.sent) != 2 ||
		controller.sent[0] != "conversation-1:排队这条:queue" ||
		controller.sent[1] != "conversation-1:引导这条:steer" {
		t.Fatalf("sent = %#v", controller.sent)
	}
}

// Withdrawing one parked prompt and clearing the queue both reach the controller, and a queue
// name the host does not know is refused.
func TestQueueActionsReachTheController(t *testing.T) {
	manager, status, controller := startManager(t)
	cookie := pair(t, manager, status)
	device := manager.Status().Devices[0]
	if err := manager.SetDeviceCapability(device.ID, CapabilityControl); err != nil {
		t.Fatalf("promote failed: %v", err)
	}

	withdrawn := post(t, status.URL+"api/action/queue",
		`{"conversation_id":"conversation-1","queue":"followUp","index":1,"expected":"第二条"}`,
		cookie, true)
	withdrawn.Body.Close()
	if withdrawn.StatusCode != http.StatusOK {
		t.Fatalf("withdraw = %d, want 200", withdrawn.StatusCode)
	}
	cleared := post(t, status.URL+"api/action/queue/clear", `{"conversation_id":"conversation-1"}`, cookie, true)
	cleared.Body.Close()
	if cleared.StatusCode != http.StatusOK {
		t.Fatalf("clear = %d, want 200", cleared.StatusCode)
	}

	if len(controller.withdrawn) != 1 || controller.withdrawn[0] != "conversation-1:followUp:第二条" {
		t.Fatalf("withdrawn = %#v", controller.withdrawn)
	}
	if len(controller.withdrawnIndex) != 1 || controller.withdrawnIndex[0] != 1 {
		t.Fatalf("withdrawn index = %#v", controller.withdrawnIndex)
	}
	if len(controller.cleared) != 1 || controller.cleared[0] != "conversation-1" {
		t.Fatalf("cleared = %#v", controller.cleared)
	}
}

// The parity work depends on four hooks living in the page: the ask choices, the
// conversation-scope checkbox, the needs-decision mark and the queue controls. They are easy
// to drop in a later edit, so this pins them.
func TestPageCarriesTheParityControls(t *testing.T) {
	_, status, _ := startManager(t)
	response, err := http.Get(status.URL)
	if err != nil {
		t.Fatalf("GET / failed: %v", err)
	}
	defer response.Body.Close()
	body, _ := io.ReadAll(response.Body)
	page := string(body)
	for _, marker := range []string{
		"data-choice=\"",
		"data-scope=\"",
		"data-withdraw=\"",
		"needs_decision",
		"id=\"queue\"",
		"/api/action/queue/clear",
	} {
		if !strings.Contains(page, marker) {
			t.Fatalf("the page is missing %s", marker)
		}
	}
}
