package main

import (
	"testing"

	"github.com/MilkSU-Official/milksu/internal/engine"
)

func TestResolveInteractiveCodingBrowserPiReusesWithoutEnsure(t *testing.T) {
	lookedUp := 0
	descriptor, err := resolveInteractiveCodingBrowser(
		engine.KernelPi,
		"go",
		"workspace-auto",
		func() (*engine.CodingBrowserDescriptor, bool) {
			lookedUp++
			return nil, false
		},
	)
	if err != nil {
		t.Fatalf("pi reuse: %v", err)
	}
	if descriptor != nil {
		t.Fatalf("pi without an open rail must not invent a descriptor: %#v", descriptor)
	}
	if lookedUp != 1 {
		t.Fatalf("pi send must look up once, calls=%d", lookedUp)
	}
}

func TestResolveInteractiveCodingBrowserDSHDoesNotEnsureOnChatSend(t *testing.T) {
	lookedUp := 0
	descriptor, err := resolveInteractiveCodingBrowser(
		"deepseek-harness",
		"go",
		"workspace-auto",
		func() (*engine.CodingBrowserDescriptor, bool) {
			lookedUp++
			return nil, false
		},
	)
	if err != nil {
		t.Fatalf("dsh chat send: %v", err)
	}
	if descriptor != nil {
		t.Fatalf("dsh greeting must not start Chromium: %#v", descriptor)
	}
	if lookedUp != 1 {
		t.Fatalf("dsh send must look up once, calls=%d", lookedUp)
	}
}

func TestResolveInteractiveCodingBrowserDSHReusesOpenRail(t *testing.T) {
	descriptor, err := resolveInteractiveCodingBrowser(
		engine.KernelDSH,
		"go",
		"workspace-auto",
		func() (*engine.CodingBrowserDescriptor, bool) {
			return &engine.CodingBrowserDescriptor{
				SessionID:   "browser_dsh",
				CDPEndpoint: "http://127.0.0.1:9333",
			}, true
		},
	)
	if err != nil {
		t.Fatalf("dsh reuse: %v", err)
	}
	if descriptor == nil || descriptor.CDPEndpoint != "http://127.0.0.1:9333" {
		t.Fatalf("dsh descriptor = %#v", descriptor)
	}
}

func TestResolveInteractiveCodingBrowserDSHIgnoresEmptyCDP(t *testing.T) {
	descriptor, err := resolveInteractiveCodingBrowser(
		engine.KernelDSH,
		"go",
		"ask",
		func() (*engine.CodingBrowserDescriptor, bool) {
			return &engine.CodingBrowserDescriptor{SessionID: "browser_empty"}, true
		},
	)
	if err != nil {
		t.Fatalf("empty CDP must not fail the send: %v", err)
	}
	if descriptor != nil {
		t.Fatalf("empty CDP must not attach: %#v", descriptor)
	}
}

func TestResolveInteractiveCodingBrowserSkipsPlanAndReadOnly(t *testing.T) {
	for _, policy := range []struct {
		kernel   string
		mode     string
		approval string
	}{
		{engine.KernelDSH, "plan", "workspace-auto"},
		{engine.KernelDSH, "go", "read-only"},
		{engine.KernelPi, "plan", "ask"},
	} {
		descriptor, err := resolveInteractiveCodingBrowser(
			policy.kernel,
			policy.mode,
			policy.approval,
			func() (*engine.CodingBrowserDescriptor, bool) {
				t.Fatalf("lookup must not run for %s %s %s", policy.kernel, policy.mode, policy.approval)
				return nil, false
			},
		)
		if err != nil || descriptor != nil {
			t.Fatalf("%s %s %s = (%#v, %v)", policy.kernel, policy.mode, policy.approval, descriptor, err)
		}
	}
}
