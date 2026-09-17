package appdata

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"
)

const (
	eventLogRelativePath = "runtime/milksu.log"
	// backendLogRelativePath mirrors the Go runtime log next to milksu.log. An app
	// launched from Finder keeps no stdout, so a killed sidecar would otherwise
	// leave no reason behind to inspect.
	backendLogRelativePath = "runtime/backend.log"
	// maxEventLogBytes bounds the active log file; at the cap it is rotated to
	// milksu.log.1, keeping at most two files on disk.
	maxEventLogBytes = 1024 * 1024
)

// PersistedEvent is the complete allowlist of events that may survive a
// process restart. Values never contain session text, command arguments,
// tool/model output, paths, endpoints or credentials.
type PersistedEvent string

const (
	PersistedAppInitialized              PersistedEvent = "app.initialized"
	PersistedDesktopRuntimeStarted       PersistedEvent = "app.runtime_started"
	PersistedDesktopRuntimeExited        PersistedEvent = "app.runtime_exited_cleanly"
	PersistedLifespanUnavailable         PersistedEvent = "app.lifespan_unavailable"
	PersistedPreviousExitAbnormal        PersistedEvent = "app.previous_exit_abnormal"
	PersistedCleanExitMarkerFailed       PersistedEvent = "app.clean_exit_marker_failed"
	PersistedRestoreApplied              PersistedEvent = "recovery.restore_applied"
	PersistedInterruptedRestoreRecovered PersistedEvent = "recovery.interrupted_restore_recovered"
	PersistedMigrationBackupCreated      PersistedEvent = "migration.backup_created"
	PersistedMigrationBackupVerified     PersistedEvent = "migration.backup_verified"
	PersistedRuntimeRecoveryFailed       PersistedEvent = "recovery.runtime_failed"
	PersistedCTFRecoveryFailed           PersistedEvent = "recovery.ctf_failed"
	PersistedVulnRecoveryFailed          PersistedEvent = "recovery.vuln_failed"
	PersistedSidecarStarted              PersistedEvent = "sidecar.started"
	PersistedSidecarStopped              PersistedEvent = "sidecar.stopped"
	PersistedSidecarProtocolError        PersistedEvent = "sidecar.protocol_error"
	PersistedBackgroundRecoveryFailed    PersistedEvent = "background.recovery_failed"
	PersistedBackgroundTaskStarted       PersistedEvent = "background.task_started"
	PersistedBackgroundTaskStopped       PersistedEvent = "background.task_stopped"
	// PersistedAgentGuardAlarm records that an agent tried to write a protected path. The
	// accompanying line in backend.log carries the concrete reason.
	PersistedAgentGuardAlarm PersistedEvent = "agent.guard_alarm"
	// PersistedSettingsIntegrityWarning records that settings.json held a collaboration
	// configuration this app never wrote, so it was not applied.
	PersistedSettingsIntegrityWarning PersistedEvent = "settings.integrity_warning"
)

type persistedEventSpec struct {
	category string
	level    string
}

var persistedEventSpecs = map[PersistedEvent]persistedEventSpec{
	PersistedAppInitialized:              {category: "app", level: "info"},
	PersistedDesktopRuntimeStarted:       {category: "app", level: "info"},
	PersistedDesktopRuntimeExited:        {category: "app", level: "info"},
	PersistedLifespanUnavailable:         {category: "appdata", level: "warning"},
	PersistedPreviousExitAbnormal:        {category: "appdata", level: "warning"},
	PersistedCleanExitMarkerFailed:       {category: "appdata", level: "warning"},
	PersistedRestoreApplied:              {category: "appdata", level: "info"},
	PersistedInterruptedRestoreRecovered: {category: "appdata", level: "warning"},
	PersistedMigrationBackupCreated:      {category: "appdata", level: "info"},
	PersistedMigrationBackupVerified:     {category: "appdata", level: "info"},
	PersistedRuntimeRecoveryFailed:       {category: "runtime", level: "error"},
	PersistedCTFRecoveryFailed:           {category: "ctf", level: "error"},
	PersistedVulnRecoveryFailed:          {category: "vuln", level: "error"},
	PersistedSidecarStarted:              {category: "coding-engine", level: "info"},
	PersistedSidecarStopped:              {category: "coding-engine", level: "info"},
	PersistedSidecarProtocolError:        {category: "coding-engine", level: "error"},
	PersistedBackgroundRecoveryFailed:    {category: "coding-engine", level: "warning"},
	PersistedBackgroundTaskStarted:       {category: "coding-engine", level: "info"},
	PersistedBackgroundTaskStopped:       {category: "coding-engine", level: "info"},
	PersistedAgentGuardAlarm:             {category: "coding-engine", level: "warning"},
	PersistedSettingsIntegrityWarning:    {category: "settings", level: "warning"},
}

var eventLogMu sync.Mutex

// AppendEventLog appends one allowlisted event to the persisted, desensitized
// runtime log. It intentionally accepts no free-form message.
func AppendEventLog(root string, event PersistedEvent) error {
	spec, ok := persistedEventSpecs[event]
	if !ok {
		return fmt.Errorf("persisted event %q is not allowlisted", event)
	}
	root, err := secureRoot(root)
	if err != nil {
		return err
	}
	eventLogMu.Lock()
	defer eventLogMu.Unlock()
	path := filepath.Join(root, eventLogRelativePath)
	directory := filepath.Dir(path)
	if err := ensureEventLogDirectory(directory); err != nil {
		return err
	}
	line := fmt.Sprintf(
		"%s %s %s %s\n",
		time.Now().UTC().Format(time.RFC3339Nano),
		spec.level,
		spec.category,
		event,
	)
	if err := rotateEventLogIfNeeded(path, int64(len(line))); err != nil {
		return err
	}
	file, err := os.OpenFile(
		path,
		os.O_APPEND|os.O_CREATE|os.O_WRONLY|noFollowOpenFlag(),
		0o600,
	)
	if err != nil {
		return fmt.Errorf("open event log: %w", err)
	}
	info, err := file.Stat()
	if err != nil {
		file.Close()
		return fmt.Errorf("inspect opened event log: %w", err)
	}
	if !info.Mode().IsRegular() {
		file.Close()
		return fmt.Errorf("event log must be a regular file")
	}
	if err := file.Chmod(0o600); err != nil {
		file.Close()
		return fmt.Errorf("protect event log: %w", err)
	}
	if _, err := file.WriteString(line); err != nil {
		file.Close()
		return fmt.Errorf("write event log: %w", err)
	}
	if err := file.Sync(); err != nil {
		file.Close()
		return fmt.Errorf("sync event log: %w", err)
	}
	if err := file.Close(); err != nil {
		return fmt.Errorf("close event log: %w", err)
	}
	return nil
}

func ensureEventLogDirectory(directory string) error {
	if err := os.Mkdir(directory, 0o700); err != nil && !errors.Is(err, os.ErrExist) {
		return fmt.Errorf("create event log directory: %w", err)
	}
	info, err := os.Lstat(directory)
	if err != nil {
		return fmt.Errorf("inspect event log directory: %w", err)
	}
	if info.Mode()&os.ModeSymlink != 0 || !info.IsDir() {
		return fmt.Errorf("event log directory must be a real directory")
	}
	if err := os.Chmod(directory, 0o700); err != nil {
		return fmt.Errorf("protect event log directory: %w", err)
	}
	return nil
}

// OpenBackendLogFile opens the plain-text mirror of the Go runtime log next to
// milksu.log. Finder-launched apps keep no stdout, so backend diagnostics must
// reach disk on their own or a killed sidecar leaves no reason to inspect.
func OpenBackendLogFile(dataDirectory string) (*os.File, error) {
	directory := filepath.Join(dataDirectory, "runtime")
	if err := ensureEventLogDirectory(directory); err != nil {
		return nil, err
	}
	file, err := os.OpenFile(
		filepath.Join(directory, filepath.Base(backendLogRelativePath)),
		os.O_APPEND|os.O_CREATE|os.O_WRONLY|noFollowOpenFlag(),
		0o600,
	)
	if err != nil {
		return nil, fmt.Errorf("open backend log: %w", err)
	}
	if err := file.Chmod(0o600); err != nil {
		file.Close()
		return nil, fmt.Errorf("protect backend log: %w", err)
	}
	return file, nil
}

func rotateEventLogIfNeeded(path string, additionalBytes int64) error {
	info, err := os.Lstat(path)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("inspect event log: %w", err)
	}
	if info.Mode()&os.ModeSymlink != 0 || !info.Mode().IsRegular() {
		return fmt.Errorf("event log must be a regular file")
	}
	if info.Size()+additionalBytes <= maxEventLogBytes {
		return nil
	}
	archived := path + ".1"
	if err := os.Remove(archived); err != nil && !errors.Is(err, os.ErrNotExist) {
		return fmt.Errorf("clear archived event log: %w", err)
	}
	if err := os.Rename(path, archived); err != nil {
		return fmt.Errorf("archive event log: %w", err)
	}
	return nil
}
