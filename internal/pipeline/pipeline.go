// Package pipeline is the gate-path entry point: JSONL file → SessionDetail JSON,
// reproducing the Rust CLI's `show-session --format json` (cli.rs cmd_show_session).
package pipeline

import (
	"encoding/json"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"claude-devtools/internal/analysis"
	"claude-devtools/internal/domain"
	"claude-devtools/internal/parsing"
)

// BuildSessionDetail parses the session JSONL for (projectID, sessionID) and
// returns the SessionDetail struct, replicating the cli.rs:168-186 Session stub
// and passing an empty processes slice.
func BuildSessionDetail(projectID, sessionID string) (domain.SessionDetail, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return domain.SessionDetail{}, err
	}
	base := extractBaseDir(projectID)
	path := filepath.Join(home, ".claude", "projects", base, sessionID+".jsonl")

	messages, meta, err := parsing.ParseJSONLFile(path)
	if err != nil {
		return domain.SessionDetail{}, err
	}

	// cli.rs:168-186 — hardcoded stub fields; the rest are None (omitted).
	deep := "deep"
	ongoing := false
	session := domain.Session{
		ID:            sessionID,
		ProjectID:     projectID,
		ProjectPath:   decodePath(base),
		CreatedAt:     0.0,
		HasSubagents:  false,
		MessageCount:  uint32(len(messages)),
		IsOngoing:     &ongoing,
		MetadataLevel: &deep,
		CustomTitle:   meta.CustomTitle,
		AgentName:     meta.AgentName,
	}

	return analysis.BuildSessionDetail(session, messages, []domain.Process{}), nil
}

// BuildSessionDetailJSON returns the SessionDetail JSON, matching the Rust CLI
// byte-for-byte after key-sort normalization.
func BuildSessionDetailJSON(projectID, sessionID string) ([]byte, error) {
	detail, err := BuildSessionDetail(projectID, sessionID)
	if err != nil {
		return nil, err
	}
	return json.Marshal(detail)
}

var legacyWin = regexp.MustCompile(`^([a-zA-Z])--(.+)$`)

// decodePath mirrors path_decoder::decode_path (lossy: dashes → slashes).
func decodePath(encoded string) string {
	if encoded == "" {
		return ""
	}
	if c := legacyWin.FindStringSubmatch(encoded); c != nil {
		return strings.ToUpper(c[1]) + ":/" + strings.ReplaceAll(c[2], "-", "/")
	}
	without := encoded
	if strings.HasPrefix(encoded, "-") {
		without = encoded[1:]
	}
	decoded := strings.ReplaceAll(without, "-", "/")
	if len(decoded) >= 3 && decoded[1] == ':' && decoded[2] == '/' {
		return decoded
	}
	if strings.HasPrefix(decoded, "/") {
		return decoded
	}
	return "/" + decoded
}

func extractBaseDir(projectID string) string {
	if i := strings.Index(projectID, "::"); i >= 0 {
		return projectID[:i]
	}
	return projectID
}
