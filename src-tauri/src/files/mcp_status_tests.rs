//! Ports `mcp_status_test.go`. Every case redirects `$HOME` to a temp dir via
//! the shared `settings_write::test_home` scaffolding (never the real
//! `~/.claude`).

use std::collections::HashMap;
use std::fs;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use serde_json::{json, Map, Value};

use super::{
    get_mcp_status, MCPServerRow, MCP_AUTH_CACHE_FILE, MCP_SOURCE_AUTH_CACHE,
    MCP_SOURCE_CLAUDEJSON_PROJECT, MCP_SOURCE_GLOBAL, MCP_SOURCE_PROJECT_MCPJSON, MILLIS_PER_DAY,
};
use crate::files::settings_write::test_home::redirect_home;

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64
}

fn obj(pairs: Vec<(&str, Value)>) -> Value {
    let mut m = Map::new();
    for (k, v) in pairs {
        m.insert(k.to_string(), v);
    }
    Value::Object(m)
}

fn server_by_name(rows: &[MCPServerRow]) -> HashMap<String, MCPServerRow> {
    rows.iter().map(|r| (r.name.clone(), r.clone())).collect()
}

fn write_claude_json(home: &Path, value: Value) {
    let data = serde_json::to_vec(&value).expect("marshal claude.json");
    fs::write(home.join(".claude.json"), data).expect("write claude.json");
}

fn write_mcp_json(project_dir: &Path, servers: Value) {
    fs::create_dir_all(project_dir).expect("mkdir project");
    let data = serde_json::to_vec(&obj(vec![("mcpServers", servers)])).expect("marshal .mcp.json");
    fs::write(project_dir.join(".mcp.json"), data).expect("write .mcp.json");
}

fn write_auth_cache(home: &Path, content: Value) {
    let claude = home.join(".claude");
    fs::create_dir_all(&claude).expect("mkdir .claude");
    let data = serde_json::to_vec(&content).expect("marshal auth cache");
    fs::write(claude.join(MCP_AUTH_CACHE_FILE), data).expect("write auth cache");
}

#[test]
fn top_level_only() {
    let h = redirect_home();
    write_claude_json(
        &h.home,
        obj(vec![
            (
                "mcpServers",
                json!({"exa": {"type": "stdio", "command": "npx", "args": ["-y", "exa-mcp-server"]}}),
            ),
            ("projects", json!({})),
        ]),
    );

    let view = get_mcp_status().expect("get_mcp_status");
    assert!(!view.mcp_servers_empty, "MCPServersEmpty must be false with a top-level server");
    assert_eq!(view.servers.len(), 1, "{:?}", view.servers);
    let got = &view.servers[0];
    assert_eq!(got.name, "exa");
    assert_eq!(got.source_kind, MCP_SOURCE_GLOBAL);
    assert_eq!(got.transport, "stdio");
    assert!(got.command_or_url.contains("npx"), "commandOrUrl = {:?}", got.command_or_url);
    drop(h);
}

#[test]
fn claudejson_project_only() {
    let h = redirect_home();
    let project_path = h.home.join("work").join("svc");
    let project_path_str = project_path.to_string_lossy().into_owned();
    write_claude_json(
        &h.home,
        obj(vec![
            ("mcpServers", json!({})),
            (
                "projects",
                obj(vec![(
                    project_path_str.as_str(),
                    json!({"mcpServers": {"playwright": {"type": "stdio", "command": "npx", "args": ["playwright-mcp"]}}}),
                )]),
            ),
        ]),
    );

    let view = get_mcp_status().expect("get_mcp_status");
    assert!(!view.mcp_servers_empty, "MCPServersEmpty must be false when a per-project block has servers");
    assert_eq!(view.servers.len(), 1, "{:?}", view.servers);
    let got = &view.servers[0];
    assert_eq!(got.name, "playwright");
    assert_eq!(got.source_kind, MCP_SOURCE_CLAUDEJSON_PROJECT);
    assert_eq!(got.source_path, project_path_str);
    drop(h);
}

#[test]
fn mcpjson_only() {
    let h = redirect_home();
    let project_path = h.home.join("coffee-app");
    let mcp_file = project_path.join(".mcp.json");
    let mcp_file_str = mcp_file.to_string_lossy().into_owned();
    write_mcp_json(
        &project_path,
        json!({"laravel-boost": {"command": "php", "args": ["artisan", "boost:mcp"]}}),
    );
    let project_path_str = project_path.to_string_lossy().into_owned();
    write_claude_json(
        &h.home,
        obj(vec![(
            "projects",
            obj(vec![(project_path_str.as_str(), json!({"allowedTools": []}))]),
        )]),
    );

    let view = get_mcp_status().expect("get_mcp_status");
    assert!(!view.mcp_servers_empty, "MCPServersEmpty must be false when a .mcp.json has servers");
    assert_eq!(view.servers.len(), 1, "{:?}", view.servers);
    let got = &view.servers[0];
    assert_eq!(got.name, "laravel-boost");
    assert_eq!(got.source_kind, MCP_SOURCE_PROJECT_MCPJSON);
    assert_eq!(got.source_path, mcp_file_str);
    assert_eq!(got.transport, "stdio", "transport should be stdio (command present)");
    drop(h);
}

#[test]
fn all_present_with_auth_cache() {
    let h = redirect_home();
    let project_path = h.home.join("proj");
    let mcp_file = project_path.join(".mcp.json");
    let mcp_file_str = mcp_file.to_string_lossy().into_owned();
    write_mcp_json(
        &project_path,
        json!({"filesystem": {"command": "npx", "args": ["fs-mcp"]}}),
    );
    let project_path_str = project_path.to_string_lossy().into_owned();
    write_claude_json(
        &h.home,
        obj(vec![
            ("mcpServers", json!({"notion": {"type": "http", "url": "https://mcp.notion.com/mcp"}})),
            (
                "projects",
                obj(vec![(
                    project_path_str.as_str(),
                    json!({"mcpServers": {"exa": {"command": "npx", "args": ["exa-mcp"]}}}),
                )]),
            ),
        ]),
    );
    // notion matches a server (merge → AuthNeeded); gmail is cache-only.
    let ts = now_ms();
    write_auth_cache(
        &h.home,
        json!({
            "notion": {"timestamp": ts, "id": "mcpsrv_notion"},
            "gmail": {"timestamp": ts, "id": "mcpsrv_gmail"},
        }),
    );

    let view = get_mcp_status().expect("get_mcp_status");
    assert!(!view.mcp_servers_empty);
    assert_eq!(view.servers.len(), 3, "{:?}", view.servers);
    let by_name = server_by_name(&view.servers);

    let notion = &by_name["notion"];
    assert_eq!(notion.source_kind, MCP_SOURCE_GLOBAL);
    assert_eq!(notion.transport, "http");
    assert!(notion.auth_needed, "notion must be AuthNeeded (present in auth cache)");

    let exa = &by_name["exa"];
    assert_eq!(exa.source_kind, MCP_SOURCE_CLAUDEJSON_PROJECT);
    assert_eq!(exa.source_path, project_path_str);
    assert!(!exa.auth_needed, "exa must not be AuthNeeded (absent from auth cache)");

    let filesystem = &by_name["filesystem"];
    assert_eq!(filesystem.source_kind, MCP_SOURCE_PROJECT_MCPJSON);
    assert_eq!(filesystem.source_path, mcp_file_str);

    assert_eq!(view.connectors_from_cache.len(), 1, "{:?}", view.connectors_from_cache);
    let gmail = &view.connectors_from_cache[0];
    assert_eq!(gmail.name, "gmail");
    assert!(gmail.auth_needed);
    assert_eq!(gmail.source_kind, MCP_SOURCE_AUTH_CACHE);
    drop(h);
}

#[test]
fn none_empty() {
    let h = redirect_home();
    write_claude_json(
        &h.home,
        obj(vec![("mcpServers", json!({})), ("projects", json!({}))]),
    );

    let view = get_mcp_status().expect("get_mcp_status");
    assert!(view.mcp_servers_empty, "MCPServersEmpty must be true when every server source is empty");
    assert_eq!(view.servers.len(), 0, "{:?}", view.servers);
    assert_eq!(view.connectors_from_cache.len(), 0, "{:?}", view.connectors_from_cache);
    drop(h);
}

#[test]
fn auth_cache_age() {
    let h = redirect_home();
    write_claude_json(&h.home, obj(vec![("projects", json!({}))]));
    let months_ago_ms = now_ms() - 90 * MILLIS_PER_DAY;
    write_auth_cache(
        &h.home,
        json!({
            "notion": {"timestamp": months_ago_ms, "id": "mcpsrv_notion"},
            "broken": {"timestamp": "not-a-number", "id": "mcpsrv_broken"},
            "nonpos": {"timestamp": 0, "id": "mcpsrv_zero"},
        }),
    );

    let view = get_mcp_status().expect("get_mcp_status");
    // Only the valid, positive-timestamp entry survives.
    assert_eq!(view.connectors_from_cache.len(), 1, "{:?}", view.connectors_from_cache);
    let got = &view.connectors_from_cache[0];
    assert_eq!(got.name, "notion");
    assert!(got.cache_age_days >= 89, "cacheAgeDays = {}, want ~90", got.cache_age_days);
    assert_eq!(got.last_checked_unix_ms, months_ago_ms);
    drop(h);
}

#[test]
fn masks_credentials() {
    let h = redirect_home();
    write_claude_json(
        &h.home,
        obj(vec![
            (
                "mcpServers",
                json!({
                    "stdio-secret": {
                        "type": "stdio",
                        "command": "npx",
                        "args": ["-y", "sk-argsecret999"],
                        "env": {"EXA_API_KEY": "envsecret777"}
                    },
                    "http-secret": {
                        "type": "http",
                        "url": "https://example.com/mcp?api_key=urlsecret123&foo=bar"
                    }
                }),
            ),
            ("projects", json!({})),
        ]),
    );

    let view = get_mcp_status().expect("get_mcp_status");
    let serialized = serde_json::to_string(&view).expect("marshal view");
    for secret in ["sk-argsecret999", "envsecret777", "urlsecret123"] {
        assert!(!serialized.contains(secret), "secret {secret:?} leaked: {serialized}");
    }
    assert!(serialized.contains("••••"), "expected mask placeholder: {serialized}");

    let by_name = server_by_name(&view.servers);
    let url = &by_name["http-secret"].command_or_url;
    assert!(url.contains("foo=bar"), "want non-secret param foo=bar preserved: {url:?}");
    drop(h);
}
