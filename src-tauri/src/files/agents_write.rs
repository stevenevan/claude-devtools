//! Ports `internal/files/agents_write.go` — the write path for global agent
//! definitions under `<root>/agents/*.md`, a SECURITY-CRITICAL surface that
//! steers what a Claude Code agent can do. Mirrors the write-safety spine: a
//! dedicated mutex, read-fresh-under-lock, confine-PARENT-to-root, `.bak`
//! backup, atomic temp+rename. `root` is always the caller's EffectivePath
//! threaded in from the service layer — NEVER `claude_dir()`.
//!
//! Frontmatter is patched at the LINE level, never YAML-reserialized:
//! `pathutil::parse_frontmatter` is a naive line splitter, so a full round-trip
//! would lose quoting/order/comments. Only touched keys are rewritten; every
//! other frontmatter line and the whole body are preserved byte-for-byte.
//!
//! `clean` and `atomic_write_file` are `pub(crate)` here and reused by
//! `text_write.rs`; Go shares `filepath.Clean` (stdlib) and `atomicWriteFile`
//! (hooks_write.go) package-wide, but `pathutil.rs`/`fsutil.rs` are outside
//! W12's two-file scope, so they live in the first ported file.

use std::collections::HashMap;
use std::fs;
use std::io;
use std::path::Path;
use std::sync::{LazyLock, Mutex};

use serde::{Deserialize, Serialize};

use crate::config::root::claude_dir;
use crate::files::fsutil;
use crate::files::pathutil::{confine, parse_frontmatter, trim_whitespace};

/// The single mutex for the whole agent-file family — one lock, not a per-path
/// map — mirroring `text_write`'s: read-fresh-under-lock kills the lost-update
/// race and the service layer already serializes.
static AGENTS_WRITE_MU: LazyLock<Mutex<()>> = LazyLock::new(|| Mutex::new(()));

/// A typed, sparse frontmatter+body patch. `None` leaves the field untouched
/// (`Some("")` clears it distinctly from "leave alone"). `body`, when `Some`,
/// replaces everything after the closing `---` fence; when `None` the body
/// bytes are preserved verbatim. Mirrors `AgentPatch`.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentPatch {
    pub name: Option<String>,
    pub description: Option<String>,
    pub tools: Option<String>,
    pub model: Option<String>,
    pub body: Option<String>,
}

/// Mirrors one entry in `read_global_agents`. `GlobalAgent`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GlobalAgent {
    pub name: String,
    pub description: String,
    pub tools: String,
    pub model: String,
    pub file_path: String,
    pub content: String,
}

/// Mirrors one entry in `read_agent_configs`. `AgentConfig`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentConfig {
    pub content: String,
    pub path: String,
}

/// `<root>/agents`. `root` is the caller's EffectivePath. Mirrors `agentsDir`.
fn agents_dir(root: &str) -> std::path::PathBuf {
    Path::new(root).join("agents")
}

/// Rejects any `file_base` that isn't a single, filename-safe segment (no
/// separators, no `.`/`..`, not absolute, already lexically clean) before any
/// filesystem call. `file_base` carries no `.md` extension. Mirrors
/// `validateAgentFileBase`; error sentinel is byte-identical.
fn validate_agent_file_base(file_base: &str) -> Result<(), String> {
    if file_base.is_empty()
        || file_base == "."
        || file_base == ".."
        || file_base.contains('/')
        || Path::new(file_base).is_absolute()
        || clean(file_base) != file_base
    {
        return Err(format!("files: invalid agent file name {file_base:?}"));
    }
    Ok(())
}

/// Validates `file_base` and resolves it to an absolute path confined within
/// `root`: canonicalize root, create `<root>/agents` if missing, then
/// canonicalize + confine the PARENT (agents dir), never the leaf (which may
/// not exist yet — a non-existent candidate is returned unchanged, so confining
/// the leaf gives no containment). Mirrors `ResolveAgentPath`.
pub fn resolve_agent_path(root: &str, file_base: &str) -> Result<String, String> {
    validate_agent_file_base(file_base)?;

    let canon_root =
        fs::canonicalize(root).map_err(|e| format!("files: agents root {root:?}: {e}"))?;

    let dir = agents_dir(&canon_root.to_string_lossy());
    fs::create_dir_all(&dir).map_err(|e| format!("files: create agents directory: {e}"))?;

    let parent_canon =
        fs::canonicalize(&dir).map_err(|e| format!("files: agents directory: {e}"))?;
    confine(
        &parent_canon.to_string_lossy(),
        &canon_root.to_string_lossy(),
    )?;

    Ok(parent_canon
        .join(format!("{file_base}.md"))
        .to_string_lossy()
        .into_owned())
}

/// Reads `<root>/agents/*.md` into `GlobalAgent` rows — the `read_global_agents`
/// body, but root-threaded so the manager lists exactly what it writes for a
/// custom-root user. Returns an empty slice when the agents dir is missing.
/// Mirrors `ReadManagedAgents`.
pub fn read_managed_agents(root: &str) -> Result<Vec<GlobalAgent>, String> {
    let dir = agents_dir(root);
    let entries = match fs::read_dir(&dir) {
        Ok(e) => e,
        Err(_) => return Ok(Vec::new()),
    };

    let mut out: Vec<GlobalAgent> = Vec::new();
    for entry in entries.flatten() {
        let is_dir = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);
        let name = entry.file_name().to_string_lossy().into_owned();
        if is_dir || !name.ends_with(".md") {
            continue;
        }
        let p = dir.join(&name);
        let content = match fs::read(&p) {
            Ok(c) => String::from_utf8_lossy(&c).into_owned(),
            Err(_) => continue,
        };
        let fm = parse_frontmatter(&content);
        let mut agent_name = fm.get("name").cloned().unwrap_or_default();
        if agent_name.is_empty() {
            agent_name = name[..name.len() - 3].to_string();
        }
        out.push(GlobalAgent {
            name: agent_name,
            description: fm.get("description").cloned().unwrap_or_default(),
            tools: fm.get("tools").cloned().unwrap_or_default(),
            model: fm.get("model").cloned().unwrap_or_default(),
            file_path: p.to_string_lossy().into_owned(),
            content,
        });
    }
    out.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(out)
}

/// Reads `~/.claude/agents/*.md`. Mirrors `ReadGlobalAgents` — the same body as
/// `read_managed_agents`, rooted at `claude_dir()`.
pub fn read_global_agents() -> Result<Vec<GlobalAgent>, String> {
    let cd = claude_dir()?;
    read_managed_agents(&cd.to_string_lossy())
}

/// Reads `.claude/agents/*.md` relative to `project_root`. Mirrors
/// `ReadAgentConfigs`.
pub fn read_agent_configs(project_root: &str) -> HashMap<String, AgentConfig> {
    let mut out: HashMap<String, AgentConfig> = HashMap::new();
    let agents_dir = Path::new(project_root).join(".claude").join("agents");
    let entries = match fs::read_dir(&agents_dir) {
        Ok(e) => e,
        Err(_) => return out,
    };
    for entry in entries.flatten() {
        let is_dir = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);
        let name = entry.file_name().to_string_lossy().into_owned();
        if is_dir || !name.ends_with(".md") {
            continue;
        }
        let p = agents_dir.join(&name);
        let content = match fs::read(&p) {
            Ok(c) => String::from_utf8_lossy(&c).into_owned(),
            Err(_) => continue,
        };
        let key = name[..name.len() - 3].to_string();
        out.insert(
            key,
            AgentConfig {
                content,
                path: p.to_string_lossy().into_owned(),
            },
        );
    }
    out
}

/// Applies a sparse typed patch to an existing agent file: lock, resolve+confine,
/// read fresh, split at the frontmatter fence, rewrite each non-`None` field's
/// key line in place (or append it, REFUSING a block-scalar / multi-line key),
/// preserve untouched lines + body byte-for-byte (unless `body` is `Some`),
/// validate a non-empty name still re-parses, then write `.bak`-first via atomic
/// temp+rename. Mirrors `PatchAgentFrontmatter`.
pub fn patch_agent_frontmatter(
    root: &str,
    file_base: &str,
    patch: AgentPatch,
) -> Result<(), String> {
    let _guard = fsutil::lock(&AGENTS_WRITE_MU);

    let dest = resolve_agent_path(root, file_base)?;

    let current = fs::read(&dest).map_err(|e| format!("files: read agent {file_base:?}: {e}"))?;
    let content = String::from_utf8_lossy(&current).into_owned();

    let (open, block, close_and_after) = match split_agent_frontmatter(&content) {
        Some(v) => v,
        None => return Err(format!("files: agent {file_base:?} has no frontmatter fence")),
    };

    let mut lines: Vec<String> = block.split('\n').map(String::from).collect();
    for (key, val) in [
        ("name", &patch.name),
        ("description", &patch.description),
        ("tools", &patch.tools),
        ("model", &patch.model),
    ] {
        if let Some(v) = val {
            apply_frontmatter_field(&mut lines, key, v)?;
        }
    }
    let new_block = lines.join("\n");

    let (fence, body_orig) = split_closing_fence(close_and_after);
    let body: &str = match &patch.body {
        Some(b) => b,
        None => body_orig,
    };

    let next = format!("{open}{new_block}{fence}{body}");
    if parse_frontmatter(&next)
        .get("name")
        .map_or(true, |s| s.is_empty())
    {
        return Err(format!("files: patched agent {file_base:?} has no name"));
    }

    atomic_write_file(&format!("{dest}.bak"), &current)
        .map_err(|e| format!("files: write backup for agent {file_base:?}: {e}"))?;
    atomic_write_file(&dest, next.as_bytes())
        .map_err(|e| format!("files: write agent {file_base:?}: {e}"))?;
    Ok(())
}

/// Writes a new `<name>.md` with a minimal name+description frontmatter template.
/// `name` must be filename-safe and unique (read fresh); `description` must not
/// contain a newline and is written double-quoted with embedded `"` and `\`
/// escaped. No `.bak` — the file is new. Mirrors `CreateAgent`.
pub fn create_agent(root: &str, name: &str, description: &str) -> Result<(), String> {
    let _guard = fsutil::lock(&AGENTS_WRITE_MU);

    validate_agent_file_base(name)?;
    if description.contains('\n') || description.contains('\r') {
        return Err("files: agent description must not contain a newline".to_string());
    }

    let existing = read_managed_agents(root)?;
    let target = format!("{name}.md");
    for a in &existing {
        let base = Path::new(&a.file_path)
            .file_name()
            .map(|s| s.to_string_lossy().into_owned());
        if base.as_deref() == Some(target.as_str()) {
            return Err(format!("files: agent {name:?} already exists"));
        }
    }

    let dest = resolve_agent_path(root, name)?;
    match fs::metadata(&dest) {
        Ok(_) => return Err(format!("files: agent {name:?} already exists")),
        Err(e) if e.kind() == io::ErrorKind::NotFound => {}
        Err(e) => return Err(format!("files: stat agent {name:?}: {e}")),
    }

    let esc = description.replace('\\', "\\\\").replace('"', "\\\"");
    let tmpl = format!("---\nname: {name}\ndescription: \"{esc}\"\n---\n\n");

    atomic_write_file(&dest, tmpl.as_bytes())
        .map_err(|e| format!("files: write agent {name:?}: {e}"))?;
    Ok(())
}

/// Splits content into `(open, block, close_and_after)` at the boundary
/// `parse_frontmatter` uses: leading whitespace + `---` is the open fence,
/// `block` is everything up to (not including) the closing `\n---`, and
/// `close_and_after` begins with that `\n---`. `None` when no fence is present.
/// `open + block + close_and_after == content`. Mirrors `splitAgentFrontmatter`.
fn split_agent_frontmatter(content: &str) -> Option<(&str, &str, &str)> {
    let bytes = content.as_bytes();
    let mut lead = 0;
    while lead < bytes.len() && is_frontmatter_space(bytes[lead]) {
        lead += 1;
    }
    if !content[lead..].starts_with("---") {
        return None;
    }
    let open_end = lead + 3;
    let rest = &content[open_end..];
    let end = rest.find("\n---")?;
    let block_end = open_end + end;
    Some((
        &content[..open_end],
        &content[open_end..block_end],
        &content[block_end..],
    ))
}

/// Divides `close_and_after` (which begins with `\n---`) into the fence portion —
/// through the newline that ends the closing-fence line — and the body that
/// follows. `fence + body == close_and_after`. Mirrors `splitClosingFence`.
fn split_closing_fence(close_and_after: &str) -> (&str, &str) {
    const MARKER: &str = "\n---";
    let after = &close_and_after[MARKER.len()..];
    match after.find('\n') {
        None => (close_and_after, ""),
        Some(nl) => (&close_and_after[..MARKER.len() + nl + 1], &after[nl + 1..]),
    }
}

/// Rewrites `key`'s line to `"key: value"` in place (or appends it when absent).
/// Refuses when the existing value is a block scalar or multi-line rather than
/// orphaning continuation lines. Mirrors `applyFrontmatterField`.
fn apply_frontmatter_field(lines: &mut Vec<String>, key: &str, value: &str) -> Result<(), String> {
    if value.contains('\n') || value.contains('\r') {
        return Err(format!(
            "files: refusing to patch {key:?}: value must not contain a newline"
        ));
    }
    for i in 0..lines.len() {
        let is_match = matches!(line_key(&lines[i]), Some(k) if k == key);
        if !is_match {
            continue;
        }
        if is_block_scalar_or_multiline(&lines[..], i) {
            return Err(format!(
                "files: refusing to patch {key:?}: value is a block scalar or spans multiple lines"
            ));
        }
        lines[i] = format!("{key}: {value}");
        return Ok(());
    }
    lines.push(format!("{key}: {value}"));
    Ok(())
}

/// Extracts the frontmatter key from a line the way `parse_frontmatter` does
/// (trim, first colon). `None` for a blank/keyless line. Mirrors `lineKey`.
fn line_key(line: &str) -> Option<&str> {
    let trimmed = trim_whitespace(line);
    let ci = trimmed.find(':')?;
    let key = trim_whitespace(&trimmed[..ci]);
    if key.is_empty() {
        return None;
    }
    Some(key)
}

/// Reports whether the key at `lines[idx]` carries a value the naive line-patcher
/// must not touch: a YAML block-scalar indicator (`>`/`|`) OR an indented
/// continuation on the next line. Mirrors `isBlockScalarOrMultiline`.
fn is_block_scalar_or_multiline(lines: &[String], idx: usize) -> bool {
    let trimmed = trim_whitespace(&lines[idx]);
    if let Some(ci) = trimmed.find(':') {
        let val = trim_whitespace(&trimmed[ci + 1..]);
        if val.starts_with('>') || val.starts_with('|') {
            return true;
        }
    }
    if idx + 1 < lines.len() {
        let next = lines[idx + 1].as_bytes();
        if !next.is_empty() && (next[0] == b' ' || next[0] == b'\t') {
            return true;
        }
    }
    false
}

/// Matches the leading-whitespace set `parse_frontmatter` trims. Mirrors
/// `isFrontmatterSpace`.
fn is_frontmatter_space(c: u8) -> bool {
    c == b' ' || c == b'\t' || c == b'\n' || c == b'\r'
}

/// Lexical path cleaning matching Go `filepath.Clean` on Unix (Separator `/`).
/// Shared with `text_write.rs`. SECURITY-CRITICAL: load-bearing for the
/// instruction-file allowlist gate.
pub(crate) fn clean(path: &str) -> String {
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
        } else if bytes[r] == b'.' && bytes[r + 1] == b'.' && (r + 2 == n || bytes[r + 2] == b'/') {
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
    String::from_utf8(out).unwrap_or_else(|_| path.to_string())
}

/// Writes `data` to `path` via temp+rename. Shared with `text_write.rs`.
/// Mirrors `atomicWriteFile`; error sentinels name the temp file's base.
pub(crate) fn atomic_write_file(path: &str, data: &[u8]) -> Result<(), String> {
    let tmp_path = format!("{path}.tmp");
    let tmp = Path::new(&tmp_path);
    let base = tmp
        .file_name()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_default();
    fsutil::write_file_mode(tmp, data, 0o644).map_err(|e| format!("files: write {base}: {e}"))?;
    if let Err(e) = fs::rename(tmp, path) {
        let _ = fs::remove_file(tmp);
        return Err(format!("files: rename {base}: {e}"));
    }
    Ok(())
}

#[cfg(test)]
#[path = "agents_write_tests.rs"]
mod agents_write_tests;
