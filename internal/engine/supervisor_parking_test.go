package engine

import (
	"fmt"
	"os/exec"
	"strings"
	"testing"
	"time"
)

// nopWriteCloser stands in for the sidecar stdin pipe inside unit tests.
type nopWriteCloser struct{}

func (nopWriteCloser) Write(payload []byte) (int, error) { return len(payload), nil }
func (nopWriteCloser) Close() error                      { return nil }

func testSidecarProcess(workspace string) *childProcess {
	return &childProcess{
		command:   &exec.Cmd{},
		stdin:     nopWriteCloser{},
		workspace: workspace,
	}
}

func parkTestProcess(supervisor *Supervisor, workspace string, parkedAt time.Time) *childProcess {
	process := testSidecarProcess(workspace)
	key := sidecarWorkspaceKey(KernelPi, workspace)
	supervisor.parked[key] = process
	supervisor.parkedAt[key] = parkedAt
	return process
}

func TestParkingKeepsTheWorkspaceSidecarAlive(t *testing.T) {
	supervisor := NewSupervisor(nil)
	process := testSidecarProcess("/workspace/a")
	supervisor.process = process

	supervisor.parkCurrentLocked(KernelPi, process)

	if supervisor.process != nil {
		t.Fatal("parking must clear the active slot for the kernel")
	}
	if supervisor.parked[sidecarWorkspaceKey(KernelPi, "/workspace/a")] != process {
		t.Fatal("parking must retain the process for its workspace")
	}
	if process.retired.Load() {
		t.Fatal("parking must not retire the process, its turn may still be running")
	}
}

func TestParkedSidecarServesSessionsOfItsOwnWorkspace(t *testing.T) {
	supervisor := NewSupervisor(nil)
	parked := parkTestProcess(supervisor, "/workspace/a", time.Now())
	active := testSidecarProcess("/workspace/b")
	supervisor.process = active

	supervisor.sessions["session-a"] = struct{}{}
	supervisor.sessionKernels["session-a"] = KernelPi
	supervisor.sessionWorkspaces["session-a"] = "/workspace/a"

	if got := supervisor.processForSessionLocked("session-a"); got != parked {
		t.Fatalf("session of a parked workspace must reach the parked sidecar, got %#v", got)
	}
	if got := supervisor.processForSessionLocked("session-unbound"); got != active {
		t.Fatalf("unbound session must fall back to the active sidecar, got %#v", got)
	}
}

func TestParkedSidecarWorkspaceIsForgottenWithTheProcess(t *testing.T) {
	supervisor := NewSupervisor(nil)
	stale := parkTestProcess(supervisor, "/workspace/stale", time.Now().Add(-2*sidecarIdleTimeout))
	fresh := parkTestProcess(supervisor, "/workspace/fresh", time.Now())

	supervisor.reapParkedLocked(KernelPi)

	if !stale.retired.Load() {
		t.Fatal("an idle parked sidecar must be retired")
	}
	if _, exists := supervisor.parked[sidecarWorkspaceKey(KernelPi, "/workspace/stale")]; exists {
		t.Fatal("reaped sidecar must leave the parked set")
	}
	if fresh.retired.Load() {
		t.Fatal("a recently used parked sidecar must stay alive")
	}
	if len(supervisor.parked) != 1 {
		t.Fatalf("expected one parked sidecar, got %d", len(supervisor.parked))
	}
}

func TestParkedSidecarsAreBounded(t *testing.T) {
	supervisor := NewSupervisor(nil)
	oldest := time.Now().Add(-time.Hour)
	var firstKey string
	for index := 0; index <= maxParkedSidecars; index++ {
		workspace := fmt.Sprintf("/workspace/%d", index)
		parkTestProcess(supervisor, workspace, oldest.Add(time.Duration(index)*time.Minute))
		if index == 0 {
			firstKey = sidecarWorkspaceKey(KernelPi, workspace)
		}
	}

	supervisor.evictParkedOverLimitLocked(KernelPi)

	if len(supervisor.parked) != maxParkedSidecars {
		t.Fatalf("parked set must be bounded at %d, got %d", maxParkedSidecars, len(supervisor.parked))
	}
	if _, exists := supervisor.parked[firstKey]; exists {
		t.Fatal("the least recently parked sidecar must be evicted first")
	}
}

func TestDroppingOneWorkspaceKeepsOtherSessions(t *testing.T) {
	supervisor := NewSupervisor(nil)
	for _, session := range []struct {
		id        string
		workspace string
	}{
		{"session-a", "/workspace/a"},
		{"session-b", "/workspace/b"},
	} {
		supervisor.sessions[session.id] = struct{}{}
		supervisor.sessionKernels[session.id] = KernelPi
		supervisor.sessionWorkspaces[session.id] = session.workspace
	}

	supervisor.dropWorkspaceSessionsLocked(KernelPi, "/workspace/a")

	if _, exists := supervisor.sessions["session-a"]; exists {
		t.Fatal("sessions of the dropped workspace must be forgotten")
	}
	if _, exists := supervisor.sessions["session-b"]; !exists {
		t.Fatal("sessions of other workspaces must survive")
	}
}

func TestCloseStopsParkedSidecars(t *testing.T) {
	supervisor := NewSupervisor(nil)
	parked := parkTestProcess(supervisor, "/workspace/a", time.Now())
	active := testSidecarProcess("/workspace/b")
	supervisor.process = active

	supervisor.Close()

	if !parked.retired.Load() {
		t.Fatal("closing the supervisor must retire parked sidecars")
	}
	if !active.retired.Load() {
		t.Fatal("closing the supervisor must retire the active sidecar")
	}
	if len(supervisor.parked) != 0 {
		t.Fatalf("parked set must be empty after Close, got %d", len(supervisor.parked))
	}
}

func TestWorkspaceKeysSeparateKernels(t *testing.T) {
	pi := sidecarWorkspaceKey(KernelPi, "/workspace/a")
	dsh := sidecarWorkspaceKey(KernelDSH, "/workspace/a")
	if pi == dsh {
		t.Fatal("kernels must not share a workspace key")
	}
	if !strings.HasPrefix(pi, NormalizeKernel(KernelPi)) {
		t.Fatalf("unexpected key shape: %q", pi)
	}
}

func TestRuntimeStatusCountsParkedSidecars(t *testing.T) {
	supervisor := NewSupervisor(nil)
	parkTestProcess(supervisor, "/workspace/a", time.Now())

	status := supervisor.Status()
	if !status.Running {
		t.Fatal("a parked sidecar is still a running sidecar")
	}
}
