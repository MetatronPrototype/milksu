package engine

import (
	"testing"
	"time"
)

// busySessionOn binds a session with a turn in flight to a sidecar's workspace, which is how the
// supervisor knows that sidecar is serving a turn right now.
func busySessionOn(supervisor *Supervisor, sessionID, workspace string) {
	supervisor.mu.Lock()
	defer supervisor.mu.Unlock()
	supervisor.sessions[sessionID] = struct{}{}
	supervisor.sessionKernels[sessionID] = KernelPi
	supervisor.sessionWorkspaces[sessionID] = workspace
	supervisor.busySessions[sessionID] = struct{}{}
}

// A credential or settings rotation must never interrupt the answer the reader is watching. A
// sidecar serving a turn is only put on the pending list; it is marked the moment its own turn
// settles, so the next turn still starts on fresh credentials.
func TestRotationWaitsForTheTurnToSettle(t *testing.T) {
	supervisor := NewSupervisor(nil)
	active := testSidecarProcess("/workspace/a")
	supervisor.process = active
	busySessionOn(supervisor, "session-streaming", "/workspace/a")

	if marked := supervisor.InvalidateCredentials("settings saved"); marked != 0 {
		t.Fatalf("a sidecar serving a turn must not be marked yet, marked = %d", marked)
	}
	if active.stale.Load() {
		t.Fatal("a sidecar with a turn in flight must not be marked stale")
	}
	if _, pending := supervisor.pendingStale[active]; !pending {
		t.Fatal("the rotation must be remembered until the turn settles")
	}
	if reason := supervisor.pendingStale[active]; reason != "settings saved" {
		t.Fatalf("pending reason = %q, want the rotation cause", reason)
	}
	if active.retired.Load() {
		t.Fatal("a rotation must not retire a sidecar that is mid-turn")
	}

	// The turn settles: now the rotation takes effect, and the next turn gets fresh credentials.
	supervisor.mu.Lock()
	delete(supervisor.busySessions, "session-streaming")
	supervisor.mu.Unlock()
	supervisor.promotePendingStale(active)

	if !active.stale.Load() {
		t.Fatal("the sidecar must be marked stale once its turn settled")
	}
	if active.staleReason != "settings saved" {
		t.Fatalf("staleReason = %q, want the rotation cause", active.staleReason)
	}
	if _, pending := supervisor.pendingStale[active]; pending {
		t.Fatal("the pending entry must be cleared once applied")
	}
}

// The reap used to stop a retired sidecar once its grace ran out, even with a turn still streaming.
// A sidecar carrying a turn is never stopped for a rotation, however long it has been silent: a
// single `sleep 75` writes no output at all, so silence cannot tell working from abandoned.
func TestStaleReapNeverStopsAStreamingTurn(t *testing.T) {
	supervisor := NewSupervisor(nil)
	busy := testSidecarProcess("/workspace/a")
	busy.retired.Store(true)
	busy.stale.Store(true)
	// Silent for far longer than the grace window, with a turn still in flight.
	busy.staleSince.Store(time.Now().Add(-staleSidecarGraceTimeout - time.Hour).UnixNano())
	supervisor.retiring = []*childProcess{busy}
	busySessionOn(supervisor, "session-streaming", "/workspace/a")
	supervisor.mu.Lock()
	// Retirement records who it was carrying: that is what keeps this process alive now.
	busy.retiredTurns = map[string]struct{}{"session-streaming": {}}
	supervisor.mu.Unlock()

	supervisor.reapStaleProcessesLocked()
	if len(supervisor.retiring) != 1 || supervisor.retiring[0] != busy {
		t.Fatal("a sidecar carrying a turn must not be stopped, however long it has been silent")
	}

	// The turn is over: now it is reaped.
	supervisor.mu.Lock()
	delete(supervisor.busySessions, "session-streaming")
	supervisor.mu.Unlock()
	supervisor.reapStaleProcessesLocked()
	if len(supervisor.retiring) != 0 {
		t.Fatal("a retired sidecar whose turn ended must be reaped")
	}
}

// The ceiling is the backstop for a busy record that is wrong: a turn that never reports its end
// must not pin the process for the lifetime of the app. Past it the sidecar is retired anyway and
// the conversation that loses its turn is told.
func TestBusySidecarIsRetiredAtTheCeiling(t *testing.T) {
	collector := newEventCollector()
	supervisor := NewSupervisor(collector.emit)
	busy := testSidecarProcess("/workspace/a")
	busy.retired.Store(true)
	busy.stale.Store(true)
	busy.staleSince.Store(time.Now().Add(-staleSidecarBusyCeiling - time.Minute).UnixNano())
	supervisor.retiring = []*childProcess{busy}
	busySessionOn(supervisor, "session-stuck", "/workspace/a")
	supervisor.mu.Lock()
	busy.retiredTurns = map[string]struct{}{"session-stuck": {}}
	supervisor.mu.Unlock()

	supervisor.reapStaleProcessesLocked()

	if len(supervisor.retiring) != 0 {
		t.Fatal("a sidecar past the busy ceiling must be retired, or a wrong busy record pins it forever")
	}
	if !busy.retired.Load() {
		t.Fatal("a stopped sidecar must be marked retired so its stop receipt is written")
	}
	if _, stillBusy := supervisor.busySessions["session-stuck"]; stillBusy {
		t.Fatal("the conversation that lost its turn must not stay busy forever")
	}
	event := collector.awaitSessionError(t, "session-stuck")
	if event.Error != sidecarGoneError {
		t.Fatalf("unexpected notice %q", event.Error)
	}
}

// "Test connection" runs a probe on a sidecar of its own. Marking that sidecar stale and reaping it
// made the probe fail while the model had already answered, so a waiting process is not marked and
// it is marked as soon as the waiter is gone.
func TestRotationWaitsForAModelProbe(t *testing.T) {
	supervisor := NewSupervisor(nil)
	probe := testSidecarProcess("/tmp/model-probe")
	supervisor.process = probe
	supervisor.mu.Lock()
	supervisor.sessions["milksu_model_probe_1"] = struct{}{}
	supervisor.sessionKernels["milksu_model_probe_1"] = KernelPi
	supervisor.sessionWorkspaces["milksu_model_probe_1"] = "/tmp/model-probe"
	supervisor.probeWaiters["milksu_model_probe_1"] = make(chan Event, 1)
	supervisor.mu.Unlock()

	if marked := supervisor.InvalidateCredentials("account model credential synced"); marked != 0 {
		t.Fatalf("a probing sidecar must not be marked yet, marked = %d", marked)
	}
	if probe.stale.Load() {
		t.Fatal("a sidecar serving a probe must not be marked stale")
	}

	// The probe is over: the rotation applies. The reaper promotes it without needing a turn.
	supervisor.mu.Lock()
	delete(supervisor.probeWaiters, "milksu_model_probe_1")
	supervisor.mu.Unlock()
	supervisor.reapStaleProcessesLocked()
	if !probe.stale.Load() {
		t.Fatal("the rotation must apply once the probe finished")
	}
	if probe.staleReason != "account model credential synced" {
		t.Fatalf("staleReason = %q, want the rotation cause", probe.staleReason)
	}
}

// After a rotation the next dispatch must run on fresh credentials: the stale sidecar leaves
// rotation and the replacement serves the conversation.
func TestNextDispatchAfterRotationUsesTheFreshSidecar(t *testing.T) {
	supervisor := NewSupervisor(nil)
	stale := testSidecarProcess("/workspace/a")
	supervisor.process = stale
	supervisor.mu.Lock()
	supervisor.sessions["session-a"] = struct{}{}
	supervisor.sessionKernels["session-a"] = KernelPi
	supervisor.sessionWorkspaces["session-a"] = "/workspace/a"
	supervisor.mu.Unlock()

	// Idle rotation: it takes effect immediately.
	if marked := supervisor.InvalidateCredentials("settings saved"); marked != 1 {
		t.Fatalf("an idle sidecar must be marked at once, marked = %d", marked)
	}
	supervisor.retireStaleProcessLocked(KernelPi, stale)
	fresh := testSidecarProcess("/workspace/a")
	supervisor.mu.Lock()
	supervisor.process = fresh
	served := supervisor.processForSessionLocked("session-a")
	supervisor.mu.Unlock()
	if served != fresh {
		t.Fatalf("the fresh sidecar must serve the conversation after a rotation, got %#v", served)
	}
}
