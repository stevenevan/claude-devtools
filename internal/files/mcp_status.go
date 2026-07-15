// mcp_status.go is the read-only aggregator behind the MCP Status Dashboard.
// It makes MCP server state visible across every place the CLI stores it —
// ~/.claude.json's top-level and per-project mcpServers, each project's
// on-disk .mcp.json, and the auth-needed connector cache — WITHOUT any write.
// Every command/url/args/env value is masked before it leaves this package
// (the same masking contract as claudejson.go), plus URL query-string
// credentials that maskJSONValue's key/value-prefix matching alone would miss.
package files

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"
)

// Source-kind literals for an MCP server row's provenance.
const (
	mcpSourceGlobal            = "global"             // top-level mcpServers in ~/.claude.json
	mcpSourceClaudeJSONProject = "claudejson-project" // projects[<path>].mcpServers in ~/.claude.json
	mcpSourceProjectMCPJSON    = "project-mcpjson"    // {root}/.mcp.json
	mcpSourceAuthCache         = "auth-cache"         // cache-only connector (no server source)
)

// mcpAuthCacheFile is the connector auth-needed cache the CLI maintains.
const mcpAuthCacheFile = "mcp-needs-auth-cache.json"

// millisPerDay converts an epoch-ms delta into whole days.
const millisPerDay = int64(86_400_000)

// mcpURLCredentialParam matches a credential-shaped query parameter and its
// value so the value can be masked. maskJSONValue only masks by secret key or
// a secret-value PREFIX, so a url like https://host?api_key=… slips through it
// unmasked; this closes that gap (the panel renders in remote/SSH mode too).
var mcpURLCredentialParam = regexp.MustCompile(`(?i)((?:api[_-]?key|apikey|token|secret|password|auth)=)[^&#\s]*`)

// MCPServerRow is one MCP server as surfaced by the dashboard. CommandOrURL is
// always masked. AuthNeeded/LastCheckedUnixMs/CacheAgeDays come from the
// auth-needed cache and are point-in-time, never asserted as current truth.
type MCPServerRow struct {
	Name              string `json:"name"`
	Transport         string `json:"transport"`
	SourceKind        string `json:"sourceKind"`
	SourcePath        string `json:"sourcePath"`
	CommandOrURL      string `json:"commandOrUrl"`
	AuthNeeded        bool   `json:"authNeeded"`
	LastCheckedUnixMs int64  `json:"lastCheckedUnixMs"`
	CacheAgeDays      int    `json:"cacheAgeDays"`
}

// MCPStatusView is the full read-only MCP status aggregate. MCPServersEmpty is
// true ONLY when no server appears in any of the three server sources (not
// merely when the top-level mcpServers is empty).
type MCPStatusView struct {
	Servers             []MCPServerRow `json:"servers"`
	MCPServersEmpty     bool           `json:"mcpServersEmpty"`
	ConnectorsFromCache []MCPServerRow `json:"connectorsFromCache"`
}

// mcpAuthEntry is a parsed, validated auth-cache record.
type mcpAuthEntry struct {
	lastCheckedUnixMs int64
	cacheAgeDays      int
}

// GetMCPStatus aggregates MCP server state from four best-effort sources — one
// failing source never fails the call. All project roots are derived server-side
// from ~/.claude.json's projects map keys, so the call takes no argument.
func GetMCPStatus() (MCPStatusView, error) {
	view := MCPStatusView{Servers: []MCPServerRow{}, ConnectorsFromCache: []MCPServerRow{}}

	path, err := claudeJSONPath()
	if err != nil {
		return view, err
	}
	data, err := readClaudeJSONWithRetry(path)
	if err != nil {
		return view, err
	}
	var root map[string]any
	if err := json.Unmarshal(data, &root); err != nil {
		return view, fmt.Errorf("files: ~/.claude.json is not readable right now (the CLI may be rewriting it) — try again")
	}

	servers := collectServers(root, path)
	view.MCPServersEmpty = len(servers) == 0

	mergeAuthCache(servers, &view)

	sort.Slice(servers, func(i, j int) bool { return lessServerRow(servers[i], servers[j]) })
	if len(servers) > 0 {
		view.Servers = servers
	}
	return view, nil
}

// collectServers gathers rows from the three server sources: top-level
// mcpServers, per-project projects[<path>].mcpServers, and each project's
// on-disk .mcp.json.
func collectServers(root map[string]any, claudeJSON string) []MCPServerRow {
	var servers []MCPServerRow
	servers = append(servers, mcpServerRows(root, mcpSourceGlobal, claudeJSON)...)

	projects, ok := root["projects"].(map[string]any)
	if !ok {
		return servers
	}
	paths := make([]string, 0, len(projects))
	for p := range projects {
		paths = append(paths, p)
	}
	sort.Strings(paths)
	for _, projectPath := range paths {
		if pm, ok := projects[projectPath].(map[string]any); ok {
			servers = append(servers, mcpServerRows(pm, mcpSourceClaudeJSONProject, projectPath)...)
		}
		servers = append(servers, readMCPJSONFile(projectPath)...)
	}
	return servers
}

// mcpServerRows extracts the "mcpServers" block from container into rows.
// A missing or oddly-shaped block yields no rows (best-effort, never fatal).
func mcpServerRows(container map[string]any, sourceKind, sourcePath string) []MCPServerRow {
	block, ok := container["mcpServers"].(map[string]any)
	if !ok {
		return nil
	}
	names := make([]string, 0, len(block))
	for name := range block {
		names = append(names, name)
	}
	sort.Strings(names)
	out := make([]MCPServerRow, 0, len(names))
	for _, name := range names {
		if row, ok := buildServerRow(name, block[name], sourceKind, sourcePath); ok {
			out = append(out, row)
		}
	}
	return out
}

// buildServerRow builds one masked row from a raw server config value. Returns
// ok=false when the value is not an object.
func buildServerRow(name string, raw any, sourceKind, sourcePath string) (MCPServerRow, bool) {
	m, ok := raw.(map[string]any)
	if !ok {
		return MCPServerRow{}, false
	}
	row := MCPServerRow{Name: name, SourceKind: sourceKind, SourcePath: sourcePath}

	transport, _ := m["type"].(string)
	url, hasURL := m["url"].(string)
	command, hasCommand := m["command"].(string)
	if transport == "" {
		switch {
		case hasCommand:
			transport = "stdio"
		case hasURL:
			transport = "http"
		}
	}
	row.Transport = transport

	if hasURL {
		row.CommandOrURL = maskURLCredentials(maskedString("url", url))
	} else if hasCommand {
		row.CommandOrURL = maskCommandLine(command, m["args"])
	}
	return row, true
}

// maskCommandLine joins a stdio command with its args, masking each token by
// value shape so a credential passed as an arg never surfaces.
func maskCommandLine(command string, args any) string {
	parts := []string{maskedString("command", command)}
	if list, ok := args.([]any); ok {
		for _, a := range list {
			if s, ok := a.(string); ok {
				parts = append(parts, maskedString("", s))
			}
		}
	}
	return strings.Join(parts, " ")
}

// maskedString runs a single value through the shared masking and returns a
// string; a masked (non-string) result collapses to the mask placeholder.
func maskedString(key string, value any) string {
	if s, ok := maskJSONValue(key, value).(string); ok {
		return s
	}
	return claudeJSONMask
}

// maskURLCredentials masks the value of any credential-shaped query parameter.
func maskURLCredentials(url string) string {
	return mcpURLCredentialParam.ReplaceAllString(url, "${1}"+claudeJSONMask)
}

// readMCPJSONFile reads {projectPath}/.mcp.json best-effort; any read/parse
// failure yields no rows.
func readMCPJSONFile(projectPath string) []MCPServerRow {
	file := filepath.Join(projectPath, ".mcp.json")
	data, err := os.ReadFile(file)
	if err != nil {
		return nil
	}
	var root map[string]any
	if err := json.Unmarshal(data, &root); err != nil {
		return nil
	}
	return mcpServerRows(root, mcpSourceProjectMCPJSON, file)
}

// mergeAuthCache marks server rows that also appear in the auth cache and adds
// cache-only connectors to view.ConnectorsFromCache.
func mergeAuthCache(servers []MCPServerRow, view *MCPStatusView) {
	authByName, cachePath := readAuthCache()
	serverNames := make(map[string]bool, len(servers))
	for i := range servers {
		serverNames[servers[i].Name] = true
		if entry, ok := authByName[servers[i].Name]; ok {
			servers[i].AuthNeeded = true
			servers[i].LastCheckedUnixMs = entry.lastCheckedUnixMs
			servers[i].CacheAgeDays = entry.cacheAgeDays
		}
	}

	names := make([]string, 0, len(authByName))
	for name := range authByName {
		names = append(names, name)
	}
	sort.Strings(names)
	for _, name := range names {
		if serverNames[name] {
			continue
		}
		entry := authByName[name]
		view.ConnectorsFromCache = append(view.ConnectorsFromCache, MCPServerRow{
			Name:              name,
			SourceKind:        mcpSourceAuthCache,
			SourcePath:        cachePath,
			AuthNeeded:        true,
			LastCheckedUnixMs: entry.lastCheckedUnixMs,
			CacheAgeDays:      entry.cacheAgeDays,
		})
	}
}

// readAuthCache parses ~/.claude/mcp-needs-auth-cache.json into validated
// entries. The cache is untrusted point-in-time data: a non-numeric or <=0
// timestamp skips that entry rather than yielding a nonsense age. A missing
// file yields an empty map. Also returns the cache file path for provenance.
func readAuthCache() (map[string]mcpAuthEntry, string) {
	out := map[string]mcpAuthEntry{}
	cd, err := claudeDir()
	if err != nil {
		return out, ""
	}
	cachePath := filepath.Join(cd, mcpAuthCacheFile)
	data, err := os.ReadFile(cachePath)
	if err != nil {
		return out, cachePath
	}
	var root map[string]any
	if err := json.Unmarshal(data, &root); err != nil {
		return out, cachePath
	}
	nowMs := time.Now().UnixMilli()
	for name, raw := range root {
		entry, ok := raw.(map[string]any)
		if !ok {
			continue
		}
		ts, ok := entry["timestamp"].(float64)
		if !ok || ts <= 0 {
			continue
		}
		tsMs := int64(ts)
		out[name] = mcpAuthEntry{
			lastCheckedUnixMs: tsMs,
			cacheAgeDays:      int((nowMs - tsMs) / millisPerDay),
		}
	}
	return out, cachePath
}

// lessServerRow orders rows deterministically by name, then source, then path.
func lessServerRow(a, b MCPServerRow) bool {
	if a.Name != b.Name {
		return a.Name < b.Name
	}
	if a.SourceKind != b.SourceKind {
		return a.SourceKind < b.SourceKind
	}
	return a.SourcePath < b.SourcePath
}
