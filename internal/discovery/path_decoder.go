// Package discovery ports src-tauri/src/discovery/ to Go.
// This file: path_decoder.rs — encode/decode project directory names.
//
// Encoding: /Users/name/project → -Users-name-project (lossy — dashes are ambiguous).
// Reversible encoding: /Users/name/my-project → -Users-name-my%2Dproject (round-trips).
package discovery

import (
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

var legacyWinRe = regexp.MustCompile(`^([a-zA-Z])--(.+)$`)

// DecodePath decodes a project directory name to its original path (lossy).
// Mirrors path_decoder::decode_path.
func DecodePath(encodedName string) string {
	if encodedName == "" {
		return ""
	}

	// Legacy Windows format: "C--Users-name-project" → "C:/Users/name/project"
	if c := legacyWinRe.FindStringSubmatch(encodedName); c != nil {
		return strings.ToUpper(c[1]) + ":/" + strings.ReplaceAll(c[2], "-", "/")
	}

	without := encodedName
	if strings.HasPrefix(encodedName, "-") {
		without = encodedName[1:]
	}

	decoded := strings.ReplaceAll(without, "-", "/")

	// Windows drive: "C:/..."
	if len(decoded) >= 3 && decoded[1] == ':' && decoded[2] == '/' {
		return decoded
	}

	if strings.HasPrefix(decoded, "/") {
		return decoded
	}
	return "/" + decoded
}

// ExtractProjectName returns the last path segment as the project display name.
// If cwdHint is non-empty it takes precedence (allows recovering dashes lost in lossy encoding).
// Mirrors path_decoder::extract_project_name.
func ExtractProjectName(encodedName, cwdHint string) string {
	if cwdHint != "" {
		parts := strings.FieldsFunc(cwdHint, func(r rune) bool { return r == '/' || r == '\\' })
		if len(parts) > 0 {
			return parts[len(parts)-1]
		}
	}
	decoded := DecodePath(encodedName)
	parts := strings.FieldsFunc(decoded, func(r rune) bool { return r == '/' })
	if len(parts) > 0 {
		return parts[len(parts)-1]
	}
	return encodedName
}

// Validation constants mirror path_decoder.rs.
const (
	projectIDMaxLen = 512
	sessionIDLen    = 36
)

var (
	validEncodedRe  = regexp.MustCompile(`^-[a-zA-Z0-9_.\s:-]+$`)
	legacyWinValid  = regexp.MustCompile(`^[a-zA-Z]--[a-zA-Z0-9_.\s-]+$`)
	compositeHashRe = regexp.MustCompile(`^[a-f0-9]{8}$`)
	sessionIDRe     = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)
)

// IsValidSessionID validates a session ID: UUID-shaped, exactly 36 chars.
func IsValidSessionID(id string) bool {
	if len(id) != sessionIDLen {
		return false
	}
	return sessionIDRe.MatchString(id)
}

// IsValidProjectID validates a composite project ID `<encoded>` or `<encoded>::<8-hex>`.
func IsValidProjectID(projectID string) bool {
	if projectID == "" || len(projectID) > projectIDMaxLen {
		return false
	}
	if i := strings.Index(projectID, "::"); i >= 0 {
		base := projectID[:i]
		hash := projectID[i+2:]
		return IsValidEncodedPath(base) && compositeHashRe.MatchString(hash)
	}
	return IsValidEncodedPath(projectID)
}

// IsValidEncodedPath validates that a directory name follows Claude Code encoding.
func IsValidEncodedPath(encodedName string) bool {
	if encodedName == "" {
		return false
	}

	// Legacy Windows format is valid.
	if legacyWinValid.MatchString(encodedName) {
		return true
	}

	if !strings.HasPrefix(encodedName, "-") {
		return false
	}

	if !validEncodedRe.MatchString(encodedName) {
		return false
	}

	// Windows drive syntax: colon only allowed at position 2 (e.g. "-C:...") with no further colons.
	if i := strings.Index(encodedName, ":"); i >= 0 {
		if len(encodedName) < 3 || encodedName[2] != ':' {
			return false
		}
		if strings.Contains(encodedName[i+1:], ":") {
			return false
		}
	}

	return true
}

// ExtractBaseDir strips the `::hash` suffix from a composite project ID.
// Mirrors path_decoder::extract_base_dir.
func ExtractBaseDir(projectID string) string {
	if i := strings.Index(projectID, "::"); i >= 0 {
		return projectID[:i]
	}
	return projectID
}

// BuildTodoPath returns ~/.claude/todos/{sessionID}.json.
func BuildTodoPath(claudeBase, sessionID string) string {
	return filepath.Join(claudeBase, "todos", sessionID+".json")
}

// GetProjectsBasePath returns the projects directory under the Claude base dir.
func GetProjectsBasePath(claudeDir string) string {
	return filepath.Join(claudeDir, "projects")
}

// ClaudeDir returns the path to ~/.claude.
func ClaudeDir() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("cannot resolve home directory: %w", err)
	}
	return filepath.Join(home, ".claude"), nil
}

// ProjectsDir returns the path to ~/.claude/projects.
func ProjectsDir() (string, error) {
	cd, err := ClaudeDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(cd, "projects"), nil
}

