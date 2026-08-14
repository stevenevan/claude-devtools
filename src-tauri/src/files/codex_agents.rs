//! Read-only inventory and bounded detail reads for Codex custom agents.
//!
//! Agent files are metadata, not executable configuration. Capability names
//! are displayed as unresolved declarations and no command, MCP server, model,
//! or skill is looked up or launched here.

use std::fs;
use std::path::{Path, PathBuf};

use toml_edit::{value, DocumentMut, Item, Value};

use crate::config::codex_context::ResolvedCodexProjectContext;
use crate::files::codex_inventory::{
    confined_path, exact_revision, metadata_revision, read_bounded_file, source_identity,
    MAX_DETAIL_BYTES, MAX_INVENTORY_ITEMS, MAX_RESOURCE_NAMES,
};
use crate::types::codex_inventory::{
    CodexAgentDetail, CodexAgentList, CodexAgentSummary, CodexInventoryDiagnostic,
    CodexInventoryScope, CodexInventorySummary, CodexRecordKind, CodexUnresolvedCapability,
    CodexValidationState,
};

const AGENT_DIRECTORY: &str = "agents";
const PROJECT_AGENT_DIRECTORY: &str = ".codex/agents";
const MAX_AGENT_NAME_BYTES: usize = 128;
const MAX_DESCRIPTION_BYTES: usize = 512;
const ALLOWED_FIELDS: [&str; 9] = [
    "name",
    "description",
    "developer_instructions",
    "model",
    "effort",
    "sandbox_mode",
    "tools",
    "mcp_servers",
    "skills",
];

#[derive(Debug, Clone)]
pub(crate) struct AgentRecord {
    pub summary: CodexAgentSummary,
    pub root: PathBuf,
    pub relative: PathBuf,
}

#[derive(Debug, Clone)]
pub(crate) struct AgentInventory {
    pub view: CodexAgentList,
    pub records: Vec<AgentRecord>,
}

pub(crate) fn discover(
    codex_home: &Path,
    scope: &CodexInventoryScope,
    context: Option<&ResolvedCodexProjectContext>,
) -> Result<AgentInventory, String> {
    let (root, directory) = match scope {
        CodexInventoryScope::Global => (codex_home, Path::new(AGENT_DIRECTORY)),
        CodexInventoryScope::Project { .. } => {
            let context = context.ok_or_else(|| {
                "codex agents: project scope requires a validated project context".to_string()
            })?;
            (&context.project_root, Path::new(PROJECT_AGENT_DIRECTORY))
        }
    };
    let absolute_directory = root.join(directory);
    let mut diagnostics = Vec::new();
    let mut records = Vec::new();
    if let Err(reason) = reject_symlinked_directory(root, directory) {
        diagnostics.push(diagnostic(
            "warning",
            "symlink-rejected",
            reason,
            Some(&relative_to_string(directory)),
        ));
        return Ok(AgentInventory {
            view: CodexAgentList {
                items: Vec::new(),
                summary: summary(scope, false, 0, diagnostics),
            },
            records,
        });
    }
    let entries = match fs::read_dir(&absolute_directory) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(empty_inventory(scope));
        }
        Err(_) => {
            diagnostics.push(diagnostic(
                "warning",
                "unreadable-directory",
                "The custom-agent directory could not be read",
                Some(&relative_to_string(directory)),
            ));
            return Ok(AgentInventory {
                view: CodexAgentList {
                    items: Vec::new(),
                    summary: summary(scope, false, 0, diagnostics),
                },
                records,
            });
        }
    };
    let mut paths: Vec<PathBuf> = entries
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| path.extension().and_then(|value| value.to_str()) == Some("toml"))
        .collect();
    paths.sort();
    let omitted_count = paths.len().saturating_sub(MAX_INVENTORY_ITEMS);
    for path in paths.into_iter().take(MAX_INVENTORY_ITEMS) {
        let Some(name) = path.file_name().and_then(|value| value.to_str()) else {
            continue;
        };
        let relative = directory.join(name);
        let metadata = match fs::symlink_metadata(&path) {
            Ok(metadata) => metadata,
            Err(_) => {
                diagnostics.push(diagnostic(
                    "warning",
                    "unreadable",
                    "A custom-agent file could not be inspected",
                    Some(&relative_to_string(&relative)),
                ));
                continue;
            }
        };
        if metadata.file_type().is_symlink() {
            diagnostics.push(diagnostic(
                "warning",
                "symlink-rejected",
                "Custom-agent files cannot be read through symlinks",
                Some(&relative_to_string(&relative)),
            ));
            continue;
        }
        if !metadata.is_file() {
            diagnostics.push(diagnostic(
                "warning",
                "not-regular-file",
                "A custom-agent entry is not a regular file",
                Some(&relative_to_string(&relative)),
            ));
            continue;
        }
        let summary = match parse_summary(scope, &relative, &path, name) {
            Ok(summary) => summary,
            Err(error) => {
                diagnostics.push(diagnostic(
                    "warning",
                    "unreadable",
                    &error,
                    Some(&relative_to_string(&relative)),
                ));
                continue;
            }
        };
        records.push(AgentRecord {
            summary,
            root: root.to_path_buf(),
            relative,
        });
    }
    diagnostics.truncate(crate::files::codex_inventory::MAX_DIAGNOSTICS);
    let items = records
        .iter()
        .map(|record| record.summary.clone())
        .collect();
    Ok(AgentInventory {
        view: CodexAgentList {
            items,
            summary: summary(scope, omitted_count > 0, omitted_count, diagnostics),
        },
        records,
    })
}

pub(crate) fn read_detail(
    record: &AgentRecord,
    max_bytes: usize,
) -> Result<CodexAgentDetail, String> {
    let path = confined_path(&record.root, &record.relative)
        .map_err(|error| format!("codex agents: cannot resolve selected agent: {error}"))?;
    let bounded = read_bounded_file(&path, max_bytes.min(MAX_DETAIL_BYTES))
        .map_err(|error| format!("codex agents: cannot read selected agent: {error}"))?;
    let exact_revision = exact_revision(&path)
        .map_err(|error| format!("codex agents: cannot revision selected agent: {error}"))?;
    let mut agent = record.summary.clone();
    agent.revision = Some(exact_revision.clone());
    let developer_instructions = parse_developer_instructions(&bounded.text).map(redact_text);
    Ok(CodexAgentDetail {
        agent,
        developer_instructions,
        truncated: bounded.truncated,
        exact_revision,
        untrusted: true,
    })
}

/// Replace only the developer-instructions field while preserving all other
/// agent metadata and unknown TOML fields on the server.
pub(crate) fn render_developer_instructions(
    current: &str,
    instructions: &str,
) -> Result<String, String> {
    let mut document: DocumentMut = current.parse().map_err(|_| {
        "codex agents: selected agent TOML could not be parsed for editing".to_string()
    })?;
    document["developer_instructions"] = value(instructions);
    Ok(document.to_string())
}

fn parse_summary(
    scope: &CodexInventoryScope,
    relative: &Path,
    path: &Path,
    file_name: &str,
) -> Result<CodexAgentSummary, String> {
    let identity = source_identity(scope, CodexRecordKind::Agent, &relative_to_string(relative));
    let fallback_name = file_name.trim_end_matches(".toml");
    let bounded = read_bounded_file(path, MAX_DETAIL_BYTES)
        .map_err(|_| "A custom-agent file could not be read".to_string())?;
    let revision = metadata_revision(path);
    let mut diagnostics = Vec::new();
    let mut summary = CodexAgentSummary {
        identity,
        name: bounded_text(fallback_name, MAX_AGENT_NAME_BYTES),
        description: String::new(),
        state: CodexValidationState::Valid,
        revision,
        developer_instructions_available: false,
        model: None,
        effort: None,
        sandbox_mode: None,
        declared_capabilities: Vec::new(),
        diagnostics: Vec::new(),
    };
    let document: DocumentMut = match bounded.text.parse() {
        Ok(document) => document,
        Err(_) => {
            summary.state = CodexValidationState::Malformed;
            summary.diagnostics.push(diagnostic(
                "warning",
                "malformed-toml",
                "The custom-agent TOML could not be parsed",
                Some(&relative_to_string(relative)),
            ));
            return Ok(summary);
        }
    };
    for key in document.iter().map(|(key, _)| key.to_string()) {
        if !ALLOWED_FIELDS.contains(&key.as_str()) {
            diagnostics.push(diagnostic(
                "info",
                "unknown-field",
                "The agent contains a field that is not displayed by this inspector",
                Some(&relative_to_string(relative)),
            ));
        }
    }
    if let Some(value) = string_value(document.get("name")) {
        summary.name = bounded_text(&redact_text(&value), MAX_AGENT_NAME_BYTES);
    }
    if let Some(value) = string_value(document.get("description")) {
        summary.description = bounded_text(&redact_text(&value), MAX_DESCRIPTION_BYTES);
    }
    summary.developer_instructions_available = document
        .get("developer_instructions")
        .and_then(string_value_item)
        .is_some_and(|value| !value.trim().is_empty());
    summary.model = safe_scalar(document.get("model"), &mut diagnostics, relative);
    summary.effort = safe_scalar(document.get("effort"), &mut diagnostics, relative);
    summary.sandbox_mode = safe_scalar(document.get("sandbox_mode"), &mut diagnostics, relative);
    for (key, kind) in [
        ("tools", "tool"),
        ("mcp_servers", "mcp"),
        ("skills", "skill"),
    ] {
        append_capabilities(
            &mut summary.declared_capabilities,
            document.get(key),
            kind,
            &mut diagnostics,
            relative,
        );
    }
    diagnostics.truncate(crate::files::codex_inventory::MAX_DIAGNOSTICS);
    summary.diagnostics = diagnostics;
    Ok(summary)
}

fn parse_developer_instructions(content: &str) -> Option<String> {
    let document: DocumentMut = content.parse().ok()?;
    string_value(document.get("developer_instructions"))
}

fn append_capabilities(
    output: &mut Vec<CodexUnresolvedCapability>,
    item: Option<&Item>,
    kind: &str,
    diagnostics: &mut Vec<CodexInventoryDiagnostic>,
    relative: &Path,
) {
    let Some(item) = item else { return };
    let mut values = Vec::new();
    if let Some(value) = item.as_value().and_then(Value::as_str) {
        values.push(value.to_string());
    } else if let Some(array) = item.as_value().and_then(Value::as_array) {
        for value in array.iter().take(MAX_RESOURCE_NAMES) {
            if let Some(value) = value.as_str() {
                values.push(value.to_string());
            } else {
                diagnostics.push(diagnostic(
                    "info",
                    "unresolved-capability",
                    "A declared capability was not a simple name and was left unresolved",
                    Some(&relative_to_string(relative)),
                ));
            }
        }
    } else {
        diagnostics.push(diagnostic(
            "info",
            "unresolved-capability",
            "A declared capability was not a simple name and was left unresolved",
            Some(&relative_to_string(relative)),
        ));
    }
    for value in values
        .into_iter()
        .take(MAX_RESOURCE_NAMES.saturating_sub(output.len()))
    {
        let value = redact_text(&value);
        if !value.is_empty() {
            output.push(CodexUnresolvedCapability {
                name: bounded_text(&value, MAX_DESCRIPTION_BYTES),
                kind: kind.to_string(),
                resolved: false,
            });
        }
    }
}

fn safe_scalar(
    item: Option<&Item>,
    diagnostics: &mut Vec<CodexInventoryDiagnostic>,
    relative: &Path,
) -> Option<String> {
    let value = string_value(item)?;
    let redacted = redact_text(&value);
    if redacted == "[redacted]" {
        diagnostics.push(diagnostic(
            "warning",
            "redacted-value",
            "A token-shaped agent value was redacted",
            Some(&relative_to_string(relative)),
        ));
        None
    } else {
        Some(bounded_text(&redacted, MAX_DESCRIPTION_BYTES))
    }
}

fn string_value(item: Option<&Item>) -> Option<String> {
    item.and_then(string_value_item)
}

fn string_value_item(item: &Item) -> Option<String> {
    item.as_value()
        .and_then(Value::as_str)
        .map(ToString::to_string)
}

fn empty_inventory(scope: &CodexInventoryScope) -> AgentInventory {
    AgentInventory {
        view: CodexAgentList {
            items: Vec::new(),
            summary: summary(scope, false, 0, Vec::new()),
        },
        records: Vec::new(),
    }
}

fn reject_symlinked_directory(root: &Path, relative: &Path) -> Result<(), &'static str> {
    let mut current = root.to_path_buf();
    for component in relative.components() {
        let std::path::Component::Normal(name) = component else {
            return Err("The custom-agent directory path is invalid");
        };
        current.push(name);
        match fs::symlink_metadata(&current) {
            Ok(metadata) if metadata.file_type().is_symlink() => {
                return Err("Custom-agent directories cannot be reached through symlinks")
            }
            Ok(metadata) if !metadata.is_dir() => {
                return Err("The custom-agent path is not a directory")
            }
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
            Err(_) => return Err("The custom-agent directory could not be inspected"),
        }
    }
    Ok(())
}

fn summary(
    scope: &CodexInventoryScope,
    scan_limited: bool,
    omitted_count: usize,
    diagnostics: Vec<CodexInventoryDiagnostic>,
) -> CodexInventorySummary {
    CodexInventorySummary {
        scope: scope.clone(),
        scan_limited,
        omitted_count,
        diagnostics,
    }
}

fn bounded_text(value: &str, max_bytes: usize) -> String {
    let mut text = value.to_string();
    if text.len() > max_bytes {
        text.truncate(max_bytes);
        while !text.is_char_boundary(text.len()) {
            text.pop();
        }
    }
    text
}

fn redact_text(value: &str) -> String {
    let lower = value.to_ascii_lowercase();
    let looks_sensitive = [
        "token",
        "secret",
        "password",
        "api_key",
        "apikey",
        "authorization",
    ]
    .iter()
    .any(|marker| lower.contains(marker));
    if looks_sensitive && value.len() >= 12 {
        "[redacted]".to_string()
    } else {
        value.to_string()
    }
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
#[path = "codex_agents_tests.rs"]
mod tests;
