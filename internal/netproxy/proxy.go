// Package netproxy resolves which outbound proxy MilkSU should use and reports the
// answer to the settings panel, so a broken proxy can be diagnosed from inside the app
// instead of from a terminal outside it.
package netproxy

import (
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"regexp"
	"runtime"
	"strconv"
	"strings"
	"time"
)

// Source names the place the effective proxy came from.
const (
	SourceNone     = "none"
	SourceCustom   = "custom"
	SourceEnv      = "environment"
	SourceSystem   = "system"
	SourceInvalid  = "invalid"
	systemProxyCmd = "/usr/sbin/scutil"
)

// Describe reports the proxy that applies to outbound requests.
type Describe struct {
	// Source is one of SourceNone, SourceCustom, SourceEnv, SourceSystem.
	Source string
	// URL is the proxy URL in use, empty for a direct connection.
	URL string
	// SystemURL is what the operating system reports, for diagnostics only.
	SystemURL string
	// Detail explains an unusable custom value.
	Detail string
}

// Normalize validates a user-provided proxy URL. An empty value means "no custom proxy".
func Normalize(raw string) (string, error) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return "", nil
	}
	if !strings.Contains(trimmed, "://") {
		trimmed = "http://" + trimmed
	}
	parsed, err := url.Parse(trimmed)
	if err != nil {
		return "", err
	}
	scheme := strings.ToLower(parsed.Scheme)
	if scheme != "http" && scheme != "https" && scheme != "socks5" && scheme != "socks5h" {
		return "", &UnsupportedSchemeError{Scheme: parsed.Scheme}
	}
	if parsed.Host == "" || parsed.Hostname() == "" {
		return "", &MissingHostError{}
	}
	if parsed.Port() != "" {
		port, portErr := strconv.Atoi(parsed.Port())
		if portErr != nil || port <= 0 || port > 65535 {
			return "", &InvalidPortError{Port: parsed.Port()}
		}
	}
	return parsed.String(), nil
}

// UnsupportedSchemeError reports a proxy scheme MilkSU cannot use.
type UnsupportedSchemeError struct{ Scheme string }

func (e *UnsupportedSchemeError) Error() string {
	return "unsupported proxy scheme " + strconv.Quote(e.Scheme) + "; use http, https or socks5"
}

// MissingHostError reports a proxy URL without a host.
type MissingHostError struct{}

func (e *MissingHostError) Error() string { return "proxy address needs a host, for example 127.0.0.1:1082" }

// InvalidPortError reports an out-of-range proxy port.
type InvalidPortError struct{ Port string }

func (e *InvalidPortError) Error() string { return "proxy port " + strconv.Quote(e.Port) + " is not valid" }

// ProxyFunc builds the proxy selector for an HTTP transport. customURL is the value the
// user configured, or empty for "follow the environment and the system".
func ProxyFunc(customURL string) func(*http.Request) (*url.URL, error) {
	custom, customErr := Normalize(customURL)
	return func(request *http.Request) (*url.URL, error) {
		if customErr == nil && custom != "" {
			return url.Parse(custom)
		}
		if fromEnvironment, err := http.ProxyFromEnvironment(request); fromEnvironment != nil || err != nil {
			return fromEnvironment, err
		}
		return System(request.URL.Scheme), nil
	}
}

// Client returns an HTTP client that honours the configured proxy.
func Client(customURL string, timeout time.Duration) *http.Client {
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.Proxy = ProxyFunc(customURL)
	return &http.Client{Timeout: timeout, Transport: transport}
}

// Report explains what would be used for outbound requests.
func Report(customURL string) Describe {
	system := SystemURL()
	normalized, err := Normalize(customURL)
	if err != nil {
		return Describe{Source: SourceInvalid, SystemURL: system, Detail: err.Error()}
	}
	if normalized != "" {
		return Describe{Source: SourceCustom, URL: normalized, SystemURL: system}
	}
	if fromEnvironment := environmentURL(); fromEnvironment != "" {
		return Describe{Source: SourceEnv, URL: fromEnvironment, SystemURL: system}
	}
	if system != "" {
		return Describe{Source: SourceSystem, URL: system, SystemURL: system}
	}
	return Describe{Source: SourceNone, SystemURL: system}
}

func environmentURL() string {
	for _, name := range []string{"HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy", "ALL_PROXY", "all_proxy"} {
		if value := strings.TrimSpace(os.Getenv(name)); value != "" {
			return value
		}
	}
	return ""
}

var systemProxyValuePattern = regexp.MustCompile(`(?m)^\s*([A-Z]+(?:Enable|Proxy|Port))\s*:\s*(.+?)\s*$`)

// SystemURL returns the proxy macOS reports for HTTPS traffic, or empty when there is
// none. Other platforms rely on the environment.
func SystemURL() string {
	if system := System("https"); system != nil {
		return system.String()
	}
	return ""
}

func System(scheme string) *url.URL {
	if runtime.GOOS != "darwin" {
		return nil
	}
	output, err := exec.Command(systemProxyCmd, "--proxy").Output()
	if err != nil {
		return nil
	}
	values := make(map[string]string)
	for _, match := range systemProxyValuePattern.FindAllStringSubmatch(string(output), -1) {
		values[match[1]] = match[2]
	}
	prefix := "HTTP"
	if strings.EqualFold(scheme, "https") {
		prefix = "HTTPS"
	}
	if values[prefix+"Enable"] != "1" || values[prefix+"Proxy"] == "" {
		return nil
	}
	port, err := strconv.Atoi(values[prefix+"Port"])
	if err != nil || port <= 0 || port > 65535 {
		return nil
	}
	parsed, err := url.Parse("http://" + values[prefix+"Proxy"] + ":" + strconv.Itoa(port))
	if err != nil {
		return nil
	}
	return parsed
}
