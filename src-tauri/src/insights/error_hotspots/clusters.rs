/// Error Clustering (sprint 25)
use std::collections::HashMap;
use std::io::{BufRead, BufReader};
use std::path::Path;

use serde::{Deserialize, Serialize};

use super::shared::{
    normalize_error_prefix, parse_timestamp_ms, resolve_project_dir, tool_result_text, RawEntry,
    ToolCall,
};

const SHINGLE_K: usize = 3;
const MIN_SHARED_SHINGLES: usize = 2;

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

/// Tokenize an error message into lower-case word-like tokens. Mirrors Go's
/// `strings.FieldsFunc(strings.ToLower(text), ...)`: lower-case FIRST, then split
/// on any rune that is not ASCII `[a-z0-9_]` (ASCII-only, not Unicode-aware).
fn tokenize(text: &str) -> Vec<String> {
    text.to_lowercase()
        .split(|c: char| !c.is_ascii_lowercase() && !c.is_ascii_digit() && c != '_')
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
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
fn cluster_errors(errors: &[RawError], min_cluster_size: u32) -> Vec<ErrorCluster> {
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

    let primary_tool = max_by_count_alpha(&tool_counts, "unknown");
    let representative = max_by_count_alpha(&prefix_counts, "");

    let mut tool_names: Vec<String> = tool_counts.into_keys().collect();
    tool_names.sort();

    members.sort_by(|a, b| {
        b.timestamp_ms
            .partial_cmp(&a.timestamp_ms)
            .unwrap_or(std::cmp::Ordering::Equal)
    });

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

/// Returns the key with the highest count; ties broken by smallest key.
/// Mirrors Go's `maxByCountAlpha`.
fn max_by_count_alpha(counts: &HashMap<String, u32>, fallback: &str) -> String {
    let mut best = fallback.to_string();
    let mut best_count: u32 = 0;
    for (k, &v) in counts.iter() {
        if v > best_count || (v == best_count && k.as_str() < best.as_str()) {
            best = k.clone();
            best_count = v;
        }
    }
    best
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

    // Go's os.ReadDir returns entries sorted by filename; mirror that.
    let mut entries: Vec<_> = std::fs::read_dir(&project_dir)
        .map_err(|e| e.to_string())?
        .flatten()
        .collect();
    entries.sort_by_key(|e| e.file_name());

    let mut raw_errors: Vec<RawError> = Vec::new();
    let mut scanned_sessions: u32 = 0;

    for entry in entries {
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
            .map(|d| d.as_millis() as f64)
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
    use super::super::shared::normalize_error_prefix;
    use super::*;

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
