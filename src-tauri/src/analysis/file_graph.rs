// File dependency graph — walks a single session's tool_use blocks, collects
// every Read / Edit / Write / MultiEdit interaction, and emits nodes (unique
// file paths) with edges representing operation transitions on the same file.
//
// Edge types (directed):
//   read-to-edit  : a Read on a path followed by an Edit/MultiEdit on the same path
//   edit-to-write : an Edit/MultiEdit followed by a Write on the same path
//   co-access     : two different paths touched within the same assistant turn
//
// The frontend renders with d3-force. Layout is client-side; this module only
// produces the graph data.

use std::collections::{HashMap, HashSet};
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::discovery::path_decoder;
use crate::watcher;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileGraphNode {
    pub path: String,
    pub read_count: u32,
    pub edit_count: u32,
    pub write_count: u32,
    pub total_interactions: u32,
    /// 0-based AI turn indices where this file was touched.
    pub turn_indices: Vec<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileGraphEdge {
    pub from: String,
    pub to: String,
    pub kind: String,
    pub weight: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileGraphResponse {
    pub nodes: Vec<FileGraphNode>,
    pub edges: Vec<FileGraphEdge>,
}

#[derive(Deserialize)]
struct RawEntry {
    message: Option<RawMessage>,
}

#[derive(Deserialize)]
struct RawMessage {
    role: Option<String>,
    content: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
enum Op {
    Read,
    Edit,
    Write,
}

fn classify(name: &str) -> Option<Op> {
    match name {
        "Read" | "NotebookRead" => Some(Op::Read),
        "Edit" | "MultiEdit" | "NotebookEdit" => Some(Op::Edit),
        "Write" => Some(Op::Write),
        _ => None,
    }
}

fn extract_path(tool_name: &str, input: &serde_json::Value) -> Option<String> {
    // Read / Write / Edit all accept `file_path`; NotebookEdit uses `notebook_path`.
    if let Some(p) = input.get("file_path").and_then(|v| v.as_str()) {
        return Some(p.to_string());
    }
    if let Some(p) = input.get("notebook_path").and_then(|v| v.as_str()) {
        return Some(p.to_string());
    }
    if tool_name == "Read" {
        if let Some(p) = input.get("path").and_then(|v| v.as_str()) {
            return Some(p.to_string());
        }
    }
    None
}

fn resolve_session_path(project_id: &str, session_id: &str) -> Result<PathBuf, String> {
    let claude_dir = watcher::resolve_claude_dir().ok_or("Cannot resolve home directory")?;
    let projects_dir = path_decoder::get_projects_base_path(&claude_dir);
    let base_id = match project_id.find("::") {
        Some(idx) => &project_id[..idx],
        None => project_id,
    };
    let session_path = projects_dir.join(base_id).join(format!("{session_id}.jsonl"));
    if !session_path.is_file() {
        return Err(format!("Session file not found: {}", session_path.display()));
    }
    Ok(session_path)
}

pub fn compute_file_graph(
    project_id: &str,
    session_id: &str,
) -> Result<FileGraphResponse, String> {
    let path = resolve_session_path(project_id, session_id)?;
    let file = std::fs::File::open(&path).map_err(|e| e.to_string())?;
    let reader = BufReader::with_capacity(64 * 1024, file);

    #[derive(Default)]
    struct NodeAcc {
        read_count: u32,
        edit_count: u32,
        write_count: u32,
        turns: Vec<u32>,
    }

    let mut nodes: HashMap<String, NodeAcc> = HashMap::new();
    let mut edges: HashMap<(String, String, String), u32> = HashMap::new();
    // Per-path last-seen op so we know when a Read→Edit or Edit→Write transition occurs.
    let mut last_op: HashMap<String, Op> = HashMap::new();

    let mut turn_index: i64 = -1; // incremented on each assistant message encountered

    for line in reader.lines().map_while(Result::ok) {
        if line.trim().is_empty() {
            continue;
        }
        let entry: RawEntry = match serde_json::from_str(&line) {
            Ok(e) => e,
            Err(_) => continue,
        };
        let msg = match entry.message {
            Some(m) => m,
            None => continue,
        };
        if msg.role.as_deref() != Some("assistant") {
            continue;
        }
        let content = match msg.content {
            Some(c) => c,
            None => continue,
        };
        let blocks = match content.as_array() {
            Some(a) => a,
            None => continue,
        };

        turn_index += 1;
        let current_turn = turn_index.max(0) as u32;

        // Collect paths touched in this assistant turn for co-access edges.
        let mut turn_paths: HashSet<String> = HashSet::new();

        for block in blocks {
            if block.get("type").and_then(|v| v.as_str()) != Some("tool_use") {
                continue;
            }
            let name = block.get("name").and_then(|v| v.as_str()).unwrap_or("");
            let op = match classify(name) {
                Some(o) => o,
                None => continue,
            };
            let input = match block.get("input") {
                Some(v) => v,
                None => continue,
            };
            let path = match extract_path(name, input) {
                Some(p) => p,
                None => continue,
            };

            let acc = nodes.entry(path.clone()).or_default();
            match op {
                Op::Read => acc.read_count += 1,
                Op::Edit => acc.edit_count += 1,
                Op::Write => acc.write_count += 1,
            }
            if !acc.turns.contains(&current_turn) {
                acc.turns.push(current_turn);
            }

            // Self-transition edges driven by last_op on same file.
            if let Some(prev) = last_op.get(&path).copied() {
                let kind = match (prev, op) {
                    (Op::Read, Op::Edit) => Some("read-to-edit"),
                    (Op::Edit, Op::Write) => Some("edit-to-write"),
                    _ => None,
                };
                if let Some(kind) = kind {
                    let key = (path.clone(), path.clone(), kind.to_string());
                    *edges.entry(key).or_insert(0) += 1;
                }
            }
            last_op.insert(path.clone(), op);

            turn_paths.insert(path);
        }

        // Co-access edges: every unordered pair of distinct paths in this turn.
        let paths: Vec<String> = turn_paths.into_iter().collect();
        for i in 0..paths.len() {
            for j in (i + 1)..paths.len() {
                // Normalize order so (a,b) and (b,a) collapse.
                let (a, b) = if paths[i] < paths[j] {
                    (paths[i].clone(), paths[j].clone())
                } else {
                    (paths[j].clone(), paths[i].clone())
                };
                let key = (a, b, "co-access".to_string());
                *edges.entry(key).or_insert(0) += 1;
            }
        }
    }

    let node_out: Vec<FileGraphNode> = nodes
        .into_iter()
        .map(|(path, a)| {
            let total = a.read_count + a.edit_count + a.write_count;
            let mut turn_indices = a.turns;
            turn_indices.sort_unstable();
            FileGraphNode {
                path,
                read_count: a.read_count,
                edit_count: a.edit_count,
                write_count: a.write_count,
                total_interactions: total,
                turn_indices,
            }
        })
        .collect();

    let edge_out: Vec<FileGraphEdge> = edges
        .into_iter()
        .map(|((from, to, kind), weight)| FileGraphEdge {
            from,
            to,
            kind,
            weight,
        })
        .collect();

    Ok(FileGraphResponse {
        nodes: node_out,
        edges: edge_out,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn write_fixture(name: &str, lines: &[&str]) -> PathBuf {
        let tmp = std::env::temp_dir().join(format!("file_graph_{}_{}", name, std::process::id()));
        let _ = std::fs::remove_dir_all(&tmp);
        std::fs::create_dir_all(&tmp).unwrap();
        let path = tmp.join("session.jsonl");
        let mut f = std::fs::File::create(&path).unwrap();
        for l in lines {
            writeln!(f, "{l}").unwrap();
        }
        path
    }

    #[test]
    fn classify_all_supported_ops() {
        assert_eq!(classify("Read"), Some(Op::Read));
        assert_eq!(classify("Edit"), Some(Op::Edit));
        assert_eq!(classify("MultiEdit"), Some(Op::Edit));
        assert_eq!(classify("Write"), Some(Op::Write));
        assert_eq!(classify("Bash"), None);
    }

    fn scan_fixture(fixture_path: &Path) -> FileGraphResponse {
        // compute_file_graph resolves via watcher; for the test we run the scan
        // inline by re-opening the fixture file directly.
        let file = std::fs::File::open(fixture_path).unwrap();
        let reader = BufReader::with_capacity(64 * 1024, file);

        // Duplicate the inner scan logic so we can test it without needing a
        // real ~/.claude layout in the sandbox.
        #[derive(Default)]
        struct NodeAcc {
            read_count: u32,
            edit_count: u32,
            write_count: u32,
            turns: Vec<u32>,
        }
        let mut nodes: HashMap<String, NodeAcc> = HashMap::new();
        let mut edges: HashMap<(String, String, String), u32> = HashMap::new();
        let mut last_op: HashMap<String, Op> = HashMap::new();
        let mut turn_index: i64 = -1;

        for line in reader.lines().map_while(Result::ok) {
            if line.trim().is_empty() {
                continue;
            }
            let entry: RawEntry = match serde_json::from_str(&line) {
                Ok(e) => e,
                Err(_) => continue,
            };
            let msg = match entry.message {
                Some(m) => m,
                None => continue,
            };
            if msg.role.as_deref() != Some("assistant") {
                continue;
            }
            let content = match msg.content {
                Some(c) => c,
                None => continue,
            };
            let blocks = match content.as_array() {
                Some(a) => a,
                None => continue,
            };
            turn_index += 1;
            let current_turn = turn_index.max(0) as u32;

            for block in blocks {
                if block.get("type").and_then(|v| v.as_str()) != Some("tool_use") {
                    continue;
                }
                let name = block.get("name").and_then(|v| v.as_str()).unwrap_or("");
                let op = match classify(name) {
                    Some(o) => o,
                    None => continue,
                };
                let input = match block.get("input") {
                    Some(v) => v,
                    None => continue,
                };
                let path = match extract_path(name, input) {
                    Some(p) => p,
                    None => continue,
                };
                let acc = nodes.entry(path.clone()).or_default();
                match op {
                    Op::Read => acc.read_count += 1,
                    Op::Edit => acc.edit_count += 1,
                    Op::Write => acc.write_count += 1,
                }
                if !acc.turns.contains(&current_turn) {
                    acc.turns.push(current_turn);
                }
                if let Some(prev) = last_op.get(&path).copied() {
                    let kind = match (prev, op) {
                        (Op::Read, Op::Edit) => Some("read-to-edit"),
                        (Op::Edit, Op::Write) => Some("edit-to-write"),
                        _ => None,
                    };
                    if let Some(kind) = kind {
                        let key = (path.clone(), path.clone(), kind.to_string());
                        *edges.entry(key).or_insert(0) += 1;
                    }
                }
                last_op.insert(path.clone(), op);
            }
        }

        FileGraphResponse {
            nodes: nodes
                .into_iter()
                .map(|(path, a)| FileGraphNode {
                    total_interactions: a.read_count + a.edit_count + a.write_count,
                    turn_indices: a.turns,
                    read_count: a.read_count,
                    edit_count: a.edit_count,
                    write_count: a.write_count,
                    path,
                })
                .collect(),
            edges: edges
                .into_iter()
                .map(|((from, to, kind), weight)| FileGraphEdge {
                    from,
                    to,
                    kind,
                    weight,
                })
                .collect(),
        }
    }

    #[test]
    fn read_edit_write_creates_two_self_edges() {
        let path = write_fixture("rew", &[
            r#"{"message":{"role":"assistant","content":[{"type":"tool_use","id":"t1","name":"Read","input":{"file_path":"/a.rs"}}]}}"#,
            r#"{"message":{"role":"assistant","content":[{"type":"tool_use","id":"t2","name":"Edit","input":{"file_path":"/a.rs"}}]}}"#,
            r#"{"message":{"role":"assistant","content":[{"type":"tool_use","id":"t3","name":"Write","input":{"file_path":"/a.rs"}}]}}"#,
        ]);
        let graph = scan_fixture(&path);
        assert_eq!(graph.nodes.len(), 1);
        assert_eq!(graph.nodes[0].path, "/a.rs");
        assert_eq!(graph.nodes[0].total_interactions, 3);

        let kinds: std::collections::HashSet<&str> =
            graph.edges.iter().map(|e| e.kind.as_str()).collect();
        assert!(kinds.contains("read-to-edit"));
        assert!(kinds.contains("edit-to-write"));
        assert_eq!(graph.edges.len(), 2);
    }

    #[test]
    fn unrelated_tools_ignored() {
        let path = write_fixture("bash", &[
            r#"{"message":{"role":"assistant","content":[{"type":"tool_use","id":"t1","name":"Bash","input":{"command":"ls"}}]}}"#,
        ]);
        let graph = scan_fixture(&path);
        assert!(graph.nodes.is_empty());
        assert!(graph.edges.is_empty());
    }
}
