//! Ports `internal/files/mcp_status.go` — the READ-ONLY aggregator behind the
//! MCP Status Dashboard. It surfaces MCP server state from `~/.claude.json`'s
//! top-level and per-project `mcpServers`, each project's on-disk `.mcp.json`,
//! and the auth-needed connector cache — WITHOUT any write. Every
//! command/url/args value is masked before it leaves this module (same contract
//! as `claudejson`), plus URL query-string credentials that key/value-prefix
//! matching alone would miss. Guards and the masking regex are verbatim.

use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::Path;
use std::sync::LazyLock;

use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use super::claudejson::{
    claude_json_path, mask_json_value, read_claude_json_with_retry, CLAUDE_JSON_MASK,
};
use crate::config::root::claude_dir;

// Source-kind literals for an MCP server row's provenance.
const MCP_SOURCE_GLOBAL: &str = "global"; // top-level mcpServers in ~/.claude.json
const MCP_SOURCE_CLAUDEJSON_PROJECT: &str = "claudejson-project"; // projects[<path>].mcpServers
const MCP_SOURCE_PROJECT_MCPJSON: &str = "project-mcpjson"; // {root}/.mcp.json
const MCP_SOURCE_AUTH_CACHE: &str = "auth-cache"; // cache-only connector (no server source)

/// The connector auth-needed cache the CLI maintains.
const MCP_AUTH_CACHE_FILE: &str = "mcp-needs-auth-cache.json";

/// Converts an epoch-ms delta into whole days.
const MILLIS_PER_DAY: i64 = 86_400_000;

/// Matches a credential-shaped query parameter and its value so the value can be
/// masked. `mask_json_value` only masks by secret key or a secret-value PREFIX,
/// so a url like `https://host?api_key=…` slips through it unmasked; this closes
/// that gap. Mirrors `mcpURLCredentialParam` VERBATIM.
static MCP_URL_CREDENTIAL_PARAM: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)((?:api[_-]?key|apikey|token|secret|password|auth)=)[^&#\s]*").unwrap()
});

/// One MCP server as surfaced by the dashboard. `command_or_url` is always
/// masked. `auth_needed`/`last_checked_unix_ms`/`cache_age_days` come from the
/// auth-needed cache and are point-in-time, never asserted as current truth.
/// Mirrors `MCPServerRow`.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MCPServerRow {
    pub name: String,
    pub transport: String,
    pub source_kind: String,
    pub source_path: String,
    pub command_or_url: String,
    pub auth_needed: bool,
    pub last_checked_unix_ms: i64,
    pub cache_age_days: i64,
}

/// The full read-only MCP status aggregate. `mcp_servers_empty` is true ONLY
/// when no server appears in any of the three server sources. Mirrors
/// `MCPStatusView`.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MCPStatusView {
    pub servers: Vec<MCPServerRow>,
    pub mcp_servers_empty: bool,
    pub connectors_from_cache: Vec<MCPServerRow>,
}

/// A parsed, validated auth-cache record. Mirrors `mcpAuthEntry`.
struct McpAuthEntry {
    last_checked_unix_ms: i64,
    cache_age_days: i64,
}

/// Aggregates MCP server state from four best-effort sources — one failing
/// source never fails the call. All project roots are derived server-side from
/// `~/.claude.json`'s projects map keys, so the call takes no argument. Mirrors
/// `GetMCPStatus`.
pub fn get_mcp_status() -> Result<MCPStatusView, String> {
    let mut view = MCPStatusView {
        servers: Vec::new(),
        mcp_servers_empty: false,
        connectors_from_cache: Vec::new(),
    };

    let path = claude_json_path()?;
    let path_str = path.to_string_lossy().into_owned();
    let data = read_claude_json_with_retry(&path)?;
    let root: Map<String, Value> = serde_json::from_slice(&data).map_err(|_| {
        "files: ~/.claude.json is not readable right now (the CLI may be rewriting it) — try again"
            .to_string()
    })?;

    let mut servers = collect_servers(&root, &path_str);
    view.mcp_servers_empty = servers.is_empty();

    view.connectors_from_cache = merge_auth_cache(&mut servers);

    servers.sort_by(cmp_server_row);
    if !servers.is_empty() {
        view.servers = servers;
    }
    Ok(view)
}

/// Gathers rows from the three server sources: top-level mcpServers, per-project
/// projects[<path>].mcpServers, and each project's on-disk .mcp.json. Mirrors
/// `collectServers`.
fn collect_servers(root: &Map<String, Value>, claude_json: &str) -> Vec<MCPServerRow> {
    let mut servers = mcp_server_rows(root, MCP_SOURCE_GLOBAL, claude_json);

    let Some(Value::Object(projects)) = root.get("projects") else {
        return servers;
    };
    let mut paths: Vec<&String> = projects.keys().collect();
    paths.sort();
    for project_path in paths {
        if let Some(Value::Object(pm)) = projects.get(project_path) {
            servers.extend(mcp_server_rows(pm, MCP_SOURCE_CLAUDEJSON_PROJECT, project_path));
        }
        servers.extend(read_mcp_json_file(project_path));
    }
    servers
}

/// Extracts the "mcpServers" block from `container` into rows. A missing or
/// oddly-shaped block yields no rows (best-effort, never fatal). Mirrors
/// `mcpServerRows`.
fn mcp_server_rows(
    container: &Map<String, Value>,
    source_kind: &str,
    source_path: &str,
) -> Vec<MCPServerRow> {
    let Some(Value::Object(block)) = container.get("mcpServers") else {
        return Vec::new();
    };
    let mut names: Vec<&String> = block.keys().collect();
    names.sort();
    let mut out = Vec::with_capacity(names.len());
    for name in names {
        if let Some(row) = build_server_row(name, &block[name], source_kind, source_path) {
            out.push(row);
        }
    }
    out
}

/// Builds one masked row from a raw server config value. Returns None when the
/// value is not an object. Mirrors `buildServerRow`.
fn build_server_row(
    name: &str,
    raw: &Value,
    source_kind: &str,
    source_path: &str,
) -> Option<MCPServerRow> {
    let m = raw.as_object()?;
    let mut row = MCPServerRow {
        name: name.to_string(),
        source_kind: source_kind.to_string(),
        source_path: source_path.to_string(),
        ..Default::default()
    };

    let mut transport = m.get("type").and_then(Value::as_str).unwrap_or("").to_string();
    let url = m.get("url").and_then(Value::as_str);
    let command = m.get("command").and_then(Value::as_str);
    if transport.is_empty() {
        if command.is_some() {
            transport = "stdio".to_string();
        } else if url.is_some() {
            transport = "http".to_string();
        }
    }
    row.transport = transport;

    if let Some(url) = url {
        row.command_or_url =
            mask_url_credentials(&masked_string("url", &Value::String(url.to_string())));
    } else if let Some(command) = command {
        row.command_or_url = mask_command_line(command, m.get("args"));
    }
    Some(row)
}

/// Joins a stdio command with its args, masking each token by value shape so a
/// credential passed as an arg never surfaces. Mirrors `maskCommandLine`.
fn mask_command_line(command: &str, args: Option<&Value>) -> String {
    let mut parts = vec![masked_string("command", &Value::String(command.to_string()))];
    if let Some(Value::Array(list)) = args {
        for a in list {
            if let Value::String(s) = a {
                parts.push(masked_string("", &Value::String(s.clone())));
            }
        }
    }
    parts.join(" ")
}

/// Runs a single value through the shared masking and returns a string; a masked
/// (non-string) result collapses to the mask placeholder. Mirrors `maskedString`.
fn masked_string(key: &str, value: &Value) -> String {
    match mask_json_value(key, value) {
        Value::String(s) => s,
        _ => CLAUDE_JSON_MASK.to_string(),
    }
}

/// Masks the value of any credential-shaped query parameter. Mirrors
/// `maskURLCredentials`.
fn mask_url_credentials(url: &str) -> String {
    let replacement = format!("${{1}}{CLAUDE_JSON_MASK}");
    MCP_URL_CREDENTIAL_PARAM
        .replace_all(url, replacement.as_str())
        .into_owned()
}

/// Reads {projectPath}/.mcp.json best-effort; any read/parse failure yields no
/// rows. Mirrors `readMCPJSONFile`.
fn read_mcp_json_file(project_path: &str) -> Vec<MCPServerRow> {
    let file = Path::new(project_path).join(".mcp.json");
    let file_str = file.to_string_lossy().into_owned();
    let Ok(data) = fs::read(&file) else {
        return Vec::new();
    };
    let Ok(root) = serde_json::from_slice::<Map<String, Value>>(&data) else {
        return Vec::new();
    };
    mcp_server_rows(&root, MCP_SOURCE_PROJECT_MCPJSON, &file_str)
}

/// Marks server rows that also appear in the auth cache (in place) and returns
/// the cache-only connectors. Mirrors `mergeAuthCache`.
fn merge_auth_cache(servers: &mut [MCPServerRow]) -> Vec<MCPServerRow> {
    let (auth_by_name, cache_path) = read_auth_cache();

    let mut server_names: HashSet<String> = HashSet::with_capacity(servers.len());
    for row in servers.iter_mut() {
        server_names.insert(row.name.clone());
        if let Some(entry) = auth_by_name.get(&row.name) {
            row.auth_needed = true;
            row.last_checked_unix_ms = entry.last_checked_unix_ms;
            row.cache_age_days = entry.cache_age_days;
        }
    }

    let mut names: Vec<&String> = auth_by_name.keys().collect();
    names.sort();
    let mut connectors = Vec::new();
    for name in names {
        if server_names.contains(name) {
            continue;
        }
        let entry = &auth_by_name[name];
        connectors.push(MCPServerRow {
            name: name.clone(),
            source_kind: MCP_SOURCE_AUTH_CACHE.to_string(),
            source_path: cache_path.clone(),
            auth_needed: true,
            last_checked_unix_ms: entry.last_checked_unix_ms,
            cache_age_days: entry.cache_age_days,
            ..Default::default()
        });
    }
    connectors
}

/// Parses ~/.claude/mcp-needs-auth-cache.json into validated entries. The cache
/// is untrusted point-in-time data: a non-numeric or <=0 timestamp skips that
/// entry rather than yielding a nonsense age. A missing file yields an empty
/// map. Also returns the cache file path for provenance. Mirrors `readAuthCache`.
fn read_auth_cache() -> (HashMap<String, McpAuthEntry>, String) {
    let mut out: HashMap<String, McpAuthEntry> = HashMap::new();
    let cd = match claude_dir() {
        Ok(cd) => cd,
        Err(_) => return (out, String::new()),
    };
    let cache_path = cd.join(MCP_AUTH_CACHE_FILE);
    let cache_path_str = cache_path.to_string_lossy().into_owned();
    let data = match fs::read(&cache_path) {
        Ok(d) => d,
        Err(_) => return (out, cache_path_str),
    };
    let root: Map<String, Value> = match serde_json::from_slice(&data) {
        Ok(m) => m,
        Err(_) => return (out, cache_path_str),
    };
    let now_ms = now_unix_millis();
    for (name, raw) in &root {
        let Value::Object(entry) = raw else {
            continue;
        };
        let Some(ts) = entry.get("timestamp").and_then(Value::as_f64) else {
            continue;
        };
        if ts <= 0.0 {
            continue;
        }
        let ts_ms = ts as i64;
        out.insert(
            name.clone(),
            McpAuthEntry {
                last_checked_unix_ms: ts_ms,
                cache_age_days: (now_ms - ts_ms) / MILLIS_PER_DAY,
            },
        );
    }
    (out, cache_path_str)
}

/// Orders rows deterministically by name, then source, then path. Mirrors
/// `lessServerRow`.
fn cmp_server_row(a: &MCPServerRow, b: &MCPServerRow) -> std::cmp::Ordering {
    a.name
        .cmp(&b.name)
        .then_with(|| a.source_kind.cmp(&b.source_kind))
        .then_with(|| a.source_path.cmp(&b.source_path))
}

/// Mirrors `time.Now().UnixMilli()`.
fn now_unix_millis() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

#[cfg(test)]
#[path = "mcp_status_tests.rs"]
mod mcp_status_tests;
