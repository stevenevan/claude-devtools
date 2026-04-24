/// Cross-session error hotspot detection.
///
/// Scans all project sessions for `tool_result` blocks with `is_error: true`,
/// groups by `(tool_name, error_prefix[0..100])`, and returns the hotspots that
/// recur across a minimum number of sessions within a time window.

use std::collections::HashMap;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::discovery::path_decoder;
use crate::watcher;

const ERROR_PREFIX_LEN: usize = 100;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepeatedToolError {
    pub tool_name: String,
    pub error_prefix: String,
    pub occurrences: u32,
    pub session_count: u32,
    pub session_ids: Vec<String>,
    pub last_seen_ms: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ErrorHotspotsResponse {
    pub repeated_errors: Vec<RepeatedToolError>,
    pub scanned_sessions: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ErrorClusterMember {
    pub session_id: String,
    pub tool_name: String,
    pub error_prefix: String,
    pub timestamp_ms: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ErrorCluster {
    /// Stable id (hash of the representative prefix + primary tool name).
    pub id: String,
    /// Representative error prefix (the most frequent one in the cluster).
    pub representative: String,
    /// Primary tool name (most frequent in the cluster).
    pub primary_tool: String,
    /// Distinct tool names present in this cluster.
    pub tool_names: Vec<String>,
    pub occurrence_count: u32,
    pub session_count: u32,
    pub last_seen_ms: f64,
    pub members: Vec<ErrorClusterMember>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ErrorClustersResponse {
    pub clusters: Vec<ErrorCluster>,
    pub scanned_sessions: u32,
}

#[derive(Deserialize)]
struct RawEntry {
    timestamp: Option<String>,
    message: Option<RawMessage>,
}

#[derive(Deserialize)]
struct RawMessage {
    role: Option<String>,
    content: Option<serde_json::Value>,
}

struct ToolCall {
    tool_name: String,
}

#[derive(Default)]
struct ErrorAccumulator {
    occurrences: u32,
    sessions: std::collections::HashSet<String>,
    last_seen_ms: f64,
}

fn parse_timestamp_ms(ts: &str) -> Option<f64> {
    chrono::DateTime::parse_from_rfc3339(ts)
        .ok()
        .map(|dt| dt.timestamp_millis() as f64)
}

fn tool_result_text(content: &serde_json::Value) -> String {
    match content {
        serde_json::Value::String(s) => s.clone(),
        serde_json::Value::Array(arr) => arr
            .iter()
            .filter_map(|block| {
                let kind = block.get("type")?.as_str()?;
                if kind == "text" {
                    block.get("text")?.as_str().map(|s| s.to_string())
                } else {
                    None
                }
            })
            .collect::<Vec<_>>()
            .join("\n"),
        _ => String::new(),
    }
}

fn normalize_error_prefix(text: &str) -> String {
    let trimmed = text.trim();
    let clipped: String = trimmed.chars().take(ERROR_PREFIX_LEN).collect();
    clipped.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn scan_session(
    path: &Path,
    session_id: &str,
    accumulator: &mut HashMap<(String, String), ErrorAccumulator>,
) -> Option<()> {
    let file = std::fs::File::open(path).ok()?;
    let reader = BufReader::with_capacity(64 * 1024, file);
    let mut in_flight: HashMap<String, ToolCall> = HashMap::new();

    for line in reader.lines().map_while(Result::ok) {
        if line.trim().is_empty() {
            continue;
        }
        let entry: RawEntry = match serde_json::from_str(&line) {
            Ok(e) => e,
            Err(_) => continue,
        };
        let ts_ms = entry
            .timestamp
            .as_deref()
            .and_then(parse_timestamp_ms)
            .unwrap_or(0.0);
        let msg = match entry.message {
            Some(m) => m,
            None => continue,
        };
        let content = match msg.content {
            Some(c) => c,
            None => continue,
        };
        let blocks = match content.as_array() {
            Some(a) => a,
            None => continue,
        };

        match msg.role.as_deref() {
            Some("assistant") => {
                for block in blocks {
                    if block.get("type").and_then(|v| v.as_str()) != Some("tool_use") {
                        continue;
                    }
                    let id = match block.get("id").and_then(|v| v.as_str()) {
                        Some(s) => s.to_string(),
                        None => continue,
                    };
                    let name = block
                        .get("name")
                        .and_then(|v| v.as_str())
                        .unwrap_or("unknown")
                        .to_string();
                    in_flight.insert(id, ToolCall { tool_name: name });
                }
            }
            Some("user") => {
                for block in blocks {
                    if block.get("type").and_then(|v| v.as_str()) != Some("tool_result") {
                        continue;
                    }
                    let id = match block.get("tool_use_id").and_then(|v| v.as_str()) {
                        Some(s) => s.to_string(),
                        None => continue,
                    };
                    let call = match in_flight.remove(&id) {
                        Some(c) => c,
                        None => continue,
                    };
                    let is_error =
                        block.get("is_error").and_then(|v| v.as_bool()).unwrap_or(false);
                    if !is_error {
                        continue;
                    }
                    let result_text = block
                        .get("content")
                        .map(tool_result_text)
                        .unwrap_or_default();
                    let prefix = normalize_error_prefix(&result_text);
                    if prefix.is_empty() {
                        continue;
                    }
                    let key = (call.tool_name, prefix);
                    let acc = accumulator.entry(key).or_default();
                    acc.occurrences += 1;
                    acc.sessions.insert(session_id.to_string());
                    if ts_ms > acc.last_seen_ms {
                        acc.last_seen_ms = ts_ms;
                    }
                }
            }
            _ => {}
        }
    }
    Some(())
}

fn resolve_project_dir(project_id: &str) -> Result<PathBuf, String> {
    let claude_dir = watcher::resolve_claude_dir().ok_or("Cannot resolve home directory")?;
    let projects_dir = path_decoder::get_projects_base_path(&claude_dir);
    let base_id = match project_id.find("::") {
        Some(idx) => &project_id[..idx],
        None => project_id,
    };
    let project_dir = projects_dir.join(base_id);
    if !project_dir.is_dir() {
        return Err(format!("Project directory not found: {base_id}"));
    }
    Ok(project_dir)
}

pub fn compute_error_hotspots(
    project_id: &str,
    days: u32,
    min_occurrences: u32,
) -> Result<ErrorHotspotsResponse, String> {
    let project_dir = resolve_project_dir(project_id)?;
    let days = days.clamp(1, 90);
    let min_occurrences = min_occurrences.max(2);

    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_millis() as f64;
    let cutoff_ms = now_ms - (days as f64) * 86_400_000.0;

    let entries = std::fs::read_dir(&project_dir).map_err(|e| e.to_string())?;
    let mut accumulator: HashMap<(String, String), ErrorAccumulator> = HashMap::new();
    let mut scanned_sessions: u32 = 0;

    for entry in entries.flatten() {
        let fname = entry.file_name();
        let fname = fname.to_string_lossy();
        if !fname.ends_with(".jsonl") {
            continue;
        }
        let modified_ms = entry
            .metadata()
            .ok()
            .and_then(|m| m.modified().ok())
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs_f64() * 1000.0)
            .unwrap_or(0.0);
        if modified_ms < cutoff_ms {
            continue;
        }
        let session_id = fname.trim_end_matches(".jsonl").to_string();
        scanned_sessions += 1;
        let _ = scan_session(&entry.path(), &session_id, &mut accumulator);
    }

    let mut hotspots: Vec<RepeatedToolError> = accumulator
        .into_iter()
        .filter_map(|((tool_name, error_prefix), acc)| {
            if acc.occurrences < min_occurrences {
                return None;
            }
            let mut session_ids: Vec<String> = acc.sessions.into_iter().collect();
            session_ids.sort();
            Some(RepeatedToolError {
                tool_name,
                error_prefix,
                occurrences: acc.occurrences,
                session_count: session_ids.len() as u32,
                session_ids,
                last_seen_ms: acc.last_seen_ms,
            })
        })
        .collect();

    hotspots.sort_by(|a, b| b.occurrences.cmp(&a.occurrences));

    Ok(ErrorHotspotsResponse {
        repeated_errors: hotspots,
        scanned_sessions,
    })
}

// Error Clustering (sprint 25)

const SHINGLE_K: usize = 3;
const MIN_SHARED_SHINGLES: usize = 2;

/// Tokenize an error message into lower-case word-like tokens.
fn tokenize(text: &str) -> Vec<String> {
    text.split(|c: char| !c.is_alphanumeric() && c != '_')
        .filter(|s| !s.is_empty())
        .map(|s| s.to_lowercase())
        .collect()
}

/// Extract k-word shingles from a token stream. When the tokens are shorter
/// than `k`, falls back to a single shingle of the whole thing so it still
/// contributes to the inverted index.
fn shingles(tokens: &[String], k: usize) -> std::collections::HashSet<String> {
    let mut out = std::collections::HashSet::new();
    if tokens.is_empty() {
        return out;
    }
    if tokens.len() < k {
        out.insert(tokens.join(" "));
        return out;
    }
    for window in tokens.windows(k) {
        out.insert(window.join(" "));
    }
    out
}

struct UnionFind {
    parent: Vec<usize>,
    rank: Vec<u8>,
}

impl UnionFind {
    fn new(n: usize) -> Self {
        Self {
            parent: (0..n).collect(),
            rank: vec![0; n],
        }
    }

    fn find(&mut self, mut i: usize) -> usize {
        while self.parent[i] != i {
            self.parent[i] = self.parent[self.parent[i]];
            i = self.parent[i];
        }
        i
    }

    fn union(&mut self, a: usize, b: usize) {
        let ra = self.find(a);
        let rb = self.find(b);
        if ra == rb {
            return;
        }
        if self.rank[ra] < self.rank[rb] {
            self.parent[ra] = rb;
        } else if self.rank[ra] > self.rank[rb] {
            self.parent[rb] = ra;
        } else {
            self.parent[rb] = ra;
            self.rank[ra] += 1;
        }
    }
}

struct RawError {
    session_id: String,
    tool_name: String,
    error_prefix: String,
    full_text: String,
    timestamp_ms: f64,
}

fn scan_session_raw_errors(path: &Path, session_id: &str, out: &mut Vec<RawError>) -> Option<()> {
    let file = std::fs::File::open(path).ok()?;
    let reader = BufReader::with_capacity(64 * 1024, file);
    let mut in_flight: HashMap<String, ToolCall> = HashMap::new();

    for line in reader.lines().map_while(Result::ok) {
        if line.trim().is_empty() {
            continue;
        }
        let entry: RawEntry = match serde_json::from_str(&line) {
            Ok(e) => e,
            Err(_) => continue,
        };
        let ts_ms = entry
            .timestamp
            .as_deref()
            .and_then(parse_timestamp_ms)
            .unwrap_or(0.0);
        let msg = match entry.message {
            Some(m) => m,
            None => continue,
        };
        let content = match msg.content {
            Some(c) => c,
            None => continue,
        };
        let blocks = match content.as_array() {
            Some(a) => a,
            None => continue,
        };

        match msg.role.as_deref() {
            Some("assistant") => {
                for block in blocks {
                    if block.get("type").and_then(|v| v.as_str()) != Some("tool_use") {
                        continue;
                    }
                    let id = match block.get("id").and_then(|v| v.as_str()) {
                        Some(s) => s.to_string(),
                        None => continue,
                    };
                    let name = block
                        .get("name")
                        .and_then(|v| v.as_str())
                        .unwrap_or("unknown")
                        .to_string();
                    in_flight.insert(id, ToolCall { tool_name: name });
                }
            }
            Some("user") => {
                for block in blocks {
                    if block.get("type").and_then(|v| v.as_str()) != Some("tool_result") {
                        continue;
                    }
                    let id = match block.get("tool_use_id").and_then(|v| v.as_str()) {
                        Some(s) => s.to_string(),
                        None => continue,
                    };
                    let call = match in_flight.remove(&id) {
                        Some(c) => c,
                        None => continue,
                    };
                    if block.get("is_error").and_then(|v| v.as_bool()) != Some(true) {
                        continue;
                    }
                    let result_text = block
                        .get("content")
                        .map(tool_result_text)
                        .unwrap_or_default();
                    let prefix = normalize_error_prefix(&result_text);
                    if prefix.is_empty() {
                        continue;
                    }
                    out.push(RawError {
                        session_id: session_id.to_string(),
                        tool_name: call.tool_name,
                        error_prefix: prefix,
                        full_text: result_text,
                        timestamp_ms: ts_ms,
                    });
                }
            }
            _ => {}
        }
    }
    Some(())
}

/// Cluster a list of errors by shingle hash + union-find. Two errors end up
/// in the same cluster when they share `MIN_SHARED_SHINGLES` or more word
/// shingles.
pub fn cluster_errors(errors: &[RawError], min_cluster_size: u32) -> Vec<ErrorCluster> {
    if errors.is_empty() {
        return Vec::new();
    }

    let shingle_sets: Vec<std::collections::HashSet<String>> = errors
        .iter()
        .map(|e| shingles(&tokenize(&e.full_text), SHINGLE_K))
        .collect();

    // Inverted index: shingle → indices that contain it.
    let mut inverted: HashMap<&str, Vec<usize>> = HashMap::new();
    for (i, set) in shingle_sets.iter().enumerate() {
        for s in set {
            inverted.entry(s.as_str()).or_default().push(i);
        }
    }

    // Count shared shingles per pair via the inverted index.
    let mut pair_shared: HashMap<(usize, usize), u32> = HashMap::new();
    for (_shingle, ids) in &inverted {
        if ids.len() < 2 {
            continue;
        }
        for i in 0..ids.len() {
            for j in (i + 1)..ids.len() {
                let a = ids[i];
                let b = ids[j];
                let key = if a < b { (a, b) } else { (b, a) };
                *pair_shared.entry(key).or_insert(0) += 1;
            }
        }
    }

    let mut uf = UnionFind::new(errors.len());
    for ((a, b), count) in pair_shared {
        if count >= MIN_SHARED_SHINGLES as u32 {
            uf.union(a, b);
        }
    }

    let mut groups: HashMap<usize, Vec<usize>> = HashMap::new();
    for i in 0..errors.len() {
        groups.entry(uf.find(i)).or_default().push(i);
    }

    let mut clusters: Vec<ErrorCluster> = groups
        .into_values()
        .filter(|members| members.len() as u32 >= min_cluster_size)
        .map(|members| build_cluster(errors, &members))
        .collect();

    clusters.sort_by(|a, b| b.occurrence_count.cmp(&a.occurrence_count));
    clusters
}

fn build_cluster(errors: &[RawError], member_ids: &[usize]) -> ErrorCluster {
    let mut tool_counts: HashMap<String, u32> = HashMap::new();
    let mut prefix_counts: HashMap<String, u32> = HashMap::new();
    let mut sessions: std::collections::HashSet<String> = std::collections::HashSet::new();
    let mut last_seen_ms = 0.0f64;

    let mut members: Vec<ErrorClusterMember> = Vec::with_capacity(member_ids.len());
    for &id in member_ids {
        let e = &errors[id];
        *tool_counts.entry(e.tool_name.clone()).or_insert(0) += 1;
        *prefix_counts.entry(e.error_prefix.clone()).or_insert(0) += 1;
        sessions.insert(e.session_id.clone());
        if e.timestamp_ms > last_seen_ms {
            last_seen_ms = e.timestamp_ms;
        }
        members.push(ErrorClusterMember {
            session_id: e.session_id.clone(),
            tool_name: e.tool_name.clone(),
            error_prefix: e.error_prefix.clone(),
            timestamp_ms: e.timestamp_ms,
        });
    }

    let primary_tool = tool_counts
        .iter()
        .max_by_key(|(_, v)| *v)
        .map(|(k, _)| k.clone())
        .unwrap_or_else(|| "unknown".to_string());
    let representative = prefix_counts
        .iter()
        .max_by_key(|(_, v)| *v)
        .map(|(k, _)| k.clone())
        .unwrap_or_default();

    let mut tool_names: Vec<String> = tool_counts.into_keys().collect();
    tool_names.sort();

    members.sort_by(|a, b| b.timestamp_ms.partial_cmp(&a.timestamp_ms).unwrap_or(std::cmp::Ordering::Equal));

    let id = format!("cluster-{primary_tool}-{:x}", fxhash(&representative));

    ErrorCluster {
        id,
        representative,
        primary_tool,
        tool_names,
        occurrence_count: member_ids.len() as u32,
        session_count: sessions.len() as u32,
        last_seen_ms,
        members,
    }
}

fn fxhash(s: &str) -> u64 {
    // FxHash-lite — small, deterministic, good enough for display ids.
    let mut hash: u64 = 0xcbf29ce484222325;
    for byte in s.as_bytes() {
        hash ^= *byte as u64;
        hash = hash.wrapping_mul(0x100000001b3);
    }
    hash
}

pub fn compute_error_clusters(
    project_id: &str,
    days: u32,
    min_cluster_size: u32,
) -> Result<ErrorClustersResponse, String> {
    let project_dir = resolve_project_dir(project_id)?;
    let days = days.clamp(1, 90);
    let min_cluster_size = min_cluster_size.max(2);

    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_millis() as f64;
    let cutoff_ms = now_ms - (days as f64) * 86_400_000.0;

    let entries = std::fs::read_dir(&project_dir).map_err(|e| e.to_string())?;
    let mut raw_errors: Vec<RawError> = Vec::new();
    let mut scanned_sessions: u32 = 0;

    for entry in entries.flatten() {
        let fname = entry.file_name();
        let fname = fname.to_string_lossy();
        if !fname.ends_with(".jsonl") {
            continue;
        }
        let modified_ms = entry
            .metadata()
            .ok()
            .and_then(|m| m.modified().ok())
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs_f64() * 1000.0)
            .unwrap_or(0.0);
        if modified_ms < cutoff_ms {
            continue;
        }
        let session_id = fname.trim_end_matches(".jsonl").to_string();
        scanned_sessions += 1;
        let _ = scan_session_raw_errors(&entry.path(), &session_id, &mut raw_errors);
    }

    let clusters = cluster_errors(&raw_errors, min_cluster_size);
    Ok(ErrorClustersResponse {
        clusters,
        scanned_sessions,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_prefix() {
        assert_eq!(normalize_error_prefix("  hello   world  "), "hello world");
        let long = "a".repeat(200);
        assert_eq!(normalize_error_prefix(&long).chars().count(), ERROR_PREFIX_LEN);
    }

    fn raw(session: &str, tool: &str, msg: &str) -> RawError {
        RawError {
            session_id: session.to_string(),
            tool_name: tool.to_string(),
            error_prefix: normalize_error_prefix(msg),
            full_text: msg.to_string(),
            timestamp_ms: 0.0,
        }
    }

    #[test]
    fn near_duplicate_errors_land_in_same_cluster() {
        let errors = vec![
            raw("s1", "Bash", "Error: file not found at /path/to/foo.rs"),
            raw("s2", "Bash", "Error: file not found at /path/to/bar.rs"),
            raw("s3", "Read", "Permission denied when reading /etc/passwd"),
        ];
        let clusters = cluster_errors(&errors, 2);
        assert_eq!(clusters.len(), 1);
        assert_eq!(clusters[0].occurrence_count, 2);
        assert_eq!(clusters[0].session_count, 2);
        assert_eq!(clusters[0].primary_tool, "Bash");
    }

    #[test]
    fn disjoint_errors_are_not_clustered() {
        let errors = vec![
            raw("s1", "Bash", "Error: file not found"),
            raw("s2", "Read", "Syntax error on line 12"),
        ];
        let clusters = cluster_errors(&errors, 2);
        assert!(clusters.is_empty());
    }

    #[test]
    fn min_cluster_size_enforced() {
        let errors = vec![
            raw("s1", "Bash", "Error: file not found at /path/a"),
            raw("s2", "Bash", "Error: file not found at /path/b"),
        ];
        // min_cluster_size=3 means this 2-member cluster is dropped.
        let clusters = cluster_errors(&errors, 3);
        assert!(clusters.is_empty());
    }
}
