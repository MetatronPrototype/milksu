package netproxy

import (
	"net/http"
	"testing"
)

func TestNormalizeAcceptsCommonForms(t *testing.T) {
	cases := []struct{ input, want string }{
		{"", ""},
		{"127.0.0.1:1082", "http://127.0.0.1:1082"},
		{"http://127.0.0.1:1082", "http://127.0.0.1:1082"},
		{"socks5://127.0.0.1:1080", "socks5://127.0.0.1:1080"},
		{"  http://proxy.local:3128  ", "http://proxy.local:3128"},
	}
	for _, testCase := range cases {
		got, err := Normalize(testCase.input)
		if err != nil {
			t.Fatalf("Normalize(%q) failed: %v", testCase.input, err)
		}
		if got != testCase.want {
			t.Fatalf("Normalize(%q) = %q, want %q", testCase.input, got, testCase.want)
		}
	}
}

// A malformed proxy must be rejected before it is stored: every outbound request would
// otherwise fail with an opaque transport error.
func TestNormalizeRejectsUnusableValues(t *testing.T) {
	for _, input := range []string{"ftp://127.0.0.1:21", "http://", "127.0.0.1:0", "http://127.0.0.1:99999"} {
		if _, err := Normalize(input); err == nil {
			t.Fatalf("Normalize(%q) must fail", input)
		}
	}
}

func TestReportPrefersTheConfiguredProxy(t *testing.T) {
	report := Report("127.0.0.1:1082")
	if report.Source != SourceCustom {
		t.Fatalf("source = %q, want %q", report.Source, SourceCustom)
	}
	if report.URL != "http://127.0.0.1:1082" {
		t.Fatalf("url = %q", report.URL)
	}
}

func TestReportFallsBackToTheEnvironment(t *testing.T) {
	t.Setenv("HTTPS_PROXY", "http://environment-proxy:8080")
	report := Report("")
	if report.Source != SourceEnv || report.URL != "http://environment-proxy:8080" {
		t.Fatalf("report = %#v, want the environment proxy", report)
	}
}

func TestReportFlagsAnInvalidStoredValue(t *testing.T) {
	report := Report("ftp://127.0.0.1:21")
	if report.Source != SourceInvalid {
		t.Fatalf("source = %q, want %q", report.Source, SourceInvalid)
	}
	if report.Detail == "" {
		t.Fatal("an invalid value must explain itself")
	}
}

// An unusable stored value must not break outbound traffic: ProxyFunc falls back to the
// environment instead of returning an error for every request.
func TestProxyFuncIgnoresAnInvalidValue(t *testing.T) {
	t.Setenv("HTTPS_PROXY", "http://environment-proxy:8080")
	selector := ProxyFunc("ftp://127.0.0.1:21")
	request, err := http.NewRequest("GET", "https://example.com", nil)
	if err != nil {
		t.Fatal(err)
	}
	proxy, err := selector(request)
	if err != nil {
		t.Fatalf("invalid stored proxy must not fail requests: %v", err)
	}
	if proxy == nil || proxy.String() != "http://environment-proxy:8080" {
		t.Fatalf("proxy = %v, want the environment proxy", proxy)
	}
}
