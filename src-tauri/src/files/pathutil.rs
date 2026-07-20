//! Ports `internal/files/pathutil.go` — the SECURITY BOUNDARY for @-mention
//! path validation and the shared confinement model. Guards are reproduced
//! verbatim; error sentinels are byte-identical (the frontend matches them
//! literally). See `Confine`: a NON-EXISTENT candidate is returned UNCHANGED
//! with no containment check (first-create), so every resolver confines the
//! PARENT dir, never the leaf.

use std::fs;
use std::io;
use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::discovery::path_decoder::{
    extract_base_dir, is_valid_project_id, is_valid_session_id,
};

// Error sentinel strings match path_util.rs verbatim.
pub const ERR_INVALID_SESSION_ID: &str = "invalid session id";
pub const ERR_INVALID_PROJECT_ID: &str = "invalid project id";
pub const ERR_INVALID_SUBAGENT_ID: &str = "invalid subagent id";
pub const ERR_ESCAPES_ROOT: &str = "path escapes session root";

/// Validates a project+session pair without touching the filesystem.
/// Mirrors `ValidateSessionIDPair`.
pub fn validate_session_id_pair(project_id: &str, session_id: &str) -> Result<(), String> {
    if !is_valid_session_id(session_id) {
        return Err(ERR_INVALID_SESSION_ID.to_string());
    }
    if !is_valid_project_id(project_id) {
        return Err(ERR_INVALID_PROJECT_ID.to_string());
    }
    Ok(())
}

/// Checks that `candidate`, once canonicalized, is contained within
/// `canonical_root`. Non-existent candidates are returned unchanged (first-time
/// create relies on this). Mirrors `Confine` VERBATIM.
pub fn confine(candidate: &str, canonical_root: &str) -> Result<String, String> {
    // os.Stat follows symlinks; only an IsNotExist result early-returns.
    match fs::metadata(candidate) {
        Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(candidate.to_string()),
        _ => {}
    }
    let canon = fs::canonicalize(candidate).map_err(|_| ERR_ESCAPES_ROOT.to_string())?;
    // rel must not start with ".." — Path::starts_with is component-aware.
    if !canon.starts_with(canonical_root) {
        return Err(ERR_ESCAPES_ROOT.to_string());
    }
    Ok(canon.to_string_lossy().into_owned())
}

/// Resolves a session JSONL path within `canonical_root`.
/// Mirrors `ResolveSessionPath`.
pub fn resolve_session_path(
    canonical_root: &str,
    project_id: &str,
    session_id: &str,
) -> Result<String, String> {
    validate_session_id_pair(project_id, session_id)?;
    let base = extract_base_dir(project_id);
    let candidate = Path::new(canonical_root)
        .join(base)
        .join(format!("{session_id}.jsonl"));
    confine(&candidate.to_string_lossy(), canonical_root)
}

/// Resolves a subagent JSONL path within `canonical_root`.
/// Mirrors `ResolveSubagentPath`.
pub fn resolve_subagent_path(
    canonical_root: &str,
    project_id: &str,
    session_id: &str,
    subagent_id: &str,
) -> Result<String, String> {
    validate_session_id_pair(project_id, session_id)?;
    if !is_valid_session_id(subagent_id) {
        return Err(ERR_INVALID_SUBAGENT_ID.to_string());
    }
    let base = extract_base_dir(project_id);
    let candidate = Path::new(canonical_root)
        .join(base)
        .join(session_id)
        .join("subagents")
        .join(format!("{subagent_id}.jsonl"));
    confine(&candidate.to_string_lossy(), canonical_root)
}

// ---------------------------------------------------------------------------
// files.rs — file-system readers
// ---------------------------------------------------------------------------

/// Mirrors the JSON shape from `validate_path`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PathResult {
    pub exists: bool,
    pub is_directory: bool,
}

/// Checks whether `rel_path` exists inside `project_path` and returns
/// traversal-safe existence + is_directory. Mirrors `ValidatePath`.
pub fn validate_path(rel_path: &str, project_path: &str) -> PathResult {
    let joined = Path::new(project_path).join(rel_path);

    if let (Ok(base_can), Ok(can)) = (
        fs::canonicalize(project_path),
        fs::canonicalize(&joined),
    ) {
        if !can.starts_with(&base_can) {
            return PathResult {
                exists: false,
                is_directory: false,
            };
        }
    }

    match fs::metadata(&joined) {
        Ok(info) => PathResult {
            exists: true,
            is_directory: info.is_dir(),
        },
        Err(_) => PathResult {
            exists: false,
            is_directory: false,
        },
    }
}

/// Maps mention value → exists bool. Mirrors `MentionValidation`.
pub type MentionValidation = std::collections::HashMap<String, bool>;

/// Checks each mention's "value" field against `project_path`.
/// Mirrors `ValidateMentions`.
pub fn validate_mentions(
    mentions: &[serde_json::Map<String, serde_json::Value>],
    project_path: &str,
) -> MentionValidation {
    let mut result = MentionValidation::new();
    for m in mentions {
        let Some(val) = m.get("value").and_then(|v| v.as_str()) else {
            continue;
        };
        let joined = Path::new(project_path).join(val);
        result.insert(val.to_string(), fs::metadata(&joined).is_ok());
    }
    result
}

/// One entry in the `read_claude_md_files` result.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeMdFile {
    pub path: String,
    pub content: String,
    pub exists: bool,
}

/// Reads global + project CLAUDE.md + .claude/rules/*.md.
/// Mirrors `ReadClaudeMdFiles`.
pub fn read_claude_md_files(project_root: &str) -> std::collections::HashMap<String, ClaudeMdFile> {
    let mut files = std::collections::HashMap::new();

    if let Some(home) = dirs::home_dir() {
        let global = home.join(".claude").join("CLAUDE.md");
        if let Ok(content) = fs::read_to_string(&global) {
            files.insert(
                "global".to_string(),
                ClaudeMdFile {
                    path: global.to_string_lossy().into_owned(),
                    content,
                    exists: true,
                },
            );
        }
    }

    let project_md = Path::new(project_root).join("CLAUDE.md");
    if let Ok(content) = fs::read_to_string(&project_md) {
        files.insert(
            "project".to_string(),
            ClaudeMdFile {
                path: project_md.to_string_lossy().into_owned(),
                content,
                exists: true,
            },
        );
    }

    let rules_dir = Path::new(project_root).join(".claude").join("rules");
    if let Ok(entries) = fs::read_dir(&rules_dir) {
        let mut names: Vec<_> = entries
            .filter_map(|e| e.ok())
            .filter_map(|e| {
                let name = e.file_name().to_string_lossy().into_owned();
                let is_dir = e.file_type().map(|t| t.is_dir()).unwrap_or(false);
                if is_dir || !name.ends_with(".md") {
                    None
                } else {
                    Some(name)
                }
            })
            .collect();
        names.sort();
        for name in names {
            let p = rules_dir.join(&name);
            if let Ok(content) = fs::read_to_string(&p) {
                files.insert(
                    format!("rules/{name}"),
                    ClaudeMdFile {
                        path: p.to_string_lossy().into_owned(),
                        content,
                        exists: true,
                    },
                );
            }
        }
    }

    files
}

/// Reads CLAUDE.md inside a single directory. Mirrors `ReadDirectoryClaudeMd`.
pub fn read_directory_claude_md(dir_path: &str) -> ClaudeMdFile {
    let md_path = Path::new(dir_path).join("CLAUDE.md");
    match fs::read_to_string(&md_path) {
        Ok(content) => ClaudeMdFile {
            path: md_path.to_string_lossy().into_owned(),
            content,
            exists: true,
        },
        Err(_) => ClaudeMdFile {
            path: md_path.to_string_lossy().into_owned(),
            content: String::new(),
            exists: false,
        },
    }
}

/// Mirrors `read_mentioned_file`'s JSON shape.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MentionedFileResult {
    pub path: String,
    pub content: String,
    pub exists: bool,
    pub tokens: i64,
    pub truncated: bool,
}

const DEFAULT_MAX_TOKENS: i64 = 100_000;

/// Reads a file after canonicalization-checks against `project_root`. Returns
/// None when the path escapes the root or the file doesn't exist.
/// Mirrors `ReadMentionedFile`.
pub fn read_mentioned_file(
    absolute_path: &str,
    project_root: &str,
    max_tokens: Option<i64>,
) -> Option<MentionedFileResult> {
    if let (Ok(cp), Ok(cr)) = (
        fs::canonicalize(absolute_path),
        fs::canonicalize(project_root),
    ) {
        if !cp.starts_with(&cr) {
            return None;
        }
    }

    let info = fs::metadata(absolute_path).ok()?;
    if info.is_dir() {
        return None;
    }
    let raw = fs::read(absolute_path).ok()?;
    let content = String::from_utf8_lossy(&raw).into_owned();

    let max = max_tokens.unwrap_or(DEFAULT_MAX_TOKENS);
    let tokens = (content.len() as i64 + 3) / 4; // div_ceil(4)
    let truncated = tokens > max;
    let final_content = if truncated {
        content[..(max as usize * 4)].to_string()
    } else {
        content
    };

    Some(MentionedFileResult {
        path: absolute_path.to_string(),
        content: final_content,
        exists: true,
        tokens,
        truncated,
    })
}

// ---------------------------------------------------------------------------
// Frontmatter + string helpers (shared by configs, agents, memory, skills)
// ---------------------------------------------------------------------------

/// Parses YAML-like frontmatter from markdown. Mirrors `parseFrontmatter` — a
/// naive line splitter (never a real YAML parser), matched exactly so the
/// line-level agent patcher stays consistent with what reads see.
pub(crate) fn parse_frontmatter(content: &str) -> std::collections::HashMap<String, String> {
    let mut out = std::collections::HashMap::new();
    let s = content.trim_start_matches([' ', '\t', '\n', '\r']);
    if !s.starts_with("---") {
        return out;
    }
    let rest = &s[3..];
    let Some(end) = rest.find("\n---") else {
        return out;
    };
    let block = &rest[..end];
    for line in split_lines(block) {
        let trimmed = trim_whitespace(line);
        let Some(ci) = trimmed.find(':') else {
            continue;
        };
        let key = trim_whitespace(&trimmed[..ci]);
        let val = trim_whitespace(&trimmed[ci + 1..]);
        if !key.is_empty() {
            out.insert(key.to_string(), val.to_string());
        }
    }
    out
}

/// Splits into lines without a trailing empty element (mirrors `splitLines`:
/// keeps only up-to-final-content segments).
pub(crate) fn split_lines(s: &str) -> Vec<&str> {
    let mut lines = Vec::new();
    let bytes = s.as_bytes();
    let mut start = 0;
    for i in 0..bytes.len() {
        if bytes[i] == b'\n' {
            lines.push(&s[start..i]);
            start = i + 1;
        }
    }
    if start < s.len() {
        lines.push(&s[start..]);
    }
    lines
}

/// ASCII-whitespace trim matching Go's `trimWhitespace` (space/tab/cr/nl only).
pub(crate) fn trim_whitespace(s: &str) -> &str {
    s.trim_matches([' ', '\t', '\r', '\n'])
}

#[cfg(test)]
#[path = "pathutil_tests.rs"]
mod pathutil_tests;
