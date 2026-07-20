//! Ports `internal/files/memory.go` — the read + integrity model for Claude
//! Code's own per-project memory dirs (`<root>/projects/<encoded>/memory/`) and
//! agent memory (`<root>/agent-memory/<name>/`). SECURITY-CRITICAL: MEMORY.md is
//! re-loaded into EVERY future session, so a mis-resolved dir would corrupt the
//! wrong project's recall index. Two guards make that impossible — every dir is
//! addressed by a kind-prefixed ID (`project:<encoded>` / `agent:<name>`), NEVER
//! a client path, and `resolve_memory_dir` resolves by DETERMINISTIC split +
//! validate + confine-PARENT, never a scan.
//!
//! `root` is always the caller's EffectivePath, threaded from the service layer.
//! This file is read-only (`stat`/`read` only); writes live in `memory_write`.

use std::collections::{HashMap, HashSet};
use std::fs;
use std::io;
use std::path::Path;
use std::sync::LazyLock;

use regex::Regex;
use serde::{Deserialize, Serialize};

use crate::discovery::path_decoder::{decode_path, is_valid_project_id};
use crate::files::pathutil::{confine, parse_frontmatter, split_lines};

/// One addressable memory directory. `id` is a kind-prefixed, server-derived
/// token that writes take instead of a path; `label` is the human-decoded name.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryDir {
    pub id: String,
    pub label: String,
    pub path: String,
    pub kind: String, // "project" | "agent"
}

/// One fact file on disk with its parsed frontmatter.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryFile {
    pub file_name: String,
    pub name: String,
    pub description: String,
    #[serde(rename = "type")]
    pub r#type: String,
}

/// A byte-exact MEMORY.md edit an integrity finding proposes. `op` ∈ "add" |
/// "remove"; `line` is the exact index line to append (add) or remove (verbatim).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryIndexFix {
    pub op: String,
    pub line: String,
}

/// One integrity issue. `fix` is non-nil only for orphan-file (add) and
/// dangling-index (remove); dangling-link and duplicate-slug are informational.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryFinding {
    pub kind: String,
    pub file: String,
    pub detail: String,
    pub fix: Option<MemoryIndexFix>,
}

/// The full integrity result for one memory dir.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryReport {
    pub dir: MemoryDir,
    pub files: Vec<MemoryFile>,
    pub findings: Vec<MemoryFinding>,
}

// memory_link_re matches a markdown link on one MEMORY.md index line; group 1 is
// the referenced fact-file target. wiki_link_re matches a [[name]] cross-ref.
static MEMORY_LINK_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\[[^\]]*\]\(([^)]+)\)").unwrap());
static WIKI_LINK_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\[\[([^\]]+)\]\]").unwrap());

/// Reports whether `path` exists and is a directory (`os.Stat`, follows
/// symlinks). Shared with `skills_inventory` (Go: `isDir`).
pub(crate) fn is_dir(path: &str) -> bool {
    fs::metadata(path).map(|m| m.is_dir()).unwrap_or(false)
}

/// Faithful port of Go's `filepath.Clean` for unix (separator `/`), used by the
/// single-segment validators' lexically-clean guard.
pub(crate) fn go_path_clean(path: &str) -> String {
    if path.is_empty() {
        return ".".to_string();
    }
    let bytes = path.as_bytes();
    let n = bytes.len();
    let rooted = bytes[0] == b'/';
    let mut out: Vec<u8> = Vec::with_capacity(n + 1);
    let mut r = 0usize;
    let mut dotdot = 0usize;
    if rooted {
        out.push(b'/');
        r = 1;
        dotdot = 1;
    }
    while r < n {
        if bytes[r] == b'/' {
            r += 1;
        } else if bytes[r] == b'.' && (r + 1 == n || bytes[r + 1] == b'/') {
            r += 1;
        } else if bytes[r] == b'.'
            && bytes[r + 1] == b'.'
            && (r + 2 == n || bytes[r + 2] == b'/')
        {
            r += 2;
            if out.len() > dotdot {
                let mut w = out.len() - 1;
                while w > dotdot && out[w] != b'/' {
                    w -= 1;
                }
                out.truncate(w);
            } else if !rooted {
                if !out.is_empty() {
                    out.push(b'/');
                }
                out.push(b'.');
                out.push(b'.');
                dotdot = out.len();
            }
        } else {
            if (rooted && out.len() != 1) || (!rooted && !out.is_empty()) {
                out.push(b'/');
            }
            while r < n && bytes[r] != b'/' {
                out.push(bytes[r]);
                r += 1;
            }
        }
    }
    if out.is_empty() {
        out.push(b'.');
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// Go's `filepath.Ext`: the suffix beginning at the final dot, or "".
pub(crate) fn go_ext(name: &str) -> &str {
    match name.rfind('.') {
        Some(i) => &name[i..],
        None => "",
    }
}

/// Rejects any agent name that isn't a single, filename-safe segment — the shape
/// of `validate_skill_name`.
fn validate_memory_segment(name: &str) -> Result<(), String> {
    if name.is_empty()
        || name == "."
        || name == ".."
        || name.contains('/')
        || name.contains(std::path::MAIN_SEPARATOR)
        || Path::new(name).is_absolute()
        || go_path_clean(name) != name
    {
        return Err(format!("files: invalid memory agent name {name:?}"));
    }
    Ok(())
}

/// Splits a kind-prefixed dirID into its (parentDir, leaf) plus a partial
/// MemoryDir, validating the encoded segment WITHOUT any filesystem call.
fn memory_dir_target(root: &str, dir_id: &str) -> Result<(String, String, MemoryDir), String> {
    let Some((kind, rest)) = dir_id.split_once(':') else {
        return Err(format!("files: invalid memory dir id {dir_id:?}"));
    };
    match kind {
        "project" => {
            if !is_valid_project_id(rest) {
                return Err(format!("files: invalid memory project id {rest:?}"));
            }
            let mut label = decode_path(rest);
            if label.is_empty() {
                label = rest.to_string();
            }
            let parent = Path::new(root).join("projects").join(rest);
            Ok((
                parent.to_string_lossy().into_owned(),
                "memory".to_string(),
                MemoryDir {
                    id: dir_id.to_string(),
                    label,
                    path: String::new(),
                    kind: "project".to_string(),
                },
            ))
        }
        "agent" => {
            validate_memory_segment(rest)?;
            let parent = Path::new(root).join("agent-memory");
            Ok((
                parent.to_string_lossy().into_owned(),
                rest.to_string(),
                MemoryDir {
                    id: dir_id.to_string(),
                    label: rest.to_string(),
                    path: String::new(),
                    kind: "agent".to_string(),
                },
            ))
        }
        _ => Err(format!("files: unknown memory dir kind {kind:?}")),
    }
}

/// Resolves a kind-prefixed dirID to an absolute memory dir path confined within
/// root, by DETERMINISTIC split + confine of the PARENT — NEVER a scan. The
/// parent must exist and resolve inside canonRoot.
pub fn resolve_memory_dir(root: &str, dir_id: &str) -> Result<(String, MemoryDir), String> {
    let (parent_dir, leaf, mut dir) = memory_dir_target(root, dir_id)?;

    let canon_root =
        fs::canonicalize(root).map_err(|e| format!("files: memory root {root:?}: {e}"))?;
    let parent_canon = fs::canonicalize(&parent_dir)
        .map_err(|e| format!("files: memory dir parent {parent_dir:?}: {e}"))?;

    let canon_root_str = canon_root.to_string_lossy().into_owned();
    let parent_canon_str = parent_canon.to_string_lossy().into_owned();
    confine(&parent_canon_str, &canon_root_str)?;

    let mem_dir = parent_canon.join(&leaf).to_string_lossy().into_owned();
    dir.path = mem_dir.clone();
    Ok((mem_dir, dir))
}

/// Enumerates `<root>/projects/*/memory` (only where the memory subdir exists)
/// plus `<root>/agent-memory/*`, skipping dotfiles and non-directories. Returns
/// an empty (non-nil) slice when neither root exists.
pub fn list_memory_dirs(root: &str) -> Result<Vec<MemoryDir>, String> {
    let mut out: Vec<MemoryDir> = Vec::new();

    let projects_dir = Path::new(root).join("projects");
    if let Ok(entries) = fs::read_dir(&projects_dir) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            if name.is_empty() || name.starts_with('.') {
                continue;
            }
            if !entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                continue;
            }
            let mem_dir = projects_dir.join(&name).join("memory");
            if !is_dir(&mem_dir.to_string_lossy()) {
                continue;
            }
            let mut label = decode_path(&name);
            if label.is_empty() {
                label = name.clone();
            }
            out.push(MemoryDir {
                id: format!("project:{name}"),
                label,
                path: mem_dir.to_string_lossy().into_owned(),
                kind: "project".to_string(),
            });
        }
    }

    let agent_dir = Path::new(root).join("agent-memory");
    if let Ok(entries) = fs::read_dir(&agent_dir) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            if name.is_empty() || name.starts_with('.') {
                continue;
            }
            if !entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                continue;
            }
            out.push(MemoryDir {
                id: format!("agent:{name}"),
                label: name.clone(),
                path: agent_dir.join(&name).to_string_lossy().into_owned(),
                kind: "agent".to_string(),
            });
        }
    }

    out.sort_by(|a, b| a.label.cmp(&b.label));
    Ok(out)
}

/// Resolves the dir, parses MEMORY.md (may be absent → empty index) and every
/// fact file, and reports the four finding kinds. No filesystem writes.
pub fn memory_integrity(root: &str, dir_id: &str) -> Result<MemoryReport, String> {
    let (mem_dir, dir) = resolve_memory_dir(root, dir_id)?;

    let index_data = match fs::read(Path::new(&mem_dir).join("MEMORY.md")) {
        Ok(d) => d,
        Err(e) if e.kind() == io::ErrorKind::NotFound => Vec::new(),
        Err(e) => return Err(format!("files: read memory index: {e}")),
    };
    let index_str = String::from_utf8_lossy(&index_data);
    let entries = index_entries(&index_str);

    let facts = read_fact_files(&mem_dir);

    let mut report = MemoryReport {
        dir,
        files: Vec::with_capacity(facts.len()),
        findings: Vec::new(),
    };
    for f in &facts {
        report.files.push(f.file.clone());
    }
    report.findings.extend(orphan_findings(&facts, &entries));
    report
        .findings
        .extend(dangling_index_findings(&mem_dir, &entries));
    report.findings.extend(dangling_link_findings(&facts));
    report.findings.extend(duplicate_slug_findings(&facts));
    Ok(report)
}

/// One MEMORY.md link line: `target` is the captured fact-file name, `line` is
/// the verbatim source line so a remove fix matches byte-for-byte.
struct IndexEntry {
    target: String,
    line: String,
}

fn index_entries(content: &str) -> Vec<IndexEntry> {
    let mut out = Vec::new();
    for line in split_lines(content) {
        if let Some(caps) = MEMORY_LINK_RE.captures(line) {
            out.push(IndexEntry {
                target: caps[1].to_string(),
                line: line.to_string(),
            });
        }
    }
    out
}

/// A parsed fact file plus its raw content (kept for the [[link]] scan).
struct FactFile {
    file: MemoryFile,
    content: String,
}

/// Reads the fact-file set — non-hidden *.md excluding MEMORY.md (the .md-ext
/// filter drops *.bak/*.tmp byproducts). Sorted by FileName. A missing dir
/// yields an empty slice.
fn read_fact_files(mem_dir: &str) -> Vec<FactFile> {
    let Ok(entries) = fs::read_dir(mem_dir) else {
        return Vec::new();
    };
    let mut out = Vec::new();
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.is_empty() || name.starts_with('.') {
            continue;
        }
        if entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
            continue;
        }
        if name == "MEMORY.md" || go_ext(&name) != ".md" {
            continue;
        }
        let Ok(content) = fs::read(entry.path()) else {
            continue;
        };
        let content_str = String::from_utf8_lossy(&content).into_owned();
        let fm = parse_frontmatter(&content_str);
        out.push(FactFile {
            file: MemoryFile {
                file_name: name,
                name: fm.get("name").cloned().unwrap_or_default(),
                description: fm.get("description").cloned().unwrap_or_default(),
                r#type: fm.get("type").cloned().unwrap_or_default(),
            },
            content: content_str,
        });
    }
    out.sort_by(|a, b| a.file.file_name.cmp(&b.file.file_name));
    out
}

/// Flags each fact file the index never references, proposing an "add" fix with
/// the exact line to append.
fn orphan_findings(facts: &[FactFile], entries: &[IndexEntry]) -> Vec<MemoryFinding> {
    let referenced: HashSet<&str> = entries.iter().map(|e| e.target.as_str()).collect();
    let mut out = Vec::new();
    for f in facts {
        if referenced.contains(f.file.file_name.as_str()) {
            continue;
        }
        let mut label = f.file.description.clone();
        if label.is_empty() {
            label = f.file.name.clone();
        }
        if label.is_empty() {
            label = f
                .file
                .file_name
                .strip_suffix(".md")
                .unwrap_or(&f.file.file_name)
                .to_string();
        }
        let line = format!(
            "- [{fname}]({fname}) — {label}",
            fname = f.file.file_name
        );
        out.push(MemoryFinding {
            kind: "orphan-file".to_string(),
            file: f.file.file_name.clone(),
            detail: "fact file is not referenced in MEMORY.md".to_string(),
            fix: Some(MemoryIndexFix {
                op: "add".to_string(),
                line,
            }),
        });
    }
    out
}

/// Flags each index entry whose target file is absent on disk, proposing a
/// "remove" fix carrying the verbatim source line.
fn dangling_index_findings(mem_dir: &str, entries: &[IndexEntry]) -> Vec<MemoryFinding> {
    let mut out = Vec::new();
    for e in entries {
        if fs::metadata(Path::new(mem_dir).join(&e.target)).is_ok() {
            continue;
        }
        out.push(MemoryFinding {
            kind: "dangling-index".to_string(),
            file: e.target.clone(),
            detail: "indexed file is missing on disk".to_string(),
            fix: Some(MemoryIndexFix {
                op: "remove".to_string(),
                line: e.line.clone(),
            }),
        });
    }
    out
}

/// Flags each [[name]] in a fact-file body that matches no fact file (by
/// FileName-without-.md OR by frontmatter Name). Informational — Fix is nil.
fn dangling_link_findings(facts: &[FactFile]) -> Vec<MemoryFinding> {
    let mut by_base: HashSet<String> = HashSet::new();
    let mut by_name: HashSet<String> = HashSet::new();
    for f in facts {
        by_base.insert(
            f.file
                .file_name
                .strip_suffix(".md")
                .unwrap_or(&f.file.file_name)
                .to_string(),
        );
        if !f.file.name.is_empty() {
            by_name.insert(f.file.name.clone());
        }
    }
    let mut out = Vec::new();
    for f in facts {
        let mut seen: HashSet<String> = HashSet::new();
        for caps in WIKI_LINK_RE.captures_iter(&f.content) {
            let name = caps[1].to_string();
            if by_base.contains(&name) || by_name.contains(&name) || seen.contains(&name) {
                continue;
            }
            seen.insert(name.clone());
            out.push(MemoryFinding {
                kind: "dangling-link".to_string(),
                file: f.file.file_name.clone(),
                detail: format!("[[{name}]] references an unknown memory"),
                fix: None,
            });
        }
    }
    out
}

/// Flags each frontmatter Name shared by 2+ fact files — one finding per
/// duplicated slug. Manual merge, so Fix is nil.
fn duplicate_slug_findings(facts: &[FactFile]) -> Vec<MemoryFinding> {
    let mut by_slug: HashMap<String, Vec<String>> = HashMap::new();
    let mut order: Vec<String> = Vec::new();
    for f in facts {
        let name = &f.file.name;
        if name.is_empty() {
            continue;
        }
        if !by_slug.contains_key(name) {
            order.push(name.clone());
        }
        by_slug
            .entry(name.clone())
            .or_default()
            .push(f.file.file_name.clone());
    }
    let mut out = Vec::new();
    for name in &order {
        let files = &by_slug[name];
        if files.len() < 2 {
            continue;
        }
        out.push(MemoryFinding {
            kind: "duplicate-slug".to_string(),
            file: String::new(),
            detail: format!("name {:?} is shared by {}", name, files.join(", ")),
            fix: None,
        });
    }
    out
}

#[cfg(test)]
#[path = "memory_tests.rs"]
mod memory_tests;
