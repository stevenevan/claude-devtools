// Package files ports commands/path_util.rs and commands/files.rs.
// This file is the SECURITY BOUNDARY for @-mention path validation.
// All guards are ported verbatim from Rust — do NOT weaken them.
package files

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"

	"claude-devtools/internal/discovery"
)

// Error sentinel strings match path_util.rs verbatim.
const (
	ErrInvalidSessionID  = "invalid session id"
	ErrInvalidProjectID  = "invalid project id"
	ErrInvalidSubagentID = "invalid subagent id"
	ErrEscapesRoot       = "path escapes session root"
)

// ValidateSessionIDPair validates a project+session pair without touching the
// filesystem. Call before any cache lookup keyed on these IDs.
// Mirrors path_util.rs::validate_session_id_pair.
func ValidateSessionIDPair(projectID, sessionID string) error {
	if !discovery.IsValidSessionID(sessionID) {
		return fmt.Errorf("%s", ErrInvalidSessionID)
	}
	if !discovery.IsValidProjectID(projectID) {
		return fmt.Errorf("%s", ErrInvalidProjectID)
	}
	return nil
}

// Confine checks that candidate, once canonicalized, is contained within
// canonicalRoot. Non-existent candidates are returned unchanged — legitimate
// first-time create flows rely on this.
// Mirrors path_util.rs::confine VERBATIM.
func Confine(candidate, canonicalRoot string) (string, error) {
	if _, err := os.Stat(candidate); os.IsNotExist(err) {
		return candidate, nil
	}
	canon, err := filepath.EvalSymlinks(candidate)
	if err != nil {
		return "", fmt.Errorf("%s", ErrEscapesRoot)
	}
	rel, err := filepath.Rel(canonicalRoot, canon)
	if err != nil {
		return "", fmt.Errorf("%s", ErrEscapesRoot)
	}
	// rel must not start with ".." to stay within root.
	if len(rel) >= 2 && rel[0] == '.' && rel[1] == '.' {
		return "", fmt.Errorf("%s", ErrEscapesRoot)
	}
	return canon, nil
}

// ResolveSessionPath resolves a session JSONL path within canonicalRoot.
// Mirrors path_util.rs::resolve_session_path.
func ResolveSessionPath(canonicalRoot, projectID, sessionID string) (string, error) {
	if err := ValidateSessionIDPair(projectID, sessionID); err != nil {
		return "", err
	}
	base := discovery.ExtractBaseDir(projectID)
	candidate := filepath.Join(canonicalRoot, base, sessionID+".jsonl")
	return Confine(candidate, canonicalRoot)
}

// ResolveSubagentPath resolves a subagent JSONL path within canonicalRoot.
// Mirrors path_util.rs::resolve_subagent_path.
func ResolveSubagentPath(canonicalRoot, projectID, sessionID, subagentID string) (string, error) {
	if err := ValidateSessionIDPair(projectID, sessionID); err != nil {
		return "", err
	}
	if !discovery.IsValidSessionID(subagentID) {
		return "", fmt.Errorf("%s", ErrInvalidSubagentID)
	}
	base := discovery.ExtractBaseDir(projectID)
	// New layout: {base}/{sessionID}/subagents/{subagentID}.jsonl
	candidate := filepath.Join(canonicalRoot, base, sessionID, "subagents", subagentID+".jsonl")
	return Confine(candidate, canonicalRoot)
}

// ---------------------------------------------------------------------------
// files.rs — file-system readers
// ---------------------------------------------------------------------------

// PathResult mirrors the JSON shape from validate_path.
type PathResult struct {
	Exists      bool `json:"exists"`
	IsDirectory bool `json:"isDirectory"`
}

// ValidatePath checks whether relPath exists inside projectPath and returns
// traversal-safe existence + isDirectory. Mirrors files.rs::validate_path.
func ValidatePath(relPath, projectPath string) PathResult {
	joined := filepath.Join(projectPath, relPath)

	baseCan, err1 := filepath.EvalSymlinks(projectPath)
	can, err2 := filepath.EvalSymlinks(joined)
	if err1 == nil && err2 == nil {
		rel, err := filepath.Rel(baseCan, can)
		if err != nil || (len(rel) >= 2 && rel[0] == '.' && rel[1] == '.') {
			return PathResult{Exists: false}
		}
	}

	info, err := os.Stat(joined)
	if err != nil {
		return PathResult{Exists: false}
	}
	return PathResult{Exists: true, IsDirectory: info.IsDir()}
}

// MentionValidation maps mention value → exists bool.
type MentionValidation map[string]bool

// ValidateMentions checks each mention's "value" field against projectPath.
// Mirrors files.rs::validate_mentions.
func ValidateMentions(mentions []map[string]any, projectPath string) MentionValidation {
	result := make(MentionValidation, len(mentions))
	for _, m := range mentions {
		val, ok := m["value"].(string)
		if !ok {
			continue
		}
		joined := filepath.Join(projectPath, val)
		_, err := os.Stat(joined)
		result[val] = err == nil
	}
	return result
}

// ClaudeMdFile is one entry in the ReadClaudeMdFiles result.
type ClaudeMdFile struct {
	Path    string `json:"path"`
	Content string `json:"content"`
	Exists  bool   `json:"exists"`
}

// ReadClaudeMdFiles reads global + project CLAUDE.md + .claude/rules/*.md.
// Mirrors files.rs::read_claude_md_files.
func ReadClaudeMdFiles(projectRoot string) map[string]ClaudeMdFile {
	files := make(map[string]ClaudeMdFile)

	if home, err := os.UserHomeDir(); err == nil {
		global := filepath.Join(home, ".claude", "CLAUDE.md")
		if content, err := os.ReadFile(global); err == nil {
			files["global"] = ClaudeMdFile{Path: global, Content: string(content), Exists: true}
		}
	}

	projectMd := filepath.Join(projectRoot, "CLAUDE.md")
	if content, err := os.ReadFile(projectMd); err == nil {
		files["project"] = ClaudeMdFile{Path: projectMd, Content: string(content), Exists: true}
	}

	rulesDir := filepath.Join(projectRoot, ".claude", "rules")
	entries, err := os.ReadDir(rulesDir)
	if err == nil {
		sort.Slice(entries, func(i, j int) bool {
			return entries[i].Name() < entries[j].Name()
		})
		for _, e := range entries {
			if e.IsDir() || filepath.Ext(e.Name()) != ".md" {
				continue
			}
			p := filepath.Join(rulesDir, e.Name())
			if content, err := os.ReadFile(p); err == nil {
				key := "rules/" + e.Name()
				files[key] = ClaudeMdFile{Path: p, Content: string(content), Exists: true}
			}
		}
	}

	return files
}

// ReadDirectoryClaudeMd reads CLAUDE.md inside a single directory.
// Mirrors files.rs::read_directory_claude_md.
func ReadDirectoryClaudeMd(dirPath string) ClaudeMdFile {
	mdPath := filepath.Join(dirPath, "CLAUDE.md")
	content, err := os.ReadFile(mdPath)
	if err != nil {
		return ClaudeMdFile{Path: mdPath, Content: "", Exists: false}
	}
	return ClaudeMdFile{Path: mdPath, Content: string(content), Exists: true}
}

// MentionedFileResult mirrors files.rs::read_mentioned_file JSON shape.
type MentionedFileResult struct {
	Path      string `json:"path"`
	Content   string `json:"content"`
	Exists    bool   `json:"exists"`
	Tokens    int    `json:"tokens"`
	Truncated bool   `json:"truncated"`
}

const defaultMaxTokens = 100_000

// ReadMentionedFile reads a file after canonicalization-checks against projectRoot.
// Returns nil when the path escapes the root or the file doesn't exist.
// Mirrors files.rs::read_mentioned_file.
func ReadMentionedFile(absolutePath, projectRoot string, maxTokens *int) *MentionedFileResult {
	cp, err1 := filepath.EvalSymlinks(absolutePath)
	cr, err2 := filepath.EvalSymlinks(projectRoot)
	if err1 == nil && err2 == nil {
		rel, err := filepath.Rel(cr, cp)
		if err != nil || (len(rel) >= 2 && rel[0] == '.' && rel[1] == '.') {
			return nil
		}
	}

	info, err := os.Stat(absolutePath)
	if err != nil || info.IsDir() {
		return nil
	}

	raw, err := os.ReadFile(absolutePath)
	if err != nil {
		return nil
	}

	content := string(raw)
	max := defaultMaxTokens
	if maxTokens != nil {
		max = *maxTokens
	}
	tokens := (len(content) + 3) / 4 // div_ceil(4)
	truncated := tokens > max
	final := content
	if truncated {
		final = content[:max*4]
	}

	return &MentionedFileResult{
		Path:      absolutePath,
		Content:   final,
		Exists:    true,
		Tokens:    tokens,
		Truncated: truncated,
	}
}

// ---------------------------------------------------------------------------
// agents_search/configs.rs
// ---------------------------------------------------------------------------

// AgentConfig mirrors one entry in read_agent_configs.
type AgentConfig struct {
	Content string `json:"content"`
	Path    string `json:"path"`
}

// ReadAgentConfigs reads .claude/agents/*.md relative to projectRoot.
// Mirrors configs.rs::read_agent_configs.
func ReadAgentConfigs(projectRoot string) map[string]AgentConfig {
	out := make(map[string]AgentConfig)
	agentsDir := filepath.Join(projectRoot, ".claude", "agents")
	entries, err := os.ReadDir(agentsDir)
	if err != nil {
		return out
	}
	for _, e := range entries {
		if e.IsDir() || filepath.Ext(e.Name()) != ".md" {
			continue
		}
		p := filepath.Join(agentsDir, e.Name())
		content, err := os.ReadFile(p)
		if err != nil {
			continue
		}
		name := e.Name()[:len(e.Name())-3] // strip .md
		out[name] = AgentConfig{Content: string(content), Path: p}
	}
	return out
}

// parseFrontmatter parses YAML-like frontmatter from markdown.
// Mirrors configs.rs::parse_frontmatter.
func parseFrontmatter(content string) map[string]string {
	out := make(map[string]string)
	// trim leading whitespace
	s := content
	for len(s) > 0 && (s[0] == ' ' || s[0] == '\t' || s[0] == '\n' || s[0] == '\r') {
		s = s[1:]
	}
	if !hasPrefixStr(s, "---") {
		return out
	}
	rest := s[3:]
	end := indexSubstr(rest, "\n---")
	if end < 0 {
		return out
	}
	block := rest[:end]
	for _, line := range splitLines(block) {
		trimmed := trimWhitespace(line)
		ci := -1
		for j, ch := range trimmed {
			if ch == ':' {
				ci = j
				break
			}
		}
		if ci < 0 {
			continue
		}
		key := trimWhitespace(trimmed[:ci])
		val := trimWhitespace(trimmed[ci+1:])
		if key != "" {
			out[key] = val
		}
	}
	return out
}

// GlobalAgent mirrors one entry in read_global_agents.
type GlobalAgent struct {
	Name        string `json:"name"`
	Description string `json:"description"`
	Tools       string `json:"tools"`
	Model       string `json:"model"`
	FilePath    string `json:"filePath"`
	Content     string `json:"content"`
}

// claudeDir returns ~/.claude.
func claudeDir() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("cannot resolve home directory")
	}
	return filepath.Join(home, ".claude"), nil
}

// ReadGlobalAgents reads ~/.claude/agents/*.md. Mirrors configs.rs::read_global_agents.
func ReadGlobalAgents() ([]GlobalAgent, error) {
	cd, err := claudeDir()
	if err != nil {
		return nil, err
	}
	agentsDir := filepath.Join(cd, "agents")

	var out []GlobalAgent
	entries, err := os.ReadDir(agentsDir)
	if err != nil {
		return []GlobalAgent{}, nil
	}
	for _, e := range entries {
		if e.IsDir() || filepath.Ext(e.Name()) != ".md" {
			continue
		}
		p := filepath.Join(agentsDir, e.Name())
		content, err := os.ReadFile(p)
		if err != nil {
			continue
		}
		fm := parseFrontmatter(string(content))
		name := fm["name"]
		if name == "" {
			name = e.Name()[:len(e.Name())-3]
		}
		out = append(out, GlobalAgent{
			Name:        name,
			Description: fm["description"],
			Tools:       fm["tools"],
			Model:       fm["model"],
			FilePath:    p,
			Content:     string(content),
		})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Name < out[j].Name })
	return out, nil
}

// GlobalSkill mirrors one entry in read_global_skills.
type GlobalSkill struct {
	Name          string `json:"name"`
	Description   string `json:"description"`
	UserInvocable bool   `json:"userInvocable"`
	ResolvedPath  string `json:"resolvedPath"`
	SymlinkPath   string `json:"symlinkPath"`
}

// ReadGlobalSkills reads ~/.claude/skills/. Mirrors configs.rs::read_global_skills.
func ReadGlobalSkills() ([]GlobalSkill, error) {
	cd, err := claudeDir()
	if err != nil {
		return nil, err
	}
	skillsDir := filepath.Join(cd, "skills")

	var out []GlobalSkill
	entries, err := os.ReadDir(skillsDir)
	if err != nil {
		return []GlobalSkill{}, nil
	}
	for _, e := range entries {
		if e.Name()[0] == '.' {
			continue
		}
		symlinkPath := filepath.Join(skillsDir, e.Name())
		resolvedPath, err := filepath.EvalSymlinks(symlinkPath)
		if err != nil {
			continue
		}
		info, err := os.Stat(resolvedPath)
		if err != nil || !info.IsDir() {
			continue
		}
		desc := ""
		userInvocable := false
		skillMd := filepath.Join(resolvedPath, "SKILL.md")
		if _, err := os.Stat(skillMd); err == nil {
			if content, err := os.ReadFile(skillMd); err == nil {
				fm := parseFrontmatter(string(content))
				desc = fm["description"]
				userInvocable = fm["user-invocable"] == "true"
			}
		}
		out = append(out, GlobalSkill{
			Name:          e.Name(),
			Description:   desc,
			UserInvocable: userInvocable,
			ResolvedPath:  resolvedPath,
			SymlinkPath:   symlinkPath,
		})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Name < out[j].Name })
	return out, nil
}

// Plugin mirrors one entry in the installed_plugins.json result.
type Plugin struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Marketplace string `json:"marketplace"`
	Version     string `json:"version"`
	InstalledAt string `json:"installedAt"`
	LastUpdated string `json:"lastUpdated"`
	Enabled     bool   `json:"enabled"`
}

// ReadGlobalPlugins reads ~/.claude/plugins/installed_plugins.json.
// Mirrors configs.rs::read_global_plugins.
func ReadGlobalPlugins() ([]Plugin, error) {
	cd, err := claudeDir()
	if err != nil {
		return nil, err
	}

	pluginsFile := filepath.Join(cd, "plugins", "installed_plugins.json")
	if _, err := os.Stat(pluginsFile); os.IsNotExist(err) {
		return []Plugin{}, nil
	}

	raw, err := os.ReadFile(pluginsFile)
	if err != nil {
		return nil, err
	}

	var data map[string]any
	if err := json.Unmarshal(raw, &data); err != nil {
		return nil, err
	}

	// Read enabledPlugins from settings.json.
	enabled := make(map[string]bool)
	settingsFile := filepath.Join(cd, "settings.json")
	if raw2, err := os.ReadFile(settingsFile); err == nil {
		var settings map[string]any
		if json.Unmarshal(raw2, &settings) == nil {
			if ep, ok := settings["enabledPlugins"].(map[string]any); ok {
				for k, v := range ep {
					if b, ok := v.(bool); ok && b {
						enabled[k] = true
					}
				}
			}
		}
	}

	var out []Plugin
	if plugins, ok := data["plugins"].(map[string]any); ok {
		keys := make([]string, 0, len(plugins))
		for k := range plugins {
			keys = append(keys, k)
		}
		sort.Strings(keys)

		for _, key := range keys {
			entries, ok := plugins[key].([]any)
			if !ok || len(entries) == 0 {
				continue
			}
			entry, ok := entries[0].(map[string]any)
			if !ok {
				continue
			}

			name := key
			marketplace := ""
			if at := indexRune(key, '@'); at >= 0 {
				name = key[:at]
				marketplace = key[at+1:]
			}

			isEnabled := enabled[key] || enabled[name]

			out = append(out, Plugin{
				ID:          key,
				Name:        name,
				Marketplace: marketplace,
				Version:     strField(entry, "version"),
				InstalledAt: strField(entry, "installedAt"),
				LastUpdated: strField(entry, "lastUpdated"),
				Enabled:     isEnabled,
			})
		}
	}

	sort.Slice(out, func(i, j int) bool { return out[i].Name < out[j].Name })
	return out, nil
}

// ReadGlobalSettings reads ~/.claude/settings.json.
// Mirrors configs.rs::read_global_settings.
func ReadGlobalSettings() (any, error) {
	cd, err := claudeDir()
	if err != nil {
		return nil, err
	}
	settingsFile := filepath.Join(cd, "settings.json")
	if _, err := os.Stat(settingsFile); os.IsNotExist(err) {
		return map[string]any{}, nil
	}
	raw, err := os.ReadFile(settingsFile)
	if err != nil {
		return nil, err
	}
	var v any
	if err := json.Unmarshal(raw, &v); err != nil {
		return nil, err
	}
	return v, nil
}

// ---------------------------------------------------------------------------
// String helpers
// ---------------------------------------------------------------------------

func strField(m map[string]any, k string) string {
	if v, ok := m[k].(string); ok {
		return v
	}
	return ""
}

func indexRune(s string, r rune) int {
	for i, ch := range s {
		if ch == r {
			return i
		}
	}
	return -1
}

func hasPrefixStr(s, prefix string) bool {
	return len(s) >= len(prefix) && s[:len(prefix)] == prefix
}

func indexSubstr(s, sub string) int {
	if len(sub) > len(s) {
		return -1
	}
	for i := 0; i <= len(s)-len(sub); i++ {
		if s[i:i+len(sub)] == sub {
			return i
		}
	}
	return -1
}

func splitLines(s string) []string {
	var lines []string
	start := 0
	for i := 0; i < len(s); i++ {
		if s[i] == '\n' {
			lines = append(lines, s[start:i])
			start = i + 1
		}
	}
	if start < len(s) {
		lines = append(lines, s[start:])
	}
	return lines
}

func trimWhitespace(s string) string {
	for len(s) > 0 && (s[0] == ' ' || s[0] == '\t' || s[0] == '\r' || s[0] == '\n') {
		s = s[1:]
	}
	for len(s) > 0 && (s[len(s)-1] == ' ' || s[len(s)-1] == '\t' || s[len(s)-1] == '\r' || s[len(s)-1] == '\n') {
		s = s[:len(s)-1]
	}
	return s
}
