package files

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// serverByName indexes a row slice by server name for assertions.
func serverByName(rows []MCPServerRow) map[string]MCPServerRow {
	m := make(map[string]MCPServerRow, len(rows))
	for _, r := range rows {
		m[r.Name] = r
	}
	return m
}

// writeMCPJSON writes a project .mcp.json with the given mcpServers block.
func writeMCPJSON(t *testing.T, projectDir string, servers map[string]any) {
	t.Helper()
	if err := os.MkdirAll(projectDir, 0o755); err != nil {
		t.Fatalf("mkdir project %q: %v", projectDir, err)
	}
	data, err := json.Marshal(map[string]any{"mcpServers": servers})
	if err != nil {
		t.Fatalf("marshal .mcp.json: %v", err)
	}
	if err := os.WriteFile(filepath.Join(projectDir, ".mcp.json"), data, 0o644); err != nil {
		t.Fatalf("write .mcp.json: %v", err)
	}
}

// writeAuthCache writes ~/.claude/mcp-needs-auth-cache.json.
func writeAuthCache(t *testing.T, home string, content map[string]any) {
	t.Helper()
	data, err := json.Marshal(content)
	if err != nil {
		t.Fatalf("marshal auth cache: %v", err)
	}
	if err := os.WriteFile(filepath.Join(home, ".claude", mcpAuthCacheFile), data, 0o644); err != nil {
		t.Fatalf("write auth cache: %v", err)
	}
}

func TestGetMCPStatusTopLevelOnly(t *testing.T) {
	home := claudeJSONHome(t)
	writeClaudeJSON(t, home, map[string]any{
		"mcpServers": map[string]any{
			"exa": map[string]any{"type": "stdio", "command": "npx", "args": []any{"-y", "exa-mcp-server"}},
		},
		"projects": map[string]any{},
	})

	view, err := GetMCPStatus()
	if err != nil {
		t.Fatalf("GetMCPStatus: %v", err)
	}
	if view.MCPServersEmpty {
		t.Error("MCPServersEmpty must be false with a top-level server")
	}
	if len(view.Servers) != 1 {
		t.Fatalf("want 1 server, got %d: %+v", len(view.Servers), view.Servers)
	}
	got := view.Servers[0]
	if got.Name != "exa" || got.SourceKind != mcpSourceGlobal {
		t.Errorf("row = %+v, want name=exa sourceKind=%s", got, mcpSourceGlobal)
	}
	if got.Transport != "stdio" {
		t.Errorf("transport = %q, want stdio", got.Transport)
	}
	if !strings.Contains(got.CommandOrURL, "npx") {
		t.Errorf("commandOrUrl = %q, want it to contain npx", got.CommandOrURL)
	}
}

func TestGetMCPStatusClaudeJSONProjectOnly(t *testing.T) {
	home := claudeJSONHome(t)
	projectPath := filepath.Join(home, "work", "svc")
	writeClaudeJSON(t, home, map[string]any{
		"mcpServers": map[string]any{}, // top-level empty
		"projects": map[string]any{
			projectPath: map[string]any{
				"mcpServers": map[string]any{
					"playwright": map[string]any{"type": "stdio", "command": "npx", "args": []any{"playwright-mcp"}},
				},
			},
		},
	})

	view, err := GetMCPStatus()
	if err != nil {
		t.Fatalf("GetMCPStatus: %v", err)
	}
	// Populated projects[x].mcpServers with an empty top-level MUST NOT be empty.
	if view.MCPServersEmpty {
		t.Error("MCPServersEmpty must be false when a per-project block has servers")
	}
	if len(view.Servers) != 1 {
		t.Fatalf("want 1 server, got %d: %+v", len(view.Servers), view.Servers)
	}
	got := view.Servers[0]
	if got.Name != "playwright" || got.SourceKind != mcpSourceClaudeJSONProject {
		t.Errorf("row = %+v, want name=playwright sourceKind=%s", got, mcpSourceClaudeJSONProject)
	}
	if got.SourcePath != projectPath {
		t.Errorf("sourcePath = %q, want %q", got.SourcePath, projectPath)
	}
}

func TestGetMCPStatusMCPJSONOnly(t *testing.T) {
	home := claudeJSONHome(t)
	projectPath := filepath.Join(home, "coffee-app")
	mcpFile := filepath.Join(projectPath, ".mcp.json")
	writeMCPJSON(t, projectPath, map[string]any{
		"laravel-boost": map[string]any{"command": "php", "args": []any{"artisan", "boost:mcp"}},
	})
	writeClaudeJSON(t, home, map[string]any{
		"projects": map[string]any{
			projectPath: map[string]any{"allowedTools": []any{}}, // no mcpServers here
		},
	})

	view, err := GetMCPStatus()
	if err != nil {
		t.Fatalf("GetMCPStatus: %v", err)
	}
	if view.MCPServersEmpty {
		t.Error("MCPServersEmpty must be false when a .mcp.json has servers")
	}
	if len(view.Servers) != 1 {
		t.Fatalf("want 1 server, got %d: %+v", len(view.Servers), view.Servers)
	}
	got := view.Servers[0]
	if got.Name != "laravel-boost" || got.SourceKind != mcpSourceProjectMCPJSON {
		t.Errorf("row = %+v, want name=laravel-boost sourceKind=%s", got, mcpSourceProjectMCPJSON)
	}
	if got.SourcePath != mcpFile {
		t.Errorf("sourcePath = %q, want %q", got.SourcePath, mcpFile)
	}
	if got.Transport != "stdio" {
		t.Errorf("transport = %q, want stdio (command present)", got.Transport)
	}
}

func TestGetMCPStatusAllPresentWithAuthCache(t *testing.T) {
	home := claudeJSONHome(t)
	projectPath := filepath.Join(home, "proj")
	mcpFile := filepath.Join(projectPath, ".mcp.json")
	writeMCPJSON(t, projectPath, map[string]any{
		"filesystem": map[string]any{"command": "npx", "args": []any{"fs-mcp"}},
	})
	writeClaudeJSON(t, home, map[string]any{
		"mcpServers": map[string]any{
			"notion": map[string]any{"type": "http", "url": "https://mcp.notion.com/mcp"},
		},
		"projects": map[string]any{
			projectPath: map[string]any{
				"mcpServers": map[string]any{
					"exa": map[string]any{"command": "npx", "args": []any{"exa-mcp"}},
				},
			},
		},
	})
	// notion matches a server (merge → AuthNeeded); gmail is cache-only.
	writeAuthCache(t, home, map[string]any{
		"notion": map[string]any{"timestamp": float64(time.Now().UnixMilli()), "id": "mcpsrv_notion"},
		"gmail":  map[string]any{"timestamp": float64(time.Now().UnixMilli()), "id": "mcpsrv_gmail"},
	})

	view, err := GetMCPStatus()
	if err != nil {
		t.Fatalf("GetMCPStatus: %v", err)
	}
	if view.MCPServersEmpty {
		t.Error("MCPServersEmpty must be false")
	}
	if len(view.Servers) != 3 {
		t.Fatalf("want 3 servers, got %d: %+v", len(view.Servers), view.Servers)
	}
	byName := serverByName(view.Servers)

	if got := byName["notion"]; got.SourceKind != mcpSourceGlobal || got.Transport != "http" {
		t.Errorf("notion row = %+v, want sourceKind=global transport=http", got)
	}
	if got := byName["notion"]; !got.AuthNeeded {
		t.Error("notion must be AuthNeeded (present in auth cache)")
	}
	if got := byName["exa"]; got.SourceKind != mcpSourceClaudeJSONProject || got.SourcePath != projectPath {
		t.Errorf("exa row = %+v, want claudejson-project @ %q", got, projectPath)
	}
	if got := byName["exa"]; got.AuthNeeded {
		t.Error("exa must not be AuthNeeded (absent from auth cache)")
	}
	if got := byName["filesystem"]; got.SourceKind != mcpSourceProjectMCPJSON || got.SourcePath != mcpFile {
		t.Errorf("filesystem row = %+v, want project-mcpjson @ %q", got, mcpFile)
	}

	if len(view.ConnectorsFromCache) != 1 || view.ConnectorsFromCache[0].Name != "gmail" {
		t.Fatalf("want 1 cache-only connector 'gmail', got %+v", view.ConnectorsFromCache)
	}
	if c := view.ConnectorsFromCache[0]; !c.AuthNeeded || c.SourceKind != mcpSourceAuthCache {
		t.Errorf("gmail connector = %+v, want authNeeded=true sourceKind=auth-cache", c)
	}
}

func TestGetMCPStatusNoneEmpty(t *testing.T) {
	home := claudeJSONHome(t)
	writeClaudeJSON(t, home, map[string]any{
		"mcpServers": map[string]any{},
		"projects":   map[string]any{},
	})

	view, err := GetMCPStatus()
	if err != nil {
		t.Fatalf("GetMCPStatus: %v", err)
	}
	if !view.MCPServersEmpty {
		t.Error("MCPServersEmpty must be true when every server source is empty")
	}
	if len(view.Servers) != 0 {
		t.Errorf("want 0 servers, got %+v", view.Servers)
	}
	if len(view.ConnectorsFromCache) != 0 {
		t.Errorf("want 0 cache connectors, got %+v", view.ConnectorsFromCache)
	}
}

func TestGetMCPStatusAuthCacheAge(t *testing.T) {
	home := claudeJSONHome(t)
	writeClaudeJSON(t, home, map[string]any{"projects": map[string]any{}})
	monthsAgoMs := time.Now().UnixMilli() - 90*millisPerDay
	writeAuthCache(t, home, map[string]any{
		"notion": map[string]any{"timestamp": float64(monthsAgoMs), "id": "mcpsrv_notion"},
		"broken": map[string]any{"timestamp": "not-a-number", "id": "mcpsrv_broken"},
		"nonpos": map[string]any{"timestamp": float64(0), "id": "mcpsrv_zero"},
	})

	view, err := GetMCPStatus()
	if err != nil {
		t.Fatalf("GetMCPStatus: %v", err)
	}
	// Only the valid, positive-timestamp entry survives.
	if len(view.ConnectorsFromCache) != 1 || view.ConnectorsFromCache[0].Name != "notion" {
		t.Fatalf("want only 'notion' connector, got %+v", view.ConnectorsFromCache)
	}
	got := view.ConnectorsFromCache[0]
	if got.CacheAgeDays < 89 {
		t.Errorf("cacheAgeDays = %d, want ~90 (months-old, not current)", got.CacheAgeDays)
	}
	if got.LastCheckedUnixMs != monthsAgoMs {
		t.Errorf("lastCheckedUnixMs = %d, want %d", got.LastCheckedUnixMs, monthsAgoMs)
	}
}

func TestGetMCPStatusMasksCredentials(t *testing.T) {
	home := claudeJSONHome(t)
	writeClaudeJSON(t, home, map[string]any{
		"mcpServers": map[string]any{
			"stdio-secret": map[string]any{
				"type":    "stdio",
				"command": "npx",
				"args":    []any{"-y", "sk-argsecret999"},
				"env":     map[string]any{"EXA_API_KEY": "envsecret777"},
			},
			"http-secret": map[string]any{
				"type": "http",
				"url":  "https://example.com/mcp?api_key=urlsecret123&foo=bar",
			},
		},
		"projects": map[string]any{},
	})

	view, err := GetMCPStatus()
	if err != nil {
		t.Fatalf("GetMCPStatus: %v", err)
	}
	blob, err := json.Marshal(view)
	if err != nil {
		t.Fatalf("marshal view: %v", err)
	}
	serialized := string(blob)
	for _, secret := range []string{"sk-argsecret999", "envsecret777", "urlsecret123"} {
		if strings.Contains(serialized, secret) {
			t.Errorf("secret %q leaked into status view: %s", secret, serialized)
		}
	}
	if !strings.Contains(serialized, claudeJSONMask) {
		t.Errorf("expected mask placeholder in view, got: %s", serialized)
	}

	byName := serverByName(view.Servers)
	if url := byName["http-secret"].CommandOrURL; !strings.Contains(url, "foo=bar") {
		t.Errorf("http-secret commandOrUrl = %q, want non-secret param foo=bar preserved", url)
	}
}
