package watcher

import (
	"os"
	"path/filepath"
	"strings"

	"github.com/rjeczalik/notify"
)

// MapEventKind maps a notify.Event bitmask to a change-type string.
// Returns ("", false) for events we do not care about (e.g. access, chmod).
// Rename is treated as unlink (the old name disappears), matching Rust.
func MapEventKind(e notify.Event) (string, bool) {
	switch {
	case e&notify.Create != 0:
		return "add", true
	case e&notify.Write != 0:
		return "change", true
	case e&notify.Remove != 0:
		return "unlink", true
	case e&notify.Rename != 0:
		return "unlink", true
	default:
		return "", false
	}
}

// ParseProjectFile parses a projects-directory absolute path into a
// FileChangeEvent. Returns nil for paths that don't match known structures.
//
// Supported structures (relative to projectsDir):
//
//	projectId/sessionId.jsonl                        → session file
//	projectId/sessionId/subagents/agent-hash.jsonl   → subagent file
func ParseProjectFile(projectsDir, filePath, changeType string) *FileChangeEvent {
	rel, err := filepath.Rel(projectsDir, filePath)
	if err != nil || strings.HasPrefix(rel, "..") || rel == "." {
		return nil
	}
	parts := strings.Split(filepath.ToSlash(rel), "/")

	filename := parts[len(parts)-1]
	if !strings.HasSuffix(filename, ".jsonl") {
		return nil
	}

	projectID := parts[0]

	var sessionID string
	var isSubagent bool

	switch len(parts) {
	case 2:
		// projectId/sessionId.jsonl
		sessionID = strings.TrimSuffix(filename, ".jsonl")
	case 4:
		// projectId/sessionId/subagents/agent-hash.jsonl
		if parts[2] != "subagents" {
			return nil
		}
		sessionID = parts[1]
		isSubagent = true
	default:
		return nil
	}

	pid := projectID
	sid := sessionID
	return &FileChangeEvent{
		Type:       changeType,
		Path:       filePath,
		ProjectID:  &pid,
		SessionID:  &sid,
		IsSubagent: isSubagent,
	}
}

// ParseTodoFile parses a todos-directory absolute path into a FileChangeEvent.
// Returns nil if the file is not a .json file.
//
// Expected structure: sessionId.json (flat directory, non-recursive watch).
func ParseTodoFile(todosDir, filePath, changeType string) *FileChangeEvent {
	rel, err := filepath.Rel(todosDir, filePath)
	if err != nil || strings.HasPrefix(rel, "..") || rel == "." {
		return nil
	}
	// filepath.ToSlash ensures "/" even on Windows (future-proofing).
	filename := filepath.ToSlash(rel)
	if !strings.HasSuffix(filename, ".json") {
		return nil
	}
	sessionID := strings.TrimSuffix(filename, ".json")
	sid := sessionID
	return &FileChangeEvent{
		Type:      changeType,
		Path:      filePath,
		SessionID: &sid,
	}
}

// ResolveClaudeDir returns the .claude root directory, checking CLAUDE_ROOT
// env var first. Mirrors lifecycle.rs::resolve_claude_dir.
func ResolveClaudeDir() (string, bool) {
	if root := os.Getenv("CLAUDE_ROOT"); root != "" {
		if _, err := os.Stat(root); err == nil {
			return root, true
		}
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return "", false
	}
	return filepath.Join(home, ".claude"), true
}
