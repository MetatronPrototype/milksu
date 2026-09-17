package main

import (
	"context"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/MilkSU-Official/milksu/internal/config"
	"github.com/MilkSU-Official/milksu/internal/netproxy"
)

// NetworkStatus is what the 设置 page shows for the outbound network. It reports both
// the stored preference and the proxy that actually applies, so a stale proxy port can
// be spotted without leaving the app.
type NetworkStatus struct {
	UseProxy bool   `json:"use_proxy"`
	ProxyURL string `json:"proxy_url,omitempty"`
	// EffectiveSource is one of none/custom/environment/system/invalid.
	EffectiveSource string `json:"effective_source"`
	// EffectiveURL is the proxy outbound requests would use.
	EffectiveURL string `json:"effective_url,omitempty"`
	// SystemURL is what the operating system reports (diagnostics only).
	SystemURL string `json:"system_url,omitempty"`
	// Detail explains an unusable stored value.
	Detail string `json:"detail,omitempty"`
	// SidecarCovered reports whether model calls inherit this proxy.
	SidecarCovered bool `json:"sidecar_covered"`
}

// NetworkProbeResult is one reachability check shown in the settings panel.
type NetworkProbeResult struct {
	Target    string `json:"target"`
	URL       string `json:"url"`
	OK        bool   `json:"ok"`
	Status    int    `json:"status,omitempty"`
	LatencyMS int64  `json:"latency_ms"`
	Error     string `json:"error,omitempty"`
}

// GetNetworkStatus reports the stored proxy preference and the effective one.
func (a *App) GetNetworkStatus() NetworkStatus {
	settings := a.settings.Get()
	status := NetworkStatus{SidecarCovered: true}
	if settings.Network != nil {
		status.UseProxy = settings.Network.UseProxy
		status.ProxyURL = settings.Network.ProxyURL
	}
	// Only a switched-on value may apply: a stored address that the user turned off must
	// not be reported as the effective proxy.
	effective := ""
	if status.UseProxy {
		effective = status.ProxyURL
	}
	report := netproxy.Report(effective)
	status.EffectiveSource = report.Source
	status.EffectiveURL = report.URL
	status.SystemURL = report.SystemURL
	status.Detail = report.Detail
	return status
}

// SetNetworkProxy stores the proxy preference. The value is validated before it is
// saved, because a malformed proxy would otherwise break every outbound request.
func (a *App) SetNetworkProxy(useProxy bool, proxyURL string) error {
	normalized, err := netproxy.Normalize(proxyURL)
	if err != nil {
		return err
	}
	if useProxy && normalized == "" {
		return fmt.Errorf("启用代理时必须填写代理地址，例如 127.0.0.1:1082")
	}
	next := a.settings.Get()
	if !useProxy {
		next.Network = &config.NetworkConfig{UseProxy: false, ProxyURL: normalized}
	} else {
		next.Network = &config.NetworkConfig{UseProxy: true, ProxyURL: normalized}
	}
	if err := a.settings.Save(next); err != nil {
		return err
	}
	// Proxy settings reach a sidecar through its environment, so the next turn has to
	// run on a fresh process. This only marks the live sidecars stale; a turn that is
	// already streaming keeps its process.
	a.rotateEngineCredentials("network proxy changed")
	return nil
}

// TestNetworkConnectivity checks the proxy endpoint and the endpoints MilkSU actually
// calls, so a failure names the broken hop instead of just "network error".
func (a *App) TestNetworkConnectivity() ([]NetworkProbeResult, error) {
	settings := a.settings.Get()
	customProxy := ""
	if settings.Network != nil && settings.Network.UseProxy {
		customProxy = settings.Network.ProxyURL
	}
	results := make([]NetworkProbeResult, 0, 4)

	if normalized, err := netproxy.Normalize(customProxy); err == nil && normalized != "" {
		results = append(results, probeProxyEndpoint(normalized))
	}

	ctx, cancel := context.WithTimeout(a.commandContext(), 30*time.Second)
	defer cancel()
	client := netproxy.Client(customProxy, 8*time.Second)

	for _, target := range networkProbeTargets(settings) {
		results = append(results, probeHTTP(ctx, client, target.name, target.url))
	}
	if len(results) == 0 {
		return results, fmt.Errorf("没有可测试的目标：请先配置模型服务或中继地址")
	}
	return results, nil
}

type networkProbeTarget struct {
	name string
	url  string
}

func networkProbeTargets(settings config.AppSettings) []networkProbeTarget {
	targets := make([]networkProbeTarget, 0, 3)
	seen := make(map[string]struct{})
	add := func(name, raw string) {
		trimmed := strings.TrimSpace(raw)
		if trimmed == "" {
			return
		}
		if _, exists := seen[trimmed]; exists {
			return
		}
		seen[trimmed] = struct{}{}
		targets = append(targets, networkProbeTarget{name: name, url: trimmed})
	}
	if provider, exists := settings.Providers[settings.ActiveProvider]; exists {
		if provider.BaseURL != nil {
			add("当前模型服务 ("+settings.ActiveProvider+")", *provider.BaseURL)
		}
	}
	if relay := settings.Relay; relay != nil && relay.Enabled {
		add("账户中继", relay.URL)
	}
	return targets
}

func probeProxyEndpoint(proxyURL string) NetworkProbeResult {
	result := NetworkProbeResult{Target: "代理端口", URL: proxyURL}
	parsed, err := url.Parse(proxyURL)
	if err != nil {
		result.Error = err.Error()
		return result
	}
	host := parsed.Host
	if parsed.Port() == "" {
		if strings.EqualFold(parsed.Scheme, "https") {
			host = net.JoinHostPort(parsed.Hostname(), "443")
		} else {
			host = net.JoinHostPort(parsed.Hostname(), "80")
		}
	}
	started := time.Now()
	connection, dialErr := net.DialTimeout("tcp", host, 4*time.Second)
	result.LatencyMS = time.Since(started).Milliseconds()
	if dialErr != nil {
		result.Error = "连不上代理端口：" + dialErr.Error()
		return result
	}
	_ = connection.Close()
	result.OK = true
	return result
}

func probeHTTP(ctx context.Context, client *http.Client, name, rawURL string) NetworkProbeResult {
	result := NetworkProbeResult{Target: name, URL: rawURL}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
	if err != nil {
		result.Error = err.Error()
		return result
	}
	started := time.Now()
	response, err := client.Do(request)
	result.LatencyMS = time.Since(started).Milliseconds()
	if err != nil {
		result.Error = err.Error()
		return result
	}
	defer response.Body.Close()
	result.Status = response.StatusCode
	// Any answer proves the hop works; 401/404 only mean the path needs credentials.
	result.OK = response.StatusCode < 500
	if !result.OK {
		result.Error = fmt.Sprintf("服务端返回 %s", response.Status)
	}
	return result
}
