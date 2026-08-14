//! Codex `AGENTS.md` discovery and bounded detail reads.
//!
//! This module mirrors Codex's project-document precedence without treating
//! local instructions as trusted application input. It returns source
//! metadata for list views and only reads full text through an explicit detail
//! call.

use std::fs;
use std::path::{Path, PathBuf};

use toml_edit::{DocumentMut, Value};

use crate::config::codex_context::ResolvedCodexProjectContext;
use crate::files::codex_inventory::{
    confined_path, exact_revision, metadata_revision, read_bounded_file, source_identity,
    DEFAULT_PROJECT_DOC_MAX_BYTES, MAX_DETAIL_BYTES, MAX_FALLBACK_FILENAMES,
    MAX_FALLBACK_FILENAME_BYTES, MAX_INVENTORY_ITEMS, MAX_PROJECT_DOC_MAX_BYTES,
};
use crate::types::codex_inventory::{
    CodexInstructionDetail, CodexInstructionList, CodexInstructionSource, CodexInventoryDiagnostic,
    CodexInventoryScope, CodexInventorySummary, CodexRecordKind, CodexValidationState,
};

const GLOBAL_DOCUMENT_NAMES: [&str; 2] = ["AGENTS.override.md", "AGENTS.md"];

#[derive(Debug, Clone)]
pub(crate) struct InstructionRecord {
    pub source: CodexInstructionSource,
    pub root: PathBuf,
    pub relative: PathBuf,
}

#[derive(Debug, Clone)]
pub(crate) struct InstructionInventory {
    pub view: CodexInstructionList,
    pub records: Vec<InstructionRecord>,
}

#[derive(Debug, Clone)]
struct InstructionPolicy {
    max_bytes: usize,
    fallback_filenames: Vec<String>,
    diagnostics: Vec<CodexInventoryDiagnostic>,
}

/// Discover active instruction sources for either the global Codex source or
/// the validated project-to-working-directory chain.
pub(crate) fn discover(
    codex_home: &Path,
    scope: &CodexInventoryScope,
    context: Option<&ResolvedCodexProjectContext>,
) -> Result<InstructionInventory, String> {
    let policy = read_policy(codex_home);
    let mut records = Vec::new();
    let mut diagnostics = policy.diagnostics.clone();
    let mut scan_limited = false;
    let mut omitted_count = 0usize;

    match scope {
        CodexInventoryScope::Global => {
            let mut candidates = Vec::new();
            for name in GLOBAL_DOCUMENT_NAMES {
                candidates.push(name.to_string());
            }
            let choice = choose_document(
                codex_home,
                codex_home,
                &candidates,
                scope,
                0,
                policy.max_bytes,
                &mut diagnostics,
            );
            if let Some(record) = choice {
                records.push(record);
            }
        }
        CodexInventoryScope::Project { .. } => {
            let context = context.ok_or_else(|| {
                "codex instructions: project scope requires a validated project context".to_string()
            })?;
            let directories = project_directories(context)?;
            let mut used_bytes = 0usize;
            for (priority, directory) in directories.iter().enumerate() {
                if used_bytes >= policy.max_bytes {
                    scan_limited = true;
                    omitted_count = directories.len().saturating_sub(priority);
                    diagnostics.push(diagnostic(
                        "warning",
                        "document-limit",
                        "The cumulative project instruction limit was reached",
                        None,
                    ));
                    break;
                }
                let candidates = document_names(&policy.fallback_filenames);
                let remaining = policy.max_bytes.saturating_sub(used_bytes);
                if let Some(record) = choose_document(
                    &context.project_root,
                    directory,
                    &candidates,
                    scope,
                    priority,
                    remaining,
                    &mut diagnostics,
                ) {
                    used_bytes = used_bytes.saturating_add(record.source.bytes.min(remaining));
                    if record.source.truncated {
                        scan_limited = true;
                    }
                    records.push(record);
                }
            }
        }
    }

    if records.len() > MAX_INVENTORY_ITEMS {
        omitted_count = omitted_count.saturating_add(records.len() - MAX_INVENTORY_ITEMS);
        records.truncate(MAX_INVENTORY_ITEMS);
        scan_limited = true;
    }
    diagnostics.truncate(crate::files::codex_inventory::MAX_DIAGNOSTICS);
    let summary = CodexInventorySummary {
        scope: scope.clone(),
        scan_limited,
        omitted_count,
        diagnostics,
    };
    let items = records.iter().map(|record| record.source.clone()).collect();
    Ok(InstructionInventory {
        view: CodexInstructionList { items, summary },
        records,
    })
}

pub(crate) fn read_detail(
    record: &InstructionRecord,
    max_bytes: usize,
) -> Result<CodexInstructionDetail, String> {
    let max_bytes = max_bytes.min(MAX_DETAIL_BYTES);
    let path = confined_path(&record.root, &record.relative)
        .map_err(|error| format!("codex instructions: cannot resolve selected source: {error}"))?;
    let bounded = read_bounded_file(&path, max_bytes)
        .map_err(|error| format!("codex instructions: cannot read selected source: {error}"))?;
    let exact_revision = exact_revision(&path)
        .map_err(|error| format!("codex instructions: cannot revision selected source: {error}"))?;
    let mut source = record.source.clone();
    source.revision = Some(exact_revision.clone());
    source.bytes = bounded.bytes_read;
    source.truncated = bounded.truncated;
    if bounded.truncated {
        source.diagnostics.push(diagnostic(
            "warning",
            "document-truncated",
            "The instruction detail exceeded the bounded read limit",
            Some(&source.identity.id),
        ));
    }
    Ok(CodexInstructionDetail {
        source,
        content: bounded.text,
        truncated: bounded.truncated,
        exact_revision,
        untrusted: true,
    })
}

fn choose_document(
    root: &Path,
    directory: &Path,
    names: &[String],
    scope: &CodexInventoryScope,
    priority: usize,
    max_bytes: usize,
    diagnostics: &mut Vec<CodexInventoryDiagnostic>,
) -> Option<InstructionRecord> {
    let relative_directory = directory.strip_prefix(root).ok()?;
    for name in names {
        let relative = relative_directory.join(name);
        let path = directory.join(name);
        let metadata = match fs::symlink_metadata(&path) {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
            Err(_) => {
                diagnostics.push(diagnostic(
                    "warning",
                    "unreadable",
                    "An instruction source could not be inspected",
                    Some(&relative_to_string(&relative)),
                ));
                continue;
            }
        };
        if metadata.file_type().is_symlink() {
            diagnostics.push(diagnostic(
                "warning",
                "symlink-rejected",
                "Instruction sources cannot be read through symlinks",
                Some(&relative_to_string(&relative)),
            ));
            continue;
        }
        if !metadata.is_file() {
            diagnostics.push(diagnostic(
                "warning",
                "not-regular-file",
                "The instruction source is not a regular file",
                Some(&relative_to_string(&relative)),
            ));
            continue;
        }
        let bounded = match read_bounded_file(&path, max_bytes) {
            Ok(value) => value,
            Err(_) => {
                diagnostics.push(diagnostic(
                    "warning",
                    "unreadable",
                    "An instruction source could not be read",
                    Some(&relative_to_string(&relative)),
                ));
                continue;
            }
        };
        if bounded.text.trim().is_empty() {
            diagnostics.push(diagnostic(
                "info",
                "empty",
                "An empty instruction source was skipped",
                Some(&relative_to_string(&relative)),
            ));
            continue;
        }
        let relative_text = relative_to_string(&relative);
        let identity = source_identity(scope, CodexRecordKind::Instruction, &relative_text);
        let mut source = CodexInstructionSource {
            identity,
            active: true,
            priority,
            state: CodexValidationState::Valid,
            bytes: metadata.len().min(usize::MAX as u64) as usize,
            truncated: bounded.truncated,
            revision: metadata_revision(&path),
            diagnostics: Vec::new(),
        };
        if bounded.truncated {
            source.diagnostics.push(diagnostic(
                "warning",
                "document-truncated",
                "The cumulative project instruction limit truncated this source",
                Some(&source.identity.id),
            ));
        }
        return Some(InstructionRecord {
            source,
            root: root.to_path_buf(),
            relative,
        });
    }
    None
}

fn project_directories(context: &ResolvedCodexProjectContext) -> Result<Vec<PathBuf>, String> {
    let relative = context
        .working_directory
        .strip_prefix(&context.project_root)
        .map_err(|_| "codex instructions: working directory is outside project root".to_string())?;
    let mut directories = Vec::new();
    let mut current = context.project_root.clone();
    directories.push(current.clone());
    for component in relative.components() {
        current.push(component.as_os_str());
        directories.push(current.clone());
    }
    Ok(directories)
}

fn document_names(fallback_filenames: &[String]) -> Vec<String> {
    let mut names = Vec::with_capacity(2 + fallback_filenames.len());
    names.extend(GLOBAL_DOCUMENT_NAMES.iter().map(|name| name.to_string()));
    names.extend(fallback_filenames.iter().cloned());
    names
}

fn read_policy(codex_home: &Path) -> InstructionPolicy {
    let mut policy = InstructionPolicy {
        max_bytes: DEFAULT_PROJECT_DOC_MAX_BYTES,
        fallback_filenames: Vec::new(),
        diagnostics: Vec::new(),
    };
    let config = codex_home.join("config.toml");
    let bounded = match read_bounded_file(&config, MAX_DETAIL_BYTES) {
        Ok(value) => value,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return policy,
        Err(_) => {
            policy.diagnostics.push(diagnostic(
                "warning",
                "config-unreadable",
                "Codex instruction settings could not be read; defaults are in use",
                Some("config.toml"),
            ));
            return policy;
        }
    };
    if bounded.truncated {
        policy.diagnostics.push(diagnostic(
            "warning",
            "config-truncated",
            "Codex instruction settings exceeded the bounded read limit",
            Some("config.toml"),
        ));
        return policy;
    }
    let document: DocumentMut = match bounded.text.parse() {
        Ok(document) => document,
        Err(_) => {
            policy.diagnostics.push(diagnostic(
                "warning",
                "config-malformed",
                "Codex instruction settings are malformed; defaults are in use",
                Some("config.toml"),
            ));
            return policy;
        }
    };
    if let Some(item) = document.get("project_doc_max_bytes") {
        match item.as_value().and_then(Value::as_integer) {
            Some(value) if (1..=MAX_PROJECT_DOC_MAX_BYTES as i64).contains(&value) => {
                policy.max_bytes = value as usize;
            }
            _ => policy.diagnostics.push(diagnostic(
                "warning",
                "invalid-project-doc-limit",
                "project_doc_max_bytes is invalid; the default limit is in use",
                Some("config.toml"),
            )),
        }
    }
    if let Some(item) = document.get("project_doc_fallback_filenames") {
        let Some(array) = item.as_value().and_then(Value::as_array) else {
            policy.diagnostics.push(diagnostic(
                "warning",
                "invalid-fallback-filenames",
                "project_doc_fallback_filenames must be an array of file names",
                Some("config.toml"),
            ));
            return policy;
        };
        for value in array {
            if policy.fallback_filenames.len() >= MAX_FALLBACK_FILENAMES {
                policy.diagnostics.push(diagnostic(
                    "warning",
                    "fallback-filenames-limited",
                    "Only the bounded number of fallback filenames was used",
                    Some("config.toml"),
                ));
                break;
            }
            let Some(value) = value.as_str() else {
                policy.diagnostics.push(diagnostic(
                    "warning",
                    "invalid-fallback-filename",
                    "A configured fallback filename was not a string",
                    Some("config.toml"),
                ));
                continue;
            };
            if valid_fallback_filename(value) {
                policy.fallback_filenames.push(value.to_string());
            } else {
                policy.diagnostics.push(diagnostic(
                    "warning",
                    "invalid-fallback-filename",
                    "A configured fallback filename must be one relative file name",
                    Some("config.toml"),
                ));
            }
        }
    }
    policy
}

fn valid_fallback_filename(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= MAX_FALLBACK_FILENAME_BYTES
        && !value.contains('/')
        && !value.contains('\\')
        && value != "."
        && value != ".."
}

fn relative_to_string(path: &Path) -> String {
    path.components()
        .filter_map(|component| match component {
            std::path::Component::Normal(value) => Some(value.to_string_lossy().into_owned()),
            _ => None,
        })
        .collect::<Vec<_>>()
        .join("/")
}

fn diagnostic(
    severity: &str,
    code: &str,
    message: &str,
    relative_path: Option<&str>,
) -> CodexInventoryDiagnostic {
    CodexInventoryDiagnostic {
        severity: severity.to_string(),
        code: code.to_string(),
        message: message.to_string(),
        source_id: None,
        relative_path: relative_path.map(str::to_string),
    }
}

#[cfg(test)]
#[path = "codex_instructions_tests.rs"]
mod tests;
