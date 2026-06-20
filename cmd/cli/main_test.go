package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestRejectsPathSeparatorInID(t *testing.T) {
	for _, id := range []string{"../etc/passwd", "foo/bar", `foo\bar`} {
		if err := validateID("project_id", id); err == nil {
			t.Errorf("expected rejection for %q", id)
		}
	}
}

func TestRejectsControlChars(t *testing.T) {
	for _, id := range []string{"foo\x00bar", "foo\x1bbar", "foo\nbar"} {
		if err := validateID("session_id", id); err == nil {
			t.Errorf("expected rejection for control char in %q", id)
		}
	}
}

func TestRejectsEmptyAndDotDot(t *testing.T) {
	for _, id := range []string{"", "..", "."} {
		if err := validateID("session_id", id); err == nil {
			t.Errorf("expected rejection for %q", id)
		}
	}
}

func TestRejectsTooLong(t *testing.T) {
	if err := validateID("session_id", strings.Repeat("a", maxIDLen+1)); err == nil {
		t.Error("expected rejection for over-length id")
	}
}

func TestAcceptsValidIDs(t *testing.T) {
	if err := validateID("project_id", "-Users-name-project"); err != nil {
		t.Errorf("unexpected: %v", err)
	}
	if err := validateID("session_id", "abc-123_v2.5"); err != nil {
		t.Errorf("unexpected: %v", err)
	}
}

func TestValidateUnderRootRejectsOutside(t *testing.T) {
	root := t.TempDir()
	outside := filepath.Dir(root) // parent of root is not under root
	if _, err := validateUnderRoot(outside, root); err == nil {
		t.Error("expected outside-root rejection")
	}
	// A child IS under root.
	child := filepath.Join(root, "child")
	if err := os.Mkdir(child, 0o755); err != nil {
		t.Fatal(err)
	}
	if _, err := validateUnderRoot(child, root); err != nil {
		t.Errorf("child should be under root: %v", err)
	}
}

// No-CLAUDE_HOME guard (momus L2): the CLI must not read CLAUDE_HOME.
func TestIgnoresClaudeHomeOverride(t *testing.T) {
	t.Setenv("CLAUDE_HOME", "/nonexistent/evil")
	c, err := claudeDir()
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(c, "evil") {
		t.Errorf("claudeDir must ignore CLAUDE_HOME, got %q", c)
	}
}
