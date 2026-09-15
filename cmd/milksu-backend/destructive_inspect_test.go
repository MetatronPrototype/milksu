package main

import (
	"os"
	"os/exec"
	"path/filepath"
	"testing"
)

func newInspectApp(t *testing.T) *App {
	t.Helper()
	return &App{}
}

func TestInspectDestructiveTargetMissingIsDistinctFromNoBackup(t *testing.T) {
	app := newInspectApp(t)
	result, err := app.InspectDestructiveTarget(filepath.Join(t.TempDir(), "not-there"))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result.Status != "missing" || result.Exists {
		t.Fatalf("want missing status, got %#v", result)
	}
}

func TestInspectDestructiveTargetCountsFilesAndRejectsRelativePaths(t *testing.T) {
	app := newInspectApp(t)
	if _, err := app.InspectDestructiveTarget("relative/path"); err == nil {
		t.Fatal("a relative path must be rejected")
	}

	dir := t.TempDir()
	for index := 0; index < 3; index++ {
		file := filepath.Join(dir, "file.txt")
		if err := os.WriteFile(file, []byte("1234567890"), 0o600); err != nil {
			t.Fatalf("write fixture: %v", err)
		}
	}

	result, err := app.InspectDestructiveTarget(dir)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result.Status != "ok" || !result.IsDirectory || result.EmptyDirectory {
		t.Fatalf("want a non-empty directory, got %#v", result)
	}
	if result.FileCount < 2 || result.TotalBytes <= 0 {
		t.Fatalf("want measured size, got %#v", result)
	}
	if result.Sampled {
		t.Fatalf("a small directory must not be sampled: %#v", result)
	}
}

func TestInspectDestructiveTargetReportsEmptyDirectory(t *testing.T) {
	app := newInspectApp(t)
	dir := t.TempDir()
	result, err := app.InspectDestructiveTarget(dir)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !result.EmptyDirectory {
		t.Fatalf("want an empty directory, got %#v", result)
	}
}

func TestInspectDestructiveTargetDetectsGitTracking(t *testing.T) {
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git is not available")
	}
	app := newInspectApp(t)
	repo := t.TempDir()
	run := func(args ...string) {
		command := exec.Command("git", args...)
		command.Dir = repo
		command.Env = append(os.Environ(), "GIT_AUTHOR_NAME=t", "GIT_AUTHOR_EMAIL=t@t", "GIT_COMMITTER_NAME=t", "GIT_COMMITTER_EMAIL=t@t")
		if output, err := command.CombinedOutput(); err != nil {
			t.Fatalf("git %v: %v (%s)", args, err, output)
		}
	}
	run("-c", "commit.gpgsign=false", "init", "-q")
	tracked := filepath.Join(repo, "tracked.txt")
	untracked := filepath.Join(repo, "untracked.txt")
	if err := os.WriteFile(tracked, []byte("a"), 0o600); err != nil {
		t.Fatalf("write: %v", err)
	}
	if err := os.WriteFile(untracked, []byte("b"), 0o600); err != nil {
		t.Fatalf("write: %v", err)
	}
	run("-c", "commit.gpgsign=false", "add", "tracked.txt")
	run("-c", "commit.gpgsign=false", "commit", "-q", "-m", "init")

	trackedResult, err := app.InspectDestructiveTarget(tracked)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !trackedResult.InGitRepository || !trackedResult.GitTracked || !trackedResult.Rebuildable {
		t.Fatalf("a tracked file must be recoverable: %#v", trackedResult)
	}

	untrackedResult, err := app.InspectDestructiveTarget(untracked)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !untrackedResult.InGitRepository || untrackedResult.GitTracked {
		t.Fatalf("an untracked file must not be reported as tracked: %#v", untrackedResult)
	}
	if untrackedResult.Rebuildable {
		t.Fatalf("an untracked file without backups is not rebuildable: %#v", untrackedResult)
	}
}

func TestInspectDestructiveTargetFindsSiblingBackups(t *testing.T) {
	app := newInspectApp(t)
	dir := t.TempDir()
	target := filepath.Join(dir, "MilkSU Beta Test.app")
	if err := os.MkdirAll(target, 0o700); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	backup := filepath.Join(dir, ".MilkSU Beta Test.app.bak-20260914-112838")
	if err := os.MkdirAll(backup, 0o700); err != nil {
		t.Fatalf("mkdir backup: %v", err)
	}

	result, err := app.InspectDestructiveTarget(target)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(result.Backups) != 1 || result.Backups[0] != backup {
		t.Fatalf("want the sibling backup, got %#v", result.Backups)
	}
	if !result.Rebuildable {
		t.Fatalf("a target with a sibling backup is rebuildable: %#v", result)
	}
}
