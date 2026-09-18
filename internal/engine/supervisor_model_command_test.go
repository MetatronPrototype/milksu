package engine

import (
	"bufio"
	"encoding/json"
	"os"
	"strings"
	"testing"

	"github.com/MilkSU-Official/milksu/internal/config"
)

// The sidecar process is per workspace and can only resolve the custom relay that was active
// when it was spawned (engineEnvironment exports a single MILKSU_CUSTOM_PROVIDER_* slot). A
// conversation whose manual choice is a *different* custom relay therefore lost its provider
// definition and silently fell back to the account source - the user's own report: the picker
// showed custom-relay-deepseek, the engine ran milksu-account with a 502.
//
// The definition has to travel with the turn instead of relying on the process environment.
func TestSendMessageCarriesTheConversationCustomProviderDefinition(t *testing.T) {
	reader, writer, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	defer reader.Close()
	defer writer.Close()
	workspace, err := resolveAgentWorkspace(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	supervisor := NewSupervisor(nil)
	supervisor.process = &childProcess{
		stdin:     writer,
		workspace: workspace,
	}
	defer func() {
		supervisor.mu.Lock()
		supervisor.process = nil
		supervisor.sessions = make(map[string]struct{})
		supervisor.mu.Unlock()
	}()

	baseURL := "https://api.deepseek.example.test"
	settings := config.DefaultSettings()
	settings.ActiveProvider = "custom-relay-deepseek"
	settings.ActiveModel = "deepseek-flash"
	settings.Providers["custom-relay-deepseek"] = config.ProviderConfig{
		Custom: true, Enabled: true, Name: "DeepSeek",
		Models: []string{"deepseek-flash"}, APIKey: "deepseek-personal-secret",
		BaseURL: &baseURL,
	}
	settings.Relay = &config.RelayConfig{
		Enabled: true, URL: "https://tokenflux.example.test/v1", Key: "account-secret",
	}

	if err := supervisor.SendMessage(
		"session-manual-model",
		"hello",
		workspace,
		"",
		"go",
		"workspace-auto",
		nil,
		"",
		nil,
		nil,
		nil,
		nil,
		settings,
	); err != nil {
		t.Fatal(err)
	}
	line, err := bufio.NewReader(reader).ReadBytes('\n')
	if err != nil {
		t.Fatal(err)
	}
	var command map[string]any
	if err := json.Unmarshal(line, &command); err != nil {
		t.Fatal(err)
	}
	if command["provider"] != "custom-relay-deepseek" || command["model"] != "deepseek-flash" {
		t.Fatalf("manual choice must reach the sidecar: %#v", command)
	}
	custom, ok := command["customProvider"].(map[string]any)
	if !ok {
		t.Fatalf("the conversation's own relay definition must travel with the turn: %#v", command)
	}
	if custom["id"] != "custom-relay-deepseek" ||
		custom["baseUrl"] != baseURL ||
		custom["key"] != "deepseek-personal-secret" {
		t.Fatalf("unexpected custom provider payload: %#v", custom)
	}
	// The account credential belongs to the account source; it must not ride along here.
	for key, value := range custom {
		if strings.Contains(strings.TrimSpace(toString(value)), "account-secret") {
			t.Fatalf("account credential leaked into the turn payload: %s", key)
		}
	}
}

func toString(value any) string {
	text, _ := value.(string)
	return text
}
