package main

import (
	"testing"

	"github.com/MilkSU-Official/milksu/internal/config"
	"github.com/MilkSU-Official/milksu/internal/netproxy"
)

func TestSetNetworkProxyValidatesAndPersists(t *testing.T) {
	t.Setenv("MILKSU_APPDATA_DIR", t.TempDir())
	store, err := config.NewStore()
	if err != nil {
		t.Fatal(err)
	}
	app := &App{settings: store}

	if err := app.SetNetworkProxy(true, "ftp://127.0.0.1:21"); err == nil {
		t.Fatal("an unsupported proxy scheme must be rejected")
	}
	if err := app.SetNetworkProxy(true, ""); err == nil {
		t.Fatal("enabling the proxy without an address must be rejected")
	}
	if err := app.SetNetworkProxy(true, "127.0.0.1:1082"); err != nil {
		t.Fatalf("a valid proxy was rejected: %v", err)
	}

	status := app.GetNetworkStatus()
	if !status.UseProxy || status.ProxyURL != "http://127.0.0.1:1082" {
		t.Fatalf("status = %#v, want the saved proxy", status)
	}
	if status.EffectiveSource != netproxy.SourceCustom || status.EffectiveURL != "http://127.0.0.1:1082" {
		t.Fatalf("effective = %#v, want the custom proxy to apply", status)
	}
	if !status.SidecarCovered {
		t.Fatal("model calls must inherit the configured proxy")
	}

	if err := app.SetNetworkProxy(false, "127.0.0.1:1082"); err != nil {
		t.Fatalf("disabling the proxy failed: %v", err)
	}
	status = app.GetNetworkStatus()
	if status.UseProxy {
		t.Fatal("the switch must report itself as off")
	}
	if status.EffectiveSource == netproxy.SourceCustom {
		t.Fatalf("a disabled proxy must not apply: %#v", status)
	}
}

func TestNetworkProbeTargetsDeduplicateAndSkipDisabledSources(t *testing.T) {
	base := "https://api.deepseek.com"
	settings := config.DefaultSettings()
	settings.ActiveProvider = "custom-relay"
	settings.Providers["custom-relay"] = config.ProviderConfig{
		Custom:  true,
		Enabled: true,
		BaseURL: &base,
	}
	settings.Relay = &config.RelayConfig{Enabled: true, URL: "https://tokenflux.dev/v1"}

	targets := networkProbeTargets(settings)
	if len(targets) != 2 {
		t.Fatalf("targets = %#v, want the provider and the relay", targets)
	}

	settings.Providers["custom-relay"] = config.ProviderConfig{
		Custom:  true,
		Enabled: true,
		BaseURL: &base,
	}
	settings.Relay = &config.RelayConfig{Enabled: true, URL: base}
	if deduped := networkProbeTargets(settings); len(deduped) != 1 {
		t.Fatalf("duplicate URLs must be probed once, got %#v", deduped)
	}

	settings.Relay = nil
	settings.Providers = map[string]config.ProviderConfig{}
	if empty := networkProbeTargets(settings); len(empty) != 0 {
		t.Fatalf("no configured source must yield no target, got %#v", empty)
	}
}
