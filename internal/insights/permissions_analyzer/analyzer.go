// Package permissions_analyzer (W30) mines the user's OWN structured tool_use
// records to SUGGEST permission-allow rules. Security-critical: suggestions
// derive ONLY from structured tool_use records (things a session actually
// invoked) — NEVER from conversation free text, message content, or
// history.jsonl. The root claude directory is threaded by the caller; nothing
// is ever written (suggestions only).
package permissions_analyzer

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"claude-devtools/internal/discovery"
	"claude-devtools/internal/domain"
	"claude-devtools/internal/parsing"
)

// Recurrence gate: a candidate rule is only suggested when it recurs enough to
// be a habit rather than a one-off — at least minEvidenceCount invocations
// spread across at least minSessionCount distinct sessions.
const (
	minEvidenceCount = 5
	minSessionCount  = 3
	maxSamples       = 3
	maxSampleLen     = 200
	listAllow        = "allow"
)

// Suggestion is a proposed permission-allow rule mined from tool_use records.
// List is always "allow". EvidenceCount is the total invocation count;
// SessionCount is the number of distinct sessions the rule was observed in;
// Samples holds up to a few example invocation strings for the reviewer.
type Suggestion struct {
	Rule          string   `json:"rule"`
	List          string   `json:"list"`
	EvidenceCount int      `json:"evidenceCount"`
	SessionCount  int      `json:"sessionCount"`
	Samples       []string `json:"samples"`
}

// cmdStat accumulates evidence for a single candidate key (an exact Bash
// command or a non-Bash tool name): total count, the distinct sessions it
// appeared in, and up to maxSamples example invocation strings.
type cmdStat struct {
	count    int
	sessions map[string]struct{}
	samples  []string
}

// AnalyzeUsage enumerates every project under root's projects directory, streams
// each session file through the parser, and returns narrowest-match permission
// suggestions mined ONLY from structured tool_use records. Rules already present
// in root's settings.json permissions.allow are skipped. The returned slice is
// never nil.
func AnalyzeUsage(root string) ([]Suggestion, error) {
	base := discovery.GetProjectsBasePath(root)
	existing := loadExistingAllowRules(root)

	bashCommands := map[string]*cmdStat{}
	nonBashTools := map[string]*cmdStat{}

	entries, err := os.ReadDir(base)
	if err != nil {
		if os.IsNotExist(err) {
			return []Suggestion{}, nil
		}
		return nil, fmt.Errorf("permissions_analyzer: read projects dir: %w", err)
	}

	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		// A single unreadable/malformed project must not fail the whole scan.
		scanProjectDir(filepath.Join(base, entry.Name()), bashCommands, nonBashTools)
	}

	suggestions := []Suggestion{}
	suggestions = append(suggestions, deriveBashSuggestions(bashCommands, existing)...)
	suggestions = append(suggestions, deriveNonBashSuggestions(nonBashTools, existing)...)
	sort.Slice(suggestions, func(i, j int) bool {
		return suggestions[i].Rule < suggestions[j].Rule
	})
	return suggestions, nil
}

// scanProjectDir walks a project's *.jsonl session files and records every
// structured tool_use call. Errors on a single file are tolerated (skip and
// continue) so one corrupt session cannot poison the aggregate.
func scanProjectDir(projectDir string, bashCommands, nonBashTools map[string]*cmdStat) {
	files, err := os.ReadDir(projectDir)
	if err != nil {
		return
	}
	for _, f := range files {
		name := f.Name()
		if f.IsDir() || !strings.HasSuffix(name, ".jsonl") {
			continue
		}
		path := filepath.Join(projectDir, name)
		parsed, err := parsing.ParseSessionFile(path)
		if err != nil {
			continue
		}
		for i := range parsed.Messages {
			for _, tc := range parsed.Messages[i].ToolCalls {
				recordToolCall(tc, path, bashCommands, nonBashTools)
			}
		}
	}
}

// recordToolCall aggregates one structured tool_use call. Bash calls are keyed
// by their exact command string; every other tool is keyed by its name. The
// session key is the session file path (unique per session). Only tool_use
// input is read — never message text.
func recordToolCall(tc domain.ToolCall, sessionKey string, bashCommands, nonBashTools map[string]*cmdStat) {
	if tc.Name == "Bash" {
		cmd := extractBashCommand(tc.Input)
		if cmd == "" {
			return
		}
		addStat(bashCommands, cmd, sessionKey, truncateSample(cmd))
		return
	}
	if tc.Name == "" {
		return
	}
	addStat(nonBashTools, tc.Name, sessionKey, truncateSample(toolSample(tc)))
}

// addStat records one invocation of key: bump count, note the session, and
// keep up to maxSamples distinct example strings.
func addStat(m map[string]*cmdStat, key, sessionKey, sample string) {
	st := m[key]
	if st == nil {
		st = &cmdStat{sessions: map[string]struct{}{}}
		m[key] = st
	}
	st.count++
	st.sessions[sessionKey] = struct{}{}
	if len(st.samples) < maxSamples && !contains(st.samples, sample) {
		st.samples = append(st.samples, sample)
	}
}

// extractBashCommand decodes the tool_use input map and returns the trimmed
// "command" string. Anything malformed yields "" (skipped).
func extractBashCommand(input domain.RawValue) string {
	if len(input) == 0 {
		return ""
	}
	var m map[string]json.RawMessage
	if json.Unmarshal(input, &m) != nil {
		return ""
	}
	raw, ok := m["command"]
	if !ok {
		return ""
	}
	var cmd string
	if json.Unmarshal(raw, &cmd) != nil {
		return ""
	}
	return strings.TrimSpace(cmd)
}

// toolSample renders a compact example string for a non-Bash tool call from its
// structured input, falling back to the tool name when the input is empty.
func toolSample(tc domain.ToolCall) string {
	s := strings.TrimSpace(string(tc.Input))
	if s == "" || s == "null" {
		return tc.Name
	}
	return s
}

// loadExistingAllowRules reads root's settings.json and returns the set of rules
// already granted in permissions.allow — no point suggesting an existing grant.
// A missing or malformed file yields an empty set. Root is threaded (never the
// hardcoded ~/.claude), so the scan and the skip-set share one source of truth.
func loadExistingAllowRules(root string) map[string]bool {
	out := map[string]bool{}
	raw, err := os.ReadFile(filepath.Join(root, "settings.json"))
	if err != nil {
		return out
	}
	var parsed struct {
		Permissions struct {
			Allow []string `json:"allow"`
		} `json:"permissions"`
	}
	if json.Unmarshal(raw, &parsed) != nil {
		return out
	}
	for _, rule := range parsed.Permissions.Allow {
		out[rule] = true
	}
	return out
}
