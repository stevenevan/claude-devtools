//! Read-only Codex skill inventory.
//!
//! Skill folders are local instruction packages. The inspector reads only
//! bounded metadata and resource names. It never imports, resolves, or runs a
//! script, prompt, MCP server, or other declared capability.

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

use toml_edit::{DocumentMut, Item, Value};

use crate::config::codex_context::ResolvedCodexProjectContext;
use crate::config::root;
use crate::files::codex_inventory::{
    exact_revision, metadata_revision, read_bounded_file, resolve_readonly_directory,
    source_identity, MAX_DETAIL_BYTES, MAX_INVENTORY_ITEMS, MAX_RESOURCE_NAMES,
};
use crate::files::codex_plugins;
use crate::types::codex_inventory::{
    CodexEnabledState, CodexInventoryDiagnostic, CodexInventoryScope, CodexInventorySummary,
    CodexRecordKind, CodexSkillDetail, CodexSkillList, CodexSkillResource, CodexSkillSummary,
    CodexSourceIdentity, CodexValidationState,
};

const SKILL_METADATA_BYTES: usize = 32 * 1024;
const OPENAI_METADATA_BYTES: usize = 16 * 1024;
const SKILL_CONFIG_BYTES: usize = 256 * 1024;
const MAX_SKILL_NAME_BYTES: usize = 128;
const MAX_DESCRIPTION_BYTES: usize = 512;
const RESOURCE_DIRECTORIES: [&str; 3] = ["scripts", "references", "assets"];

#[derive(Debug, Clone)]
pub(crate) struct SkillRecord {
    pub summary: CodexSkillSummary,
    pub root: PathBuf,
    pub relative: PathBuf,
}

#[derive(Debug, Clone)]
pub(crate) struct SkillInventory {
    pub view: CodexSkillList,
    pub records: Vec<SkillRecord>,
}

#[derive(Debug, Clone)]
struct SkillRoot {
    root: PathBuf,
    relative: PathBuf,
    source_scope: CodexInventoryScope,
    owner_plugin_id: Option<String>,
}

#[derive(Debug, Clone, Default)]
struct SkillConfig {
    available: bool,
    source_label: Option<String>,
    overrides: Vec<SkillOverride>,
    diagnostics: Vec<CodexInventoryDiagnostic>,
}

#[derive(Debug, Clone)]
struct SkillOverride {
    name: Option<String>,
    path: Option<String>,
    enabled: bool,
}

pub(crate) fn discover(
    codex_home: &Path,
    scope: &CodexInventoryScope,
    context: Option<&ResolvedCodexProjectContext>,
) -> Result<SkillInventory, String> {
    let plugin_inventory = codex_plugins::discover(codex_home, scope, context)?;
    let mut roots = skill_roots(codex_home, scope, context)?;
    roots.extend(
        plugin_inventory
            .skill_roots
            .into_iter()
            .map(|root| SkillRoot {
                root: root.root,
                relative: root.relative,
                source_scope: root.source_scope,
                owner_plugin_id: Some(root.owner_plugin_id),
            }),
    );
    roots.sort_by(|left, right| {
        left.root
            .cmp(&right.root)
            .then_with(|| left.relative.cmp(&right.relative))
    });
    roots.dedup_by(|left, right| {
        left.root == right.root
            && left.relative == right.relative
            && left.source_scope == right.source_scope
    });
    let config = read_skill_config(codex_home, scope, context);
    let mut records = Vec::new();
    let mut diagnostics = config.diagnostics.clone();
    diagnostics.extend(plugin_inventory.view.summary.diagnostics);
    let mut omitted_count = 0usize;

    for skill_root in roots {
        let entries = match fs::read_dir(skill_root.root.join(&skill_root.relative)) {
            Ok(entries) => entries,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
            Err(_) => {
                diagnostics.push(diagnostic(
                    "warning",
                    "unreadable-directory",
                    "A Codex skill directory could not be read",
                    Some(&relative_to_string(&skill_root.relative)),
                ));
                continue;
            }
        };
        let mut names: Vec<String> = entries
            .flatten()
            .filter_map(|entry| entry.file_name().to_str().map(ToString::to_string))
            .filter(|name| !name.starts_with('.') && !name.is_empty())
            .collect();
        names.sort();
        for name in names {
            if records.len() >= MAX_INVENTORY_ITEMS {
                omitted_count = omitted_count.saturating_add(1);
                continue;
            }
            let relative = skill_root.relative.join(&name);
            let identity = source_identity(
                &skill_root.source_scope,
                CodexRecordKind::Skill,
                &relative_to_string(&relative),
            );
            let summary = inspect_skill(
                &skill_root.root,
                &relative,
                identity,
                &config,
                skill_root.owner_plugin_id.as_deref(),
                &mut diagnostics,
            );
            records.push(SkillRecord {
                summary,
                root: skill_root.root.clone(),
                relative,
            });
        }
    }
    diagnostics.truncate(crate::files::codex_inventory::MAX_DIAGNOSTICS);
    let items = records
        .iter()
        .map(|record| record.summary.clone())
        .collect();
    Ok(SkillInventory {
        view: CodexSkillList {
            items,
            summary: CodexInventorySummary {
                scope: scope.clone(),
                scan_limited: omitted_count > 0,
                omitted_count,
                diagnostics,
            },
        },
        records,
    })
}

pub(crate) fn read_detail(
    record: &SkillRecord,
    max_bytes: usize,
) -> Result<CodexSkillDetail, String> {
    let resolved = resolve_readonly_directory(&record.root, &record.relative)
        .map_err(|error| format!("codex skills: cannot resolve selected skill: {error}"))?;
    let skill_md = resolved.target_path.join("SKILL.md");
    let (content, truncated) = match read_bounded_file(&skill_md, max_bytes.min(MAX_DETAIL_BYTES)) {
        Ok(value) => (value.text, value.truncated),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => (String::new(), false),
        Err(error) => {
            return Err(format!(
                "codex skills: cannot read selected SKILL.md: {error}"
            ))
        }
    };
    let exact_revision = exact_revision(&skill_md).ok();
    let mut skill = record.summary.clone();
    skill.revision = exact_revision.clone();
    skill.metadata_truncated = truncated;
    Ok(CodexSkillDetail {
        skill,
        content,
        truncated,
        exact_revision,
        untrusted: true,
    })
}

fn inspect_skill(
    root: &Path,
    relative: &Path,
    identity: CodexSourceIdentity,
    config: &SkillConfig,
    owner_plugin_id: Option<&str>,
    diagnostics: &mut Vec<CodexInventoryDiagnostic>,
) -> CodexSkillSummary {
    let fallback_name = relative
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("skill");
    let mut summary = CodexSkillSummary {
        identity,
        name: bounded_text(fallback_name, MAX_SKILL_NAME_BYTES),
        description: String::new(),
        state: CodexValidationState::Valid,
        enabled_state: CodexEnabledState::Unknown,
        enabled_source: None,
        owner_plugin_id: owner_plugin_id.map(str::to_string),
        symlink: false,
        external_target: false,
        entry_point: "SKILL.md".to_string(),
        resources: Vec::new(),
        metadata_truncated: false,
        revision: None,
        diagnostics: Vec::new(),
    };
    let resolved = match resolve_readonly_directory(root, relative) {
        Ok(resolved) => resolved,
        Err(error) => {
            summary.state = CodexValidationState::Invalid;
            summary.diagnostics.push(diagnostic(
                "warning",
                "invalid-skill-directory",
                skill_directory_error(error),
                Some(&relative_to_string(relative)),
            ));
            return summary;
        }
    };
    summary.symlink = resolved.is_symlink;
    summary.external_target = resolved.external_target;
    let skill_md = resolved.target_path.join("SKILL.md");
    let metadata = match fs::symlink_metadata(&skill_md) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            summary.state = CodexValidationState::Missing;
            summary.diagnostics.push(diagnostic(
                "warning",
                "missing-entry-point",
                "The skill directory has no SKILL.md entry point",
                Some(&relative_to_string(relative)),
            ));
            apply_enabled_state(&mut summary, config, relative, &resolved.target_path);
            summary.resources = collect_resources(&resolved.target_path, diagnostics);
            return summary;
        }
        Err(_) => {
            summary.state = CodexValidationState::Invalid;
            summary.diagnostics.push(diagnostic(
                "warning",
                "unreadable-entry-point",
                "The skill entry point could not be inspected",
                Some(&relative_to_string(relative)),
            ));
            return summary;
        }
    };
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        summary.state = CodexValidationState::Invalid;
        summary.diagnostics.push(diagnostic(
            "warning",
            "invalid-entry-point",
            "SKILL.md must be a regular file and cannot be a symlink",
            Some(&relative_to_string(relative)),
        ));
        return summary;
    }
    let bounded = match read_bounded_file(&skill_md, SKILL_METADATA_BYTES) {
        Ok(value) => value,
        Err(_) => {
            summary.state = CodexValidationState::Invalid;
            summary.diagnostics.push(diagnostic(
                "warning",
                "unreadable-entry-point",
                "The skill entry point could not be read",
                Some(&relative_to_string(relative)),
            ));
            return summary;
        }
    };
    summary.metadata_truncated = bounded.truncated;
    summary.revision = metadata_revision(&skill_md);
    if bounded.truncated {
        summary.diagnostics.push(diagnostic(
            "warning",
            "entry-point-truncated",
            "SKILL.md metadata was truncated at the bounded read limit",
            Some(&relative_to_string(relative)),
        ));
    }
    match parse_skill_metadata(&bounded.text, fallback_name) {
        Ok((name, description)) => {
            summary.name = name;
            summary.description = description;
        }
        Err(message) => {
            summary.state = CodexValidationState::Malformed;
            summary.diagnostics.push(diagnostic(
                "warning",
                "malformed-metadata",
                message,
                Some(&relative_to_string(relative)),
            ));
        }
    }
    if let Some((name, description)) = read_openai_metadata(&resolved.target_path, diagnostics) {
        if summary.description.is_empty() {
            summary.description = description;
        }
        if summary.name == fallback_name {
            summary.name = name;
        }
    }
    summary.resources = collect_resources(&resolved.target_path, diagnostics);
    apply_enabled_state(&mut summary, config, relative, &resolved.target_path);
    summary
}

fn apply_enabled_state(
    summary: &mut CodexSkillSummary,
    config: &SkillConfig,
    relative: &Path,
    target: &Path,
) {
    let relative_text = relative_to_string(relative);
    let name = summary.name.as_str();
    let matching = config.overrides.iter().rev().find(|entry| {
        entry.name.as_deref() == Some(name)
            || entry.path.as_deref() == Some(relative_text.as_str())
            || entry
                .path
                .as_deref()
                .and_then(|path| fs::canonicalize(path).ok())
                .is_some_and(|path| path == target.join("SKILL.md"))
    });
    match matching {
        Some(entry) => {
            summary.enabled_state = if entry.enabled {
                CodexEnabledState::Enabled
            } else {
                CodexEnabledState::Disabled
            };
            summary.enabled_source = config.source_label.clone();
        }
        None if config.available => {
            summary.enabled_state = CodexEnabledState::Inherited;
            summary.enabled_source = config.source_label.clone();
        }
        None => summary.enabled_state = CodexEnabledState::Unknown,
    }
}

fn skill_roots(
    codex_home: &Path,
    scope: &CodexInventoryScope,
    context: Option<&ResolvedCodexProjectContext>,
) -> Result<Vec<SkillRoot>, String> {
    let mut roots = Vec::new();
    if let CodexInventoryScope::Project { project_id } = scope {
        let context = context.ok_or_else(|| {
            "codex skills: project scope requires a validated project context".to_string()
        })?;
        let relative = context
            .working_directory
            .strip_prefix(&context.project_root)
            .map_err(|_| "codex skills: working directory is outside project root".to_string())?;
        let mut current = context.project_root.clone();
        let source_scope = CodexInventoryScope::Project {
            project_id: project_id.clone(),
        };
        roots.push(SkillRoot {
            root: context.project_root.clone(),
            relative: PathBuf::from(".agents/skills"),
            source_scope: source_scope.clone(),
            owner_plugin_id: None,
        });
        for component in relative.components() {
            current.push(component.as_os_str());
            let root_relative = current
                .strip_prefix(&context.project_root)
                .map_err(|_| "codex skills: project path normalization failed".to_string())?;
            roots.push(SkillRoot {
                root: context.project_root.clone(),
                relative: root_relative.join(".agents/skills"),
                source_scope: source_scope.clone(),
                owner_plugin_id: None,
            });
        }
    }
    let home = root::home_dir()?;
    let official = home.join(".agents/skills");
    if official.exists() {
        roots.push(SkillRoot {
            root: home,
            relative: PathBuf::from(".agents/skills"),
            source_scope: CodexInventoryScope::Global,
            owner_plugin_id: None,
        });
    } else {
        let codex_agents = codex_home.join(".agents/skills");
        let codex_skills = codex_home.join("skills");
        if codex_agents.exists() {
            roots.push(SkillRoot {
                root: codex_home.to_path_buf(),
                relative: PathBuf::from(".agents/skills"),
                source_scope: CodexInventoryScope::Global,
                owner_plugin_id: None,
            });
        } else if codex_skills.exists() {
            roots.push(SkillRoot {
                root: codex_home.to_path_buf(),
                relative: PathBuf::from("skills"),
                source_scope: CodexInventoryScope::Global,
                owner_plugin_id: None,
            });
        } else {
            roots.push(SkillRoot {
                root: home,
                relative: PathBuf::from(".agents/skills"),
                source_scope: CodexInventoryScope::Global,
                owner_plugin_id: None,
            });
        }
    }
    Ok(roots)
}

fn read_skill_config(
    codex_home: &Path,
    scope: &CodexInventoryScope,
    context: Option<&ResolvedCodexProjectContext>,
) -> SkillConfig {
    let mut config = SkillConfig::default();
    let mut sources = vec![(
        codex_home.to_path_buf(),
        PathBuf::from("config.toml"),
        "Codex config.toml".to_string(),
    )];
    if let CodexInventoryScope::Project { .. } = scope {
        if let Some(context) = context {
            let relative = context
                .working_directory
                .strip_prefix(&context.project_root)
                .unwrap_or(Path::new(""));
            let mut current = context.project_root.clone();
            sources.push((
                context.project_root.clone(),
                PathBuf::from(".codex/config.toml"),
                "Project .codex/config.toml".to_string(),
            ));
            for component in relative.components() {
                current.push(component.as_os_str());
                let root_relative = current
                    .strip_prefix(&context.project_root)
                    .unwrap_or(Path::new(""));
                sources.push((
                    context.project_root.clone(),
                    root_relative.join(".codex/config.toml"),
                    "Project .codex/config.toml".to_string(),
                ));
            }
        }
    }
    for (root, relative, source_label) in sources {
        let path = root.join(&relative);
        let bounded = match read_bounded_file(&path, SKILL_CONFIG_BYTES) {
            Ok(value) => value,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
            Err(_) => {
                config.diagnostics.push(diagnostic(
                    "warning",
                    "config-unreadable",
                    "Codex skill configuration could not be read",
                    Some(&relative_to_string(&relative)),
                ));
                continue;
            }
        };
        if bounded.truncated {
            config.diagnostics.push(diagnostic(
                "warning",
                "config-truncated",
                "Codex skill configuration exceeded the bounded read limit",
                Some(&relative_to_string(&relative)),
            ));
            continue;
        }
        let document: DocumentMut = match bounded.text.parse() {
            Ok(document) => document,
            Err(_) => {
                config.diagnostics.push(diagnostic(
                    "warning",
                    "config-malformed",
                    "Codex skill configuration is malformed",
                    Some(&relative_to_string(&relative)),
                ));
                continue;
            }
        };
        config.available = true;
        config.source_label = Some(source_label);
        parse_skill_overrides(&document, &mut config, &relative);
    }
    config
}

fn parse_skill_overrides(document: &DocumentMut, config: &mut SkillConfig, relative: &Path) {
    let Some(skills) = document.get("skills").and_then(Item::as_table) else {
        return;
    };
    let Some(entries) = skills.get("config").and_then(Item::as_array_of_tables) else {
        return;
    };
    for entry in entries.iter().take(MAX_INVENTORY_ITEMS) {
        let name = entry
            .get("name")
            .and_then(Item::as_value)
            .and_then(Value::as_str)
            .map(ToString::to_string);
        let path = entry
            .get("path")
            .and_then(Item::as_value)
            .and_then(Value::as_str)
            .map(ToString::to_string);
        let enabled = entry
            .get("enabled")
            .and_then(Item::as_value)
            .and_then(Value::as_bool);
        match (enabled, name.is_some() || path.is_some()) {
            (Some(enabled), true) => config.overrides.push(SkillOverride {
                name,
                path,
                enabled,
            }),
            _ => config.diagnostics.push(diagnostic(
                "warning",
                "invalid-skill-config",
                "A skills.config entry needs a name or path and a boolean enabled value",
                Some(&relative_to_string(relative)),
            )),
        }
    }
}

fn parse_skill_metadata(
    content: &str,
    fallback_name: &str,
) -> Result<(String, String), &'static str> {
    let trimmed = content.trim_start();
    if !trimmed.starts_with("---") {
        return Ok((
            bounded_text(fallback_name, MAX_SKILL_NAME_BYTES),
            String::new(),
        ));
    }
    let rest = &trimmed[3..];
    let Some(end) = rest.find("\n---") else {
        return Err("SKILL.md front matter is missing its closing delimiter");
    };
    let frontmatter = &rest[..end];
    let mut name = None;
    let mut description = None;
    for line in frontmatter.lines() {
        let Some((key, value)) = line.split_once(':') else {
            continue;
        };
        let value = unquote(value.trim());
        match key.trim() {
            "name" => name = Some(value),
            "description" => description = Some(value),
            _ => {}
        }
    }
    Ok((
        bounded_text(
            &redact_text(name.as_deref().unwrap_or(fallback_name)),
            MAX_SKILL_NAME_BYTES,
        ),
        bounded_text(
            &redact_text(description.as_deref().unwrap_or_default()),
            MAX_DESCRIPTION_BYTES,
        ),
    ))
}

fn read_openai_metadata(
    root: &Path,
    diagnostics: &mut Vec<CodexInventoryDiagnostic>,
) -> Option<(String, String)> {
    let path = root.join("agents/openai.yaml");
    let metadata = fs::symlink_metadata(&path).ok()?;
    if !metadata.is_file() || metadata.file_type().is_symlink() {
        diagnostics.push(diagnostic(
            "warning",
            "invalid-openai-metadata",
            "agents/openai.yaml is not a regular file",
            Some("agents/openai.yaml"),
        ));
        return None;
    }
    let bounded = match read_bounded_file(&path, OPENAI_METADATA_BYTES) {
        Ok(value) => value,
        Err(_) => {
            diagnostics.push(diagnostic(
                "warning",
                "unreadable-openai-metadata",
                "agents/openai.yaml could not be read",
                Some("agents/openai.yaml"),
            ));
            return None;
        }
    };
    let mut values = BTreeMap::new();
    for line in bounded.text.lines() {
        let Some((key, value)) = line.split_once(':') else {
            continue;
        };
        let key = key.trim();
        if matches!(key, "display_name" | "short_description") {
            values.insert(key.to_string(), unquote(value.trim()));
        }
    }
    Some((
        bounded_text(
            &redact_text(values.get("display_name").map(String::as_str).unwrap_or("")),
            MAX_SKILL_NAME_BYTES,
        ),
        bounded_text(
            &redact_text(
                values
                    .get("short_description")
                    .map(String::as_str)
                    .unwrap_or(""),
            ),
            MAX_DESCRIPTION_BYTES,
        ),
    ))
}

fn collect_resources(
    root: &Path,
    diagnostics: &mut Vec<CodexInventoryDiagnostic>,
) -> Vec<CodexSkillResource> {
    let mut resources = Vec::new();
    for directory in RESOURCE_DIRECTORIES {
        collect_resource_tree(
            root,
            Path::new(directory),
            directory,
            &mut resources,
            diagnostics,
        );
        if resources.len() >= MAX_RESOURCE_NAMES {
            break;
        }
    }
    let openai = root.join("agents/openai.yaml");
    if resources.len() < MAX_RESOURCE_NAMES && fs::symlink_metadata(&openai).is_ok() {
        resources.push(CodexSkillResource {
            kind: "metadata".to_string(),
            relative_path: "agents/openai.yaml".to_string(),
        });
    }
    resources.truncate(MAX_RESOURCE_NAMES);
    resources
}

fn collect_resource_tree(
    root: &Path,
    relative: &Path,
    kind: &str,
    output: &mut Vec<CodexSkillResource>,
    diagnostics: &mut Vec<CodexInventoryDiagnostic>,
) {
    if output.len() >= MAX_RESOURCE_NAMES {
        return;
    }
    let directory = root.join(relative);
    let entries = match fs::read_dir(&directory) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return,
        Err(_) => {
            diagnostics.push(diagnostic(
                "warning",
                "resource-unreadable",
                "A skill resource directory could not be listed",
                Some(&relative_to_string(relative)),
            ));
            return;
        }
    };
    let mut children: Vec<PathBuf> = entries.flatten().map(|entry| entry.path()).collect();
    children.sort();
    for child in children {
        if output.len() >= MAX_RESOURCE_NAMES {
            return;
        }
        let child_relative = child
            .strip_prefix(root)
            .unwrap_or(child.as_path())
            .to_path_buf();
        output.push(CodexSkillResource {
            kind: kind.to_string(),
            relative_path: relative_to_string(&child_relative),
        });
        if fs::symlink_metadata(&child)
            .map(|metadata| metadata.is_dir() && !metadata.file_type().is_symlink())
            .unwrap_or(false)
        {
            collect_resource_tree(root, &child_relative, kind, output, diagnostics);
        }
    }
}

fn skill_directory_error(error: std::io::Error) -> String {
    if error.kind() == std::io::ErrorKind::NotFound {
        "The skill directory is missing".to_string()
    } else if error.kind() == std::io::ErrorKind::InvalidData {
        "The skill entry is not a directory".to_string()
    } else {
        "The skill directory is invalid or could not be resolved".to_string()
    }
}

fn unquote(value: &str) -> String {
    if value.len() >= 2
        && ((value.starts_with('"') && value.ends_with('"'))
            || (value.starts_with('\'') && value.ends_with('\'')))
    {
        value[1..value.len() - 1].to_string()
    } else {
        value.to_string()
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
    let sensitive = ["token", "secret", "password", "api_key", "apikey"]
        .iter()
        .any(|marker| lower.contains(marker));
    if sensitive && value.len() >= 12 {
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
#[path = "codex_skills_tests.rs"]
mod tests;
