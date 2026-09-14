package engine

import (
	"os"
	"syscall"
	"testing"
	"time"

	"github.com/MilkSU-Official/milksu/internal/config"
)

// processAlive reports whether a spawned sidecar process is still running.
func processAlive(process *childProcess) bool {
	if process == nil || process.command == nil || process.command.Process == nil {
		return false
	}
	err := process.command.Process.Signal(syscall.Signal(0))
	return err == nil
}

// TestParkedWorkspaceKeepsARealSidecarProcessAlive exercises the parking behaviour with
// real sidecar processes: opening a second workspace must not stop the first one, because
// that is exactly what used to kill an in-flight turn when the user switched conversations.
//
// It needs a packaged or cloned sidecar directory and is therefore opt-in:
//
//	MILKSU_TEST_SIDECAR_DIR=/path/to/milksu-sidecar go test ./internal/engine -run ParkedWorkspace -v
func TestParkedWorkspaceKeepsARealSidecarProcessAlive(t *testing.T) {
	sidecarDirectory := os.Getenv("MILKSU_TEST_SIDECAR_DIR")
	if sidecarDirectory == "" {
		t.Skip("set MILKSU_TEST_SIDECAR_DIR to a sidecar directory to run this test")
	}
	if _, err := os.Stat(sidecarDirectory); err != nil {
		t.Fatalf("sidecar directory is not readable: %v", err)
	}

	settings := config.DefaultSettings()
	workspaceA := t.TempDir()
	workspaceB := t.TempDir()
	supervisor := NewSupervisorWithSidecarDirectory(nil, sidecarDirectory)
	defer supervisor.Close()

	startA := func() *childProcess {
		supervisor.mu.Lock()
		defer supervisor.mu.Unlock()
		if err := supervisor.ensureKernelProcessLocked(KernelPi, settings, workspaceA); err != nil {
			t.Fatalf("ensure workspace A: %v", err)
		}
		return supervisor.process
	}

	first := startA()
	if first == nil {
		t.Fatal("workspace A must start a sidecar")
	}
	waitForProcess(t, first, true)
	if first.workspace != workspaceA {
		t.Fatalf("active sidecar serves %q, want %q", first.workspace, workspaceA)
	}

	// Opening a conversation in another workspace must park the first sidecar, not kill it.
	supervisor.mu.Lock()
	if err := supervisor.ensureKernelProcessLocked(KernelPi, settings, workspaceB); err != nil {
		supervisor.mu.Unlock()
		t.Fatalf("ensure workspace B: %v", err)
	}
	second := supervisor.process
	parkedA := supervisor.parked[sidecarWorkspaceKey(KernelPi, workspaceA)]
	supervisor.mu.Unlock()

	if second == nil || second.workspace != workspaceB {
		t.Fatalf("active sidecar must serve workspace B, got %#v", second)
	}
	if parkedA != first {
		t.Fatal("the previous workspace sidecar must be parked, not dropped")
	}
	waitForProcess(t, first, true)

	// Coming back must reuse the parked process instead of spawning another one.
	supervisor.mu.Lock()
	if err := supervisor.ensureKernelProcessLocked(KernelPi, settings, workspaceA); err != nil {
		supervisor.mu.Unlock()
		t.Fatalf("ensure workspace A again: %v", err)
	}
	reactivated := supervisor.process
	parkedB := supervisor.parked[sidecarWorkspaceKey(KernelPi, workspaceB)]
	supervisor.mu.Unlock()

	if reactivated != first {
		t.Fatal("returning to workspace A must reuse the parked sidecar")
	}
	if parkedB != second {
		t.Fatal("workspace B must be parked after switching back")
	}
	waitForProcess(t, first, true)
	waitForProcess(t, second, true)
}

func waitForProcess(t *testing.T, process *childProcess, alive bool) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if processAlive(process) == alive {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatalf("sidecar process liveness = %v, want %v", !alive, alive)
}
