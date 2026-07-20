//! Ports `internal/configbackup/configbackup.go` — the manifest DTOs, the store
//! path helper, and the SEGMENT-BOUNDED allowlist / id guards every capture,
//! restore, and imported-archive entry is validated against (invariant #3).
//!
//! `match_config_allowlist` is NEVER a textual prefix match: a `rules-evil.md`
//! sibling can never pass as `rules/**`. `validate_backup_id` rejects any id that
//! isn't a single filename-safe segment before it is joined into a store path.

use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Deserializer, Serialize};

/// Mirrors `files.claudeJSONMask` — the marker a secrets-excluded export writes
/// in place of a credential (U+2022 ×4). ApplyImport drops any imported settings
/// value equal to it rather than writing it live (F11).
pub const REDACTION_PLACEHOLDER: &str = "••••";

/// Reserved filename a pre-import backup uses to snapshot
/// `<app_data_dir>/hooks-disabled.json`, so a one-click undo fully reverts the
/// disabled groups an import appended. NOT an allowlisted config path, so it can
/// never be confused with a root-relative file entry.
pub const HOOKS_DISABLED_SNAPSHOT_NAME: &str = "hooks-disabled.snapshot.json";

/// Describes one captured config backup on disk (config-backups/<id>/
/// manifest.json). `files` carries the root-relative allowlisted files;
/// `skill_links` records symlinked skills by target string only.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Manifest {
    pub id: String,
    pub label: String,
    pub created_ms: f64,
    pub secrets_included: bool,
    // Go's readManifest tolerates a missing / `null` slice; accept both, and
    // always re-emit an array so the store stays uniform.
    #[serde(default, deserialize_with = "vec_or_null")]
    pub files: Vec<FileEntry>,
    #[serde(default, deserialize_with = "vec_or_null")]
    pub skill_links: Vec<SkillLink>,
}

/// One captured file: root-relative path, byte size, and SHA-256 (hex) checksum
/// of the captured bytes.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileEntry {
    pub rel_path: String,
    pub size: i64,
    pub sha256: String,
}

/// A symlinked skill recorded by name + raw link target only — never its content
/// (an out-of-root repo is a documented non-goal to capture).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillLink {
    pub name: String,
    pub target: String,
}

/// Mirrors `import.go:ImportPreview` — the fail-closed review a caller must
/// approve before ApplyImport. Defined here (not import.rs) so both share one
/// DTO; import.rs populates and returns it.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportPreview {
    pub hook_commands: Vec<String>,
    pub permission_rules: Vec<String>,
    pub categories: Vec<String>,
    pub secrets_included: bool,
    pub archive_path: String,
}

/// Accepts a JSON array, an explicit `null`, or a missing field (via
/// `#[serde(default)]`), all mapping to the same `Vec`.
pub(crate) fn vec_or_null<'de, D, T>(deserializer: D) -> Result<Vec<T>, D::Error>
where
    D: Deserializer<'de>,
    T: Deserialize<'de>,
{
    Ok(Option::<Vec<T>>::deserialize(deserializer)?.unwrap_or_default())
}

/// The app-owned backup store root, `<app_data_dir>/config-backups`.
pub(crate) fn config_backups_dir(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join("config-backups")
}

/// Current epoch time in float milliseconds (mirrors `snapshots.nowMS`).
pub(crate) fn now_ms() -> f64 {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    nanos as f64 / 1e6
}

/// Rejects any id that isn't a single filename-safe segment before it is joined
/// into a store path. Mirrors `validateBackupID` (unix: `filepath.Separator` is
/// `/`, so both Go separator checks collapse to `/`).
pub fn validate_backup_id(id: &str) -> Result<(), String> {
    if id.is_empty()
        || id == "."
        || id == ".."
        || id.contains('/')
        || Path::new(id).is_absolute()
        || clean_path(id) != id
    {
        return Err(format!("configbackup: invalid backup id {id:?}"));
    }
    Ok(())
}

/// Reports whether `rel_path` (root-relative) is a capturable / restorable /
/// importable config file. Matching is SEGMENT-BOUNDED — never a textual prefix.
/// Mirrors `matchConfigAllowlist` exactly.
pub fn match_config_allowlist(rel_path: &str) -> bool {
    let cleaned = clean_path(rel_path);
    if cleaned == "." || Path::new(&cleaned).is_absolute() {
        return false;
    }
    let segs: Vec<&str> = cleaned.split('/').collect();
    for s in &segs {
        if s.is_empty() || *s == "." || *s == ".." {
            return false;
        }
    }

    if matches!(cleaned.as_str(), "settings.json" | "CLAUDE.md" | "RTK.md") {
        return true;
    }

    match segs[0] {
        // rules/**, commands/**, tools/** — any file at any depth (len>=2 => a
        // file below the dir, never the bare dir itself).
        "rules" | "commands" | "tools" => segs.len() >= 2,
        // agents/*.md — exactly one .md file directly under agents/.
        "agents" => segs.len() == 2 && segs[1].ends_with(".md"),
        // projects/<encoded>/memory/*.md — MEMORY.md + fact files.
        "projects" => segs.len() == 4 && segs[2] == "memory" && segs[3].ends_with(".md"),
        // agent-memory/<name>/*.md — MEMORY.md + fact files.
        "agent-memory" => segs.len() == 3 && segs[2].ends_with(".md"),
        // skills/<name>/SKILL.md, or anything under skills/<name>/references/**.
        "skills" => {
            (segs.len() == 3 && segs[2] == "SKILL.md")
                || (segs.len() >= 4 && segs[2] == "references")
        }
        _ => false,
    }
}

/// Buckets a root-relative allowlisted path into the confirmation category the
/// import review screen gates on. An unknown path returns "". Mirrors
/// `categoryForRel`.
pub fn category_for_rel(rel: &str) -> &'static str {
    let cleaned = clean_path(rel);
    if cleaned == "settings.json" {
        return "settings";
    }
    if cleaned == "CLAUDE.md" || cleaned == "RTK.md" {
        return "instructions";
    }
    match cleaned.split('/').next().unwrap_or("") {
        "rules" | "commands" | "tools" => "instructions",
        "agents" => "agents",
        "projects" | "agent-memory" => "memory",
        "skills" => "skills",
        _ => "",
    }
}

/// Lexical path cleaner matching Go's `filepath.Clean` for `/`-separated (unix)
/// paths — the shared primitive the allowlist / id guards are defined over.
pub(crate) fn clean_path(path: &str) -> String {
    if path.is_empty() {
        return ".".to_string();
    }
    let b = path.as_bytes();
    let n = b.len();
    let rooted = b[0] == b'/';
    let mut out: Vec<u8> = Vec::with_capacity(n);
    let mut r = 0usize;
    let mut dotdot = 0usize;
    if rooted {
        out.push(b'/');
        r = 1;
        dotdot = 1;
    }
    while r < n {
        if b[r] == b'/' || (b[r] == b'.' && (r + 1 == n || b[r + 1] == b'/')) {
            // empty ("//") or "." path element — skip it.
            r += 1;
        } else if b[r] == b'.' && r + 1 < n && b[r + 1] == b'.' && (r + 2 == n || b[r + 2] == b'/')
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
            while r < n && b[r] != b'/' {
                out.push(b[r]);
                r += 1;
            }
        }
    }
    if out.is_empty() {
        out.push(b'.');
    }
    String::from_utf8(out).unwrap_or_else(|_| ".".to_string())
}

#[cfg(test)]
#[path = "types_tests.rs"]
mod types_tests;
