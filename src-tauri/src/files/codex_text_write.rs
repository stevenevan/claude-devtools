//! Narrow, revision-checked Codex instruction/agent text writes.
//!
//! The caller supplies a path only after resolving a server-owned inventory
//! record. This module still re-confines and re-reads the target under a
//! process-wide lock, because inventory ids and metadata are not authorization
//! by themselves.

use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{LazyLock, Mutex};

use crate::files::codex_inventory::{
    confined_path, exact_revision, read_bounded_file, validate_relative_path, MAX_DETAIL_BYTES,
    MAX_RESPONSE_BYTES,
};
use crate::types::codex_inventory::{
    CodexDiffLine, CodexRecordKind, CodexTextApplyResult, CodexTextConflict, CodexTextPreview,
    CodexTextPreviewResult, CodexTextWriteResult,
};

const MAX_DIFF_LINES: usize = 256;
const MAX_CONTENT_BYTES: usize = MAX_DETAIL_BYTES;
const MAX_REVISION_BYTES: usize = 128;

static CODEX_TEXT_WRITE_MU: LazyLock<Mutex<()>> = LazyLock::new(|| Mutex::new(()));

pub(crate) fn preview(
    kind: CodexRecordKind,
    record_id: &str,
    root: &Path,
    relative: &Path,
    content: &str,
    expected_revision: &str,
) -> Result<CodexTextPreviewResult, String> {
    validate_inputs(record_id, relative, content, expected_revision)?;
    let _guard = lock_writer()?;
    let path = resolve_target(root, relative, kind)?;
    let current = read_current(&path, kind)?;
    if current.revision != expected_revision {
        return Ok(CodexTextPreviewResult::Conflict(conflict(
            record_id,
            expected_revision,
            &current.revision,
        )));
    }
    let proposed_revision = revision(content.as_bytes());
    Ok(CodexTextPreviewResult::Ready(CodexTextPreview {
        record_id: record_id.to_string(),
        current_revision: current.revision,
        proposed_revision,
        diff: diff_lines(&current.content, content),
        warnings: vec![
            "The selected local file is untrusted content.".to_string(),
            "Apply creates a sibling .bak recovery copy before replacement.".to_string(),
        ],
        can_apply: true,
    }))
}

pub(crate) fn preview_with_transform<F>(
    kind: CodexRecordKind,
    record_id: &str,
    root: &Path,
    relative: &Path,
    input: &str,
    expected_revision: &str,
    transform: F,
) -> Result<CodexTextPreviewResult, String>
where
    F: FnOnce(&str) -> Result<String, String>,
{
    validate_inputs(record_id, relative, input, expected_revision)?;
    let _guard = lock_writer()?;
    let path = resolve_target(root, relative, kind)?;
    let current = read_current(&path, kind)?;
    if current.revision != expected_revision {
        return Ok(CodexTextPreviewResult::Conflict(conflict(
            record_id,
            expected_revision,
            &current.revision,
        )));
    }
    let content = transform(&current.content).map_err(|error| {
        format!(
            "codex {}: prepare transformed content: {error}",
            kind_label(kind)
        )
    })?;
    validate_content(&content)?;
    let proposed_revision = revision(content.as_bytes());
    Ok(CodexTextPreviewResult::Ready(CodexTextPreview {
        record_id: record_id.to_string(),
        current_revision: current.revision,
        proposed_revision,
        diff: diff_lines(&current.content, &content),
        warnings: vec![
            "The selected local file is untrusted content.".to_string(),
            "Apply creates a sibling .bak recovery copy before replacement.".to_string(),
        ],
        can_apply: true,
    }))
}

pub(crate) fn apply(
    kind: CodexRecordKind,
    record_id: &str,
    root: &Path,
    relative: &Path,
    content: &str,
    expected_revision: &str,
) -> Result<CodexTextApplyResult, String> {
    validate_inputs(record_id, relative, content, expected_revision)?;
    let _guard = lock_writer()?;
    let path = resolve_target(root, relative, kind)?;
    let current = read_current(&path, kind)?;
    if current.revision != expected_revision {
        return Ok(CodexTextApplyResult::Conflict(conflict(
            record_id,
            expected_revision,
            &current.revision,
        )));
    }
    let backup = backup_path(&path)?;
    ensure_regular_or_missing(&backup)?;
    fs::copy(&path, &backup).map_err(|error| {
        format!(
            "codex {}: create recovery copy before write: {error}",
            kind_label(kind)
        )
    })?;
    write_atomic(&path, content.as_bytes(), &backup)?;
    let revision = exact_revision(&path)
        .map_err(|error| format!("codex {}: verify replacement: {error}", kind_label(kind)))?;
    Ok(CodexTextApplyResult::Applied(CodexTextWriteResult {
        record_id: record_id.to_string(),
        revision,
        backup_created: true,
    }))
}

pub(crate) fn apply_with_transform<F>(
    kind: CodexRecordKind,
    record_id: &str,
    root: &Path,
    relative: &Path,
    input: &str,
    expected_revision: &str,
    transform: F,
) -> Result<CodexTextApplyResult, String>
where
    F: FnOnce(&str) -> Result<String, String>,
{
    validate_inputs(record_id, relative, input, expected_revision)?;
    let _guard = lock_writer()?;
    let path = resolve_target(root, relative, kind)?;
    let current = read_current(&path, kind)?;
    if current.revision != expected_revision {
        return Ok(CodexTextApplyResult::Conflict(conflict(
            record_id,
            expected_revision,
            &current.revision,
        )));
    }
    let content = transform(&current.content).map_err(|error| {
        format!(
            "codex {}: prepare transformed content: {error}",
            kind_label(kind)
        )
    })?;
    validate_content(&content)?;
    let backup = backup_path(&path)?;
    ensure_regular_or_missing(&backup)?;
    fs::copy(&path, &backup).map_err(|error| {
        format!(
            "codex {}: create recovery copy before write: {error}",
            kind_label(kind)
        )
    })?;
    write_atomic(&path, content.as_bytes(), &backup)?;
    let revision = exact_revision(&path)
        .map_err(|error| format!("codex {}: verify replacement: {error}", kind_label(kind)))?;
    Ok(CodexTextApplyResult::Applied(CodexTextWriteResult {
        record_id: record_id.to_string(),
        revision,
        backup_created: true,
    }))
}

struct CurrentText {
    content: String,
    revision: String,
}

fn read_current(path: &Path, kind: CodexRecordKind) -> Result<CurrentText, String> {
    let bounded = read_bounded_file(path, MAX_CONTENT_BYTES)
        .map_err(|error| format!("codex {}: read selected file: {error}", kind_label(kind)))?;
    if bounded.truncated {
        return Err(format!(
            "codex {}: selected file exceeds the bounded write size",
            kind_label(kind)
        ));
    }
    let revision = exact_revision(path)
        .map_err(|error| format!("codex {}: read current revision: {error}", kind_label(kind)))?;
    Ok(CurrentText {
        content: bounded.text,
        revision,
    })
}

fn resolve_target(root: &Path, relative: &Path, kind: CodexRecordKind) -> Result<PathBuf, String> {
    validate_relative_path(relative)
        .map_err(|error| format!("codex {}: invalid selected path: {error}", kind_label(kind)))?;
    confined_path(root, relative).map_err(|error| {
        format!(
            "codex {}: selected path is not safe: {error}",
            kind_label(kind)
        )
    })
}

fn validate_inputs(
    record_id: &str,
    relative: &Path,
    content: &str,
    expected_revision: &str,
) -> Result<(), String> {
    if record_id.is_empty() || record_id.len() > MAX_REVISION_BYTES {
        return Err("codex text write: record id is invalid".to_string());
    }
    validate_relative_path(relative)
        .map_err(|error| format!("codex text write: invalid selected path: {error}"))?;
    validate_content(content)?;
    if expected_revision.len() != 64
        || expected_revision.len() > MAX_REVISION_BYTES
        || !expected_revision
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit())
    {
        return Err("codex text write: expected revision is invalid".to_string());
    }
    Ok(())
}

fn validate_content(content: &str) -> Result<(), String> {
    if content.as_bytes().len() > MAX_CONTENT_BYTES {
        return Err(format!(
            "codex text write: content exceeds {MAX_CONTENT_BYTES} bytes"
        ));
    }
    if content.contains("[redacted]") {
        return Err(
            "codex text write: redacted placeholders cannot be written back to a file".to_string(),
        );
    }
    Ok(())
}

fn write_atomic(path: &Path, bytes: &[u8], backup: &Path) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "codex text write: selected file has no parent directory".to_string())?;
    let file_name = path
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| "codex text write: selected file name is invalid".to_string())?;
    let temp = parent.join(format!(".{file_name}.codex-inventory.tmp"));
    ensure_regular_or_missing(&temp)?;
    let result = (|| {
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp)
            .map_err(|error| format!("codex text write: create temporary file: {error}"))?;
        file.write_all(bytes)
            .map_err(|error| format!("codex text write: write temporary file: {error}"))?;
        file.sync_all()
            .map_err(|error| format!("codex text write: sync temporary file: {error}"))?;
        drop(file);
        ensure_regular_or_missing(path)?;
        fs::rename(&temp, path)
            .map_err(|error| format!("codex text write: replace selected file: {error}"))?;
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temp);
    }
    let _ = backup;
    result
}

fn backup_path(path: &Path) -> Result<PathBuf, String> {
    let file_name = path
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| "codex text write: selected file name is invalid".to_string())?;
    Ok(path.with_file_name(format!("{file_name}.bak")))
}

fn ensure_regular_or_missing(path: &Path) -> Result<(), String> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_symlink() => {
            Err("codex text write: refusing a symlinked writable path".to_string())
        }
        Ok(metadata) if !metadata.is_file() => {
            Err("codex text write: writable path is not a regular file".to_string())
        }
        Ok(_) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!("codex text write: inspect writable path: {error}")),
    }
}

fn diff_lines(old: &str, new: &str) -> Vec<CodexDiffLine> {
    let old_lines: Vec<&str> = old.lines().collect();
    let new_lines: Vec<&str> = new.lines().collect();
    let mut diff = Vec::new();
    let max = old_lines.len().max(new_lines.len());
    for index in 0..max {
        if diff.len() >= MAX_DIFF_LINES {
            break;
        }
        match (old_lines.get(index), new_lines.get(index)) {
            (Some(old), Some(new)) if old == new => {}
            (Some(old), Some(new)) => {
                diff.push(CodexDiffLine {
                    kind: "remove".to_string(),
                    text: bounded_diff_text(old),
                });
                if diff.len() < MAX_DIFF_LINES {
                    diff.push(CodexDiffLine {
                        kind: "add".to_string(),
                        text: bounded_diff_text(new),
                    });
                }
            }
            (Some(old), None) => diff.push(CodexDiffLine {
                kind: "remove".to_string(),
                text: bounded_diff_text(old),
            }),
            (None, Some(new)) => diff.push(CodexDiffLine {
                kind: "add".to_string(),
                text: bounded_diff_text(new),
            }),
            (None, None) => {}
        }
    }
    diff
}

fn bounded_diff_text(value: &str) -> String {
    let max = MAX_RESPONSE_BYTES / MAX_DIFF_LINES;
    value.chars().take(max).collect()
}

fn conflict(record_id: &str, expected: &str, actual: &str) -> CodexTextConflict {
    CodexTextConflict {
        record_id: record_id.to_string(),
        expected_revision: expected.to_string(),
        actual_revision: actual.to_string(),
        message: "The selected Codex file changed; refresh before applying".to_string(),
    }
}

fn revision(bytes: &[u8]) -> String {
    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    format!("{:x}", hasher.finalize())
}

fn lock_writer() -> Result<std::sync::MutexGuard<'static, ()>, String> {
    CODEX_TEXT_WRITE_MU
        .lock()
        .map_err(|_| "codex text write: writer lock is poisoned".to_string())
}

fn kind_label(kind: CodexRecordKind) -> &'static str {
    match kind {
        CodexRecordKind::Instruction => "instructions",
        CodexRecordKind::Agent => "agent",
        CodexRecordKind::Skill => "skill",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::{Path, PathBuf};
    use std::time::{SystemTime, UNIX_EPOCH};

    fn fixture() -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        let root = std::env::temp_dir().join(format!("codex-text-write-{nonce}"));
        fs::create_dir_all(&root).expect("fixture root");
        root
    }

    #[test]
    fn preview_apply_and_conflict_are_revision_checked() {
        let root = fixture();
        let path = root.join("AGENTS.md");
        fs::write(&path, "one\n").expect("source");
        let expected = super::revision(b"one\n");
        let preview = preview(
            CodexRecordKind::Instruction,
            "record",
            &root,
            Path::new("AGENTS.md"),
            "two\n",
            &expected,
        )
        .expect("preview");
        assert!(matches!(preview, CodexTextPreviewResult::Ready(_)));
        let applied = apply(
            CodexRecordKind::Instruction,
            "record",
            &root,
            Path::new("AGENTS.md"),
            "two\n",
            &expected,
        )
        .expect("apply");
        assert!(matches!(applied, CodexTextApplyResult::Applied(_)));
        assert_eq!(fs::read_to_string(&path).expect("new source"), "two\n");
        assert_eq!(
            fs::read_to_string(root.join("AGENTS.md.bak")).expect("backup"),
            "one\n"
        );
        let conflict = apply(
            CodexRecordKind::Instruction,
            "record",
            &root,
            Path::new("AGENTS.md"),
            "three\n",
            &expected,
        )
        .expect("conflict");
        assert!(matches!(conflict, CodexTextApplyResult::Conflict(_)));
        crate::testutil::remove_tree(root);
    }

    #[cfg(unix)]
    #[test]
    fn symlink_writes_are_rejected() {
        let root = fixture();
        let outside = root.join("outside.md");
        fs::write(&outside, "outside\n").expect("outside");
        std::os::unix::fs::symlink(&outside, root.join("AGENTS.md")).expect("symlink");
        let error = apply(
            CodexRecordKind::Instruction,
            "record",
            &root,
            Path::new("AGENTS.md"),
            "new\n",
            &super::revision(b"outside\n"),
        )
        .expect_err("symlink rejection");
        assert!(error.contains("safe") || error.contains("symlink"));
        assert_eq!(
            fs::read_to_string(&outside).expect("outside unchanged"),
            "outside\n"
        );
        crate::testutil::remove_tree(root);
    }

    #[test]
    fn content_validation_rejects_redacted_placeholders_and_oversized_input() {
        assert!(validate_content("[redacted]").is_err());

        let oversized = "x".repeat(MAX_CONTENT_BYTES + 1);
        assert!(validate_content(&oversized).is_err());
    }
}
