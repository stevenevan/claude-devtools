//! Bounded, read-only discovery of local Codex plugins and marketplace data.
//!
//! This reader never installs, updates, launches, or follows a manifest
//! pointer outside the fixed source root that declared it. Manifest parsing
//! uses an explicit display allowlist; unknown values are ignored.

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

use serde_json::{Map, Value};
use sha2::{Digest, Sha256};

use crate::files::codex_inventory::{
    confined_path, read_bounded_file, source_identity, validate_relative_path, MAX_DIAGNOSTICS,
    MAX_INVENTORY_ITEMS,
};
use crate::files::codex_redaction::bounded_display;
use crate::types::codex_inventory::{
    CodexEnabledState, CodexInventoryDiagnostic, CodexInventoryScope, CodexRecordKind,
};
use crate::types::codex_plugins::{
    CodexPluginCapability, CodexPluginCapabilityKind, CodexPluginList, CodexPluginSource,
    CodexPluginState, CodexPluginSummary,
};

const MAX_MANIFEST_BYTES: usize = 64 * 1024;
const MAX_MARKETPLACE_BYTES: usize = 256 * 1024;
const MAX_DIRECTORY_ENTRIES: usize = 256;
const MAX_MARKETPLACE_ENTRIES: usize = 256;
const MAX_CAPABILITIES: usize = 128;
const MAX_SCAN_DEPTH: usize = 5;
const MAX_PLUGIN_NAME_BYTES: usize = 128;
const MAX_DESCRIPTION_BYTES: usize = 512;

#[derive(Debug, Clone)]
pub(crate) struct PluginSkillRoot {
    pub(crate) root: PathBuf,
    pub(crate) relative: PathBuf,
    pub(crate) source_scope: CodexInventoryScope,
    pub(crate) owner_plugin_id: String,
}

#[derive(Debug, Clone)]
pub(crate) struct PluginMcpRoot {
    pub(crate) root: PathBuf,
    pub(crate) relative: PathBuf,
    pub(crate) source_scope: CodexInventoryScope,
    pub(crate) owner_plugin_id: String,
    pub(crate) owner_plugin_name: String,
}

#[derive(Debug, Clone)]
pub(crate) struct CodexPluginRecord {
    pub(crate) summary: CodexPluginSummary,
    pub(crate) skill_roots: Vec<PluginSkillRoot>,
    pub(crate) mcp_roots: Vec<PluginMcpRoot>,
}

#[derive(Debug, Clone)]
pub(crate) struct PluginInventory {
    pub(crate) view: CodexPluginList,
    pub(crate) records: Vec<CodexPluginRecord>,
    pub(crate) skill_roots: Vec<PluginSkillRoot>,
    pub(crate) mcp_roots: Vec<PluginMcpRoot>,
}

#[derive(Debug, Clone)]
struct PluginScanRoot {
    root: PathBuf,
    relative: PathBuf,
    scope: CodexInventoryScope,
    source: CodexPluginSource,
}

#[derive(Debug, Clone)]
struct PluginCandidate {
    scan_root: PluginScanRoot,
    relative: PathBuf,
}

#[derive(Debug, Clone)]
struct MarketplacePath {
    root: PathBuf,
    relative: PathBuf,
    scope: CodexInventoryScope,
}

pub(crate) fn discover(
    codex_home: &Path,
    scope: &CodexInventoryScope,
    context: Option<&crate::config::codex_context::ResolvedCodexProjectContext>,
) -> Result<PluginInventory, String> {
    if !codex_home.is_absolute() {
        return Err("codex plugins: resolved CODEX_HOME must be absolute".to_string());
    }
    let scan_roots = scan_roots(codex_home, scope, context)?;
    let mut diagnostics = Vec::new();
    let mut omitted_count = 0usize;
    let mut candidates = Vec::new();
    for scan_root in &scan_roots {
        walk_plugin_directories(
            scan_root,
            &scan_root.relative,
            0,
            &mut candidates,
            &mut diagnostics,
            &mut omitted_count,
        );
    }

    let mut records = Vec::new();
    let mut by_name = BTreeMap::new();
    for candidate in candidates {
        let Some(record) = parse_plugin_candidate(&candidate) else {
            continue;
        };
        insert_record(&mut records, &mut by_name, record);
        if records.len() >= MAX_INVENTORY_ITEMS {
            omitted_count = omitted_count.saturating_add(1);
            break;
        }
    }

    for marketplace in marketplace_paths(codex_home, scope, context, &mut diagnostics)? {
        parse_marketplace(
            &marketplace,
            &mut records,
            &mut by_name,
            &mut diagnostics,
            &mut omitted_count,
        );
    }

    diagnostics.truncate(MAX_DIAGNOSTICS);
    let mut skill_roots = Vec::new();
    let mut mcp_roots = Vec::new();
    for record in &records {
        skill_roots.extend(record.skill_roots.clone());
        mcp_roots.extend(record.mcp_roots.clone());
    }
    Ok(PluginInventory {
        view: CodexPluginList {
            items: records
                .iter()
                .map(|record| record.summary.clone())
                .collect(),
            summary: crate::types::codex_inventory::CodexInventorySummary {
                scope: scope.clone(),
                scan_limited: omitted_count > 0,
                omitted_count,
                diagnostics,
            },
        },
        records,
        skill_roots,
        mcp_roots,
    })
}

fn scan_roots(
    codex_home: &Path,
    scope: &CodexInventoryScope,
    context: Option<&crate::config::codex_context::ResolvedCodexProjectContext>,
) -> Result<Vec<PluginScanRoot>, String> {
    let mut roots = vec![
        PluginScanRoot {
            root: codex_home.to_path_buf(),
            relative: PathBuf::from("plugins/cache"),
            scope: CodexInventoryScope::Global,
            source: CodexPluginSource {
                kind: "installed".to_string(),
                label: "Codex plugin cache".to_string(),
            },
        },
        PluginScanRoot {
            root: codex_home.to_path_buf(),
            relative: PathBuf::from("plugins/marketplaces"),
            scope: CodexInventoryScope::Global,
            source: CodexPluginSource {
                kind: "installed".to_string(),
                label: "Codex local marketplaces".to_string(),
            },
        },
    ];
    if let CodexInventoryScope::Project { .. } = scope {
        let context = context.ok_or_else(|| {
            "codex plugins: project scope requires a validated project context".to_string()
        })?;
        let project_scope = scope.clone();
        roots.extend([
            PluginScanRoot {
                root: context.project_root.clone(),
                relative: PathBuf::from(".codex/plugins"),
                scope: project_scope.clone(),
                source: CodexPluginSource {
                    kind: "project".to_string(),
                    label: "Project Codex plugins".to_string(),
                },
            },
            PluginScanRoot {
                root: context.project_root.clone(),
                relative: PathBuf::from(".codex/marketplaces"),
                scope: project_scope,
                source: CodexPluginSource {
                    kind: "project".to_string(),
                    label: "Project Codex marketplaces".to_string(),
                },
            },
        ]);
    }
    Ok(roots)
}

fn walk_plugin_directories(
    scan_root: &PluginScanRoot,
    relative: &Path,
    depth: usize,
    candidates: &mut Vec<PluginCandidate>,
    diagnostics: &mut Vec<CodexInventoryDiagnostic>,
    omitted_count: &mut usize,
) {
    if depth > MAX_SCAN_DEPTH || candidates.len() >= MAX_INVENTORY_ITEMS {
        *omitted_count = omitted_count.saturating_add(1);
        return;
    }
    let Ok(directory) = confined_path(&scan_root.root, relative) else {
        return;
    };
    let Ok(metadata) = fs::symlink_metadata(&directory) else {
        return;
    };
    if !metadata.is_dir() || metadata.file_type().is_symlink() {
        return;
    }

    let manifest_relative = relative.join(".codex-plugin/plugin.json");
    let marker_relative = relative.join(".codex-plugin");
    let marker_present = fs::symlink_metadata(scan_root.root.join(&marker_relative))
        .map(|value| value.is_dir() && !value.file_type().is_symlink())
        .unwrap_or(false);
    let manifest_state =
        read_bounded_file(&scan_root.root.join(&manifest_relative), MAX_MANIFEST_BYTES);
    if manifest_state.is_ok()
        || manifest_state
            .as_ref()
            .is_err_and(|error| error.kind() != std::io::ErrorKind::NotFound)
        || marker_present
    {
        candidates.push(PluginCandidate {
            scan_root: scan_root.clone(),
            relative: relative.to_path_buf(),
        });
        return;
    }

    let mut children = Vec::new();
    let entries = match fs::read_dir(&directory) {
        Ok(entries) => entries,
        Err(_) => {
            diagnostics.push(scan_diagnostic(
                "unreadable-plugin-directory",
                "A Codex plugin directory could not be read",
                None,
            ));
            return;
        }
    };
    for entry in entries {
        match entry {
            Ok(entry) if entry.file_name().to_str().is_some() => children.push(entry),
            Ok(_) => diagnostics.push(scan_diagnostic(
                "invalid-plugin-name",
                "A Codex plugin directory name is not valid text",
                None,
            )),
            Err(_) => diagnostics.push(scan_diagnostic(
                "unreadable-plugin-entry",
                "A Codex plugin directory entry could not be read",
                None,
            )),
        }
    }
    children.sort_by_key(|entry| entry.file_name());
    for entry in children.into_iter().take(MAX_DIRECTORY_ENTRIES) {
        let child_relative = relative.join(entry.file_name());
        let child_metadata = match fs::symlink_metadata(scan_root.root.join(&child_relative)) {
            Ok(metadata) => metadata,
            Err(_) => continue,
        };
        if child_metadata.is_dir() && !child_metadata.file_type().is_symlink() {
            walk_plugin_directories(
                scan_root,
                &child_relative,
                depth + 1,
                candidates,
                diagnostics,
                omitted_count,
            );
        }
    }
    if fs::read_dir(&directory)
        .map(|entries| entries.count() > MAX_DIRECTORY_ENTRIES)
        .unwrap_or(false)
    {
        *omitted_count = omitted_count.saturating_add(1);
    }
}

fn parse_plugin_candidate(candidate: &PluginCandidate) -> Option<CodexPluginRecord> {
    let manifest_relative = candidate.relative.join(".codex-plugin/plugin.json");
    let package_root = candidate.scan_root.root.join(&candidate.relative);
    let fallback_name = candidate
        .relative
        .file_name()
        .and_then(|name| name.to_str())
        .and_then(safe_plugin_name)
        .unwrap_or_else(|| "plugin".to_string());
    let fallback_id = plugin_id(
        &candidate.scan_root.scope,
        &candidate.relative,
        &fallback_name,
    );
    let base_source = candidate.scan_root.source.clone();
    let bytes = match read_bounded_file(
        &candidate.scan_root.root.join(&manifest_relative),
        MAX_MANIFEST_BYTES,
    ) {
        Ok(value) => value,
        Err(_) => {
            return Some(invalid_record(
                fallback_id,
                fallback_name,
                base_source,
                "invalid-manifest",
                "The Codex plugin manifest is missing or unreadable",
            ));
        }
    };
    let value: Value = match serde_json::from_str(&bytes.text) {
        Ok(value) => value,
        Err(_) => {
            return Some(invalid_record(
                fallback_id,
                fallback_name,
                base_source,
                "malformed-manifest",
                "The Codex plugin manifest is malformed",
            ));
        }
    };
    let Some(object) = value.as_object() else {
        return Some(invalid_record(
            fallback_id,
            fallback_name,
            base_source,
            "invalid-manifest",
            "The Codex plugin manifest must be an object",
        ));
    };

    let mut local_diagnostics = Vec::new();
    report_unknown_fields(object, &mut local_diagnostics);
    let name = object
        .get("name")
        .and_then(Value::as_str)
        .and_then(safe_plugin_name)
        .unwrap_or(fallback_name);
    let owner_plugin_name = name.clone();
    if object.get("name").is_some()
        && object
            .get("name")
            .and_then(Value::as_str)
            .and_then(safe_plugin_name)
            .is_none()
    {
        local_diagnostics.push(simple_diagnostic(
            "invalid-plugin-name",
            "The Codex plugin name is invalid",
        ));
    }
    let id = object
        .get("id")
        .and_then(Value::as_str)
        .and_then(safe_plugin_name)
        .map(|value| plugin_id(&candidate.scan_root.scope, &candidate.relative, &value))
        .unwrap_or(fallback_id);
    let display_name = safe_text_field(object, "display_name", MAX_PLUGIN_NAME_BYTES);
    let description =
        safe_text_field(object, "description", MAX_DESCRIPTION_BYTES).unwrap_or_default();
    let version = safe_text_field(object, "version", MAX_PLUGIN_NAME_BYTES);
    let mut skill_roots = Vec::new();
    let mut mcp_roots = Vec::new();
    let mut capabilities = Vec::new();

    let skill_paths = capability_paths(object, "skills", &mut local_diagnostics);
    for path in skill_paths {
        add_skill_component(
            &candidate.scan_root,
            &candidate.relative,
            &package_root,
            &id,
            &path,
            &mut skill_roots,
            &mut capabilities,
            &mut local_diagnostics,
        );
    }
    let mcp_paths = capability_paths(object, "mcpServers", &mut local_diagnostics);
    for path in mcp_paths {
        add_file_component(
            &candidate.scan_root,
            &candidate.relative,
            &package_root,
            &id,
            &owner_plugin_name,
            &path,
            CodexPluginCapabilityKind::McpServer,
            &mut mcp_roots,
            &mut capabilities,
            &mut local_diagnostics,
        );
    }
    for (field, kind) in [
        ("apps", CodexPluginCapabilityKind::App),
        ("hooks", CodexPluginCapabilityKind::Hook),
    ] {
        let mut ignored_roots = Vec::new();
        for path in capability_paths(object, field, &mut local_diagnostics) {
            add_file_component(
                &candidate.scan_root,
                &candidate.relative,
                &package_root,
                &id,
                &owner_plugin_name,
                &path,
                kind,
                &mut ignored_roots,
                &mut capabilities,
                &mut local_diagnostics,
            );
        }
    }
    capabilities.truncate(MAX_CAPABILITIES);

    let mut plugin_diagnostics = local_diagnostics
        .into_iter()
        .map(|diagnostic| with_source(diagnostic, &id))
        .collect::<Vec<_>>();
    plugin_diagnostics.push(with_source(
        simple_diagnostic(
            "plugin-state-unknown",
            "Plugin enablement is not exposed because its config key is not verified",
        ),
        &id,
    ));
    let summary = CodexPluginSummary {
        id: id.clone(),
        name,
        display_name,
        description,
        version,
        state: CodexPluginState::Installed,
        enabled_state: CodexEnabledState::Unknown,
        source: base_source,
        capabilities,
        diagnostics: plugin_diagnostics,
    };
    Some(CodexPluginRecord {
        summary,
        skill_roots,
        mcp_roots,
    })
}

fn add_skill_component(
    scan_root: &PluginScanRoot,
    package_relative: &Path,
    package_root: &Path,
    owner_plugin_id: &str,
    relative_text: &str,
    skill_roots: &mut Vec<PluginSkillRoot>,
    capabilities: &mut Vec<CodexPluginCapability>,
    diagnostics: &mut Vec<CodexInventoryDiagnostic>,
) {
    let Some(relative) = safe_relative_path(relative_text) else {
        diagnostics.push(simple_diagnostic(
            "unsafe-capability-path",
            "A plugin capability path was rejected",
        ));
        return;
    };
    let Ok(directory) = confined_path(package_root, &relative) else {
        diagnostics.push(simple_diagnostic(
            "unavailable-capability",
            "A plugin skill directory is unavailable",
        ));
        return;
    };
    if !fs::metadata(&directory)
        .map(|metadata| metadata.is_dir())
        .unwrap_or(false)
    {
        diagnostics.push(simple_diagnostic(
            "invalid-capability",
            "A plugin skill capability must point to a directory",
        ));
        return;
    }
    let root_relative = package_relative.join(&relative);
    skill_roots.push(PluginSkillRoot {
        root: scan_root.root.clone(),
        relative: root_relative.clone(),
        source_scope: scan_root.scope.clone(),
        owner_plugin_id: owner_plugin_id.to_string(),
    });
    let mut children = match fs::read_dir(&directory) {
        Ok(entries) => entries
            .flatten()
            .filter(|entry| {
                fs::symlink_metadata(entry.path())
                    .map(|metadata| metadata.is_dir() && !metadata.file_type().is_symlink())
                    .unwrap_or(false)
            })
            .collect::<Vec<_>>(),
        Err(_) => Vec::new(),
    };
    children.sort_by_key(|entry| entry.file_name());
    if children.is_empty() {
        capabilities.push(capability(
            CodexPluginCapabilityKind::Skill,
            relative
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or("skills"),
            owner_plugin_id,
            None,
        ));
        return;
    }
    for child in children.into_iter().take(MAX_CAPABILITIES) {
        let Some(name) = child.file_name().to_str().map(str::to_string) else {
            continue;
        };
        let skill_relative = root_relative.join(&name);
        let identity = source_identity(
            &scan_root.scope,
            CodexRecordKind::Skill,
            &path_string(&skill_relative),
        );
        capabilities.push(capability(
            CodexPluginCapabilityKind::Skill,
            &name,
            owner_plugin_id,
            Some(identity.id),
        ));
    }
}

fn add_file_component(
    scan_root: &PluginScanRoot,
    package_relative: &Path,
    package_root: &Path,
    owner_plugin_id: &str,
    owner_plugin_name: &str,
    relative_text: &str,
    kind: CodexPluginCapabilityKind,
    mcp_roots: &mut Vec<PluginMcpRoot>,
    capabilities: &mut Vec<CodexPluginCapability>,
    diagnostics: &mut Vec<CodexInventoryDiagnostic>,
) {
    let Some(relative) = safe_relative_path(relative_text) else {
        diagnostics.push(simple_diagnostic(
            "unsafe-capability-path",
            "A plugin capability path was rejected",
        ));
        return;
    };
    let Ok(file) = confined_path(package_root, &relative) else {
        diagnostics.push(simple_diagnostic(
            "unavailable-capability",
            "A plugin capability target is unavailable",
        ));
        return;
    };
    let valid_target = fs::metadata(&file)
        .map(|metadata| {
            metadata.is_file()
                || (kind != CodexPluginCapabilityKind::McpServer && metadata.is_dir())
        })
        .unwrap_or(false);
    if !valid_target {
        diagnostics.push(simple_diagnostic(
            "invalid-capability",
            "A plugin file capability must point to a regular file",
        ));
        return;
    }
    let name = relative
        .file_stem()
        .or_else(|| relative.file_name())
        .and_then(|name| name.to_str())
        .unwrap_or("capability");
    if kind == CodexPluginCapabilityKind::McpServer {
        mcp_roots.push(PluginMcpRoot {
            root: scan_root.root.clone(),
            relative: package_relative.join(&relative),
            source_scope: scan_root.scope.clone(),
            owner_plugin_id: owner_plugin_id.to_string(),
            owner_plugin_name: owner_plugin_name.to_string(),
        });
    }
    capabilities.push(capability(kind, name, owner_plugin_id, None));
}

fn capability(
    kind: CodexPluginCapabilityKind,
    name: &str,
    owner_plugin_id: &str,
    linked_record_id: Option<String>,
) -> CodexPluginCapability {
    CodexPluginCapability {
        kind,
        name: bounded_display(name, MAX_PLUGIN_NAME_BYTES),
        owner_plugin_id: owner_plugin_id.to_string(),
        linked_record_id,
    }
}

fn capability_paths(
    object: &Map<String, Value>,
    field: &str,
    diagnostics: &mut Vec<CodexInventoryDiagnostic>,
) -> Vec<String> {
    let Some(value) = object.get(field) else {
        return Vec::new();
    };
    if let Some(value) = value.as_str() {
        return vec![value.to_string()];
    }
    if let Some(values) = value.as_array() {
        return values
            .iter()
            .filter_map(|value| match value.as_str() {
                Some(value) => Some(value.to_string()),
                None => {
                    diagnostics.push(simple_diagnostic(
                        "invalid-capability",
                        "A plugin capability list contains a non-text entry",
                    ));
                    None
                }
            })
            .collect();
    }
    diagnostics.push(simple_diagnostic(
        "invalid-capability",
        "A plugin capability field has an unsupported shape",
    ));
    Vec::new()
}

fn marketplace_paths(
    codex_home: &Path,
    scope: &CodexInventoryScope,
    context: Option<&crate::config::codex_context::ResolvedCodexProjectContext>,
    diagnostics: &mut Vec<CodexInventoryDiagnostic>,
) -> Result<Vec<MarketplacePath>, String> {
    let mut paths = vec![MarketplacePath {
        root: codex_home.to_path_buf(),
        relative: PathBuf::from("plugins/known_marketplaces.json"),
        scope: CodexInventoryScope::Global,
    }];
    let marketplace_roots = vec![(
        codex_home.to_path_buf(),
        PathBuf::from("plugins/marketplaces"),
        CodexInventoryScope::Global,
    )];
    let mut roots = marketplace_roots;
    if let CodexInventoryScope::Project { .. } = scope {
        let context = context.ok_or_else(|| {
            "codex plugins: project scope requires a validated project context".to_string()
        })?;
        roots.push((
            context.project_root.clone(),
            PathBuf::from(".codex/marketplaces"),
            scope.clone(),
        ));
    }
    for (root, relative, marketplace_scope) in roots {
        let Ok(directory) = confined_path(&root, &relative) else {
            continue;
        };
        let entries = match fs::read_dir(&directory) {
            Ok(entries) => entries,
            Err(_) => continue,
        };
        let mut names = Vec::new();
        for entry in entries {
            let Ok(entry) = entry else {
                diagnostics.push(scan_diagnostic(
                    "unreadable-marketplace-entry",
                    "A local marketplace entry could not be read",
                    None,
                ));
                continue;
            };
            names.push(entry.file_name());
        }
        names.sort();
        for name in names.into_iter().take(MAX_DIRECTORY_ENTRIES) {
            let Some(name) = name.to_str() else {
                continue;
            };
            let candidate = relative.join(name).join(".codex-plugin/marketplace.json");
            if confined_path(&root, &candidate).is_ok() {
                paths.push(MarketplacePath {
                    root: root.clone(),
                    relative: candidate,
                    scope: marketplace_scope.clone(),
                });
            }
        }
    }
    Ok(paths)
}

fn parse_marketplace(
    marketplace: &MarketplacePath,
    records: &mut Vec<CodexPluginRecord>,
    by_name: &mut BTreeMap<String, usize>,
    diagnostics: &mut Vec<CodexInventoryDiagnostic>,
    omitted_count: &mut usize,
) {
    let path = marketplace.root.join(&marketplace.relative);
    let bytes = match read_bounded_file(&path, MAX_MARKETPLACE_BYTES) {
        Ok(value) => value,
        Err(_) => return,
    };
    let value: Value = match serde_json::from_str(&bytes.text) {
        Ok(value) => value,
        Err(_) => {
            diagnostics.push(scan_diagnostic(
                "malformed-marketplace",
                "A local Codex marketplace catalog is malformed",
                None,
            ));
            return;
        }
    };
    let Some(object) = value.as_object() else {
        diagnostics.push(scan_diagnostic(
            "invalid-marketplace",
            "A local Codex marketplace catalog must be an object",
            None,
        ));
        return;
    };
    let Some(entries) = object.get("plugins").and_then(Value::as_array) else {
        return;
    };
    for entry in entries.iter().take(MAX_MARKETPLACE_ENTRIES) {
        let Some(entry) = entry.as_object() else {
            diagnostics.push(scan_diagnostic(
                "invalid-marketplace-entry",
                "A marketplace plugin entry must be an object",
                None,
            ));
            continue;
        };
        let Some(name) = entry
            .get("name")
            .and_then(Value::as_str)
            .and_then(safe_plugin_name)
        else {
            diagnostics.push(scan_diagnostic(
                "invalid-marketplace-entry",
                "A marketplace plugin entry has no valid name",
                None,
            ));
            continue;
        };
        let mut plugin_diagnostics = Vec::new();
        if let Some(source) = entry.get("source").and_then(Value::as_str) {
            if let Some(relative) = safe_relative_path(source) {
                if confined_path(
                    &marketplace.root,
                    &marketplace
                        .relative
                        .parent()
                        .unwrap_or(Path::new(""))
                        .join(relative),
                )
                .is_err()
                {
                    plugin_diagnostics.push(simple_diagnostic(
                        "unavailable-marketplace-source",
                        "The marketplace source is unavailable within its local root",
                    ));
                }
            } else {
                plugin_diagnostics.push(simple_diagnostic(
                    "unsafe-marketplace-source",
                    "The marketplace source path was rejected",
                ));
            }
        }
        let id = plugin_id(&marketplace.scope, &marketplace.relative, &name);
        let summary = CodexPluginSummary {
            id,
            name: name.clone(),
            display_name: safe_text_field(entry, "display_name", MAX_PLUGIN_NAME_BYTES),
            description: safe_text_field(entry, "description", MAX_DESCRIPTION_BYTES)
                .unwrap_or_default(),
            version: safe_text_field(entry, "version", MAX_PLUGIN_NAME_BYTES),
            state: if plugin_diagnostics.is_empty() {
                CodexPluginState::Available
            } else {
                CodexPluginState::Invalid
            },
            enabled_state: CodexEnabledState::Unknown,
            source: CodexPluginSource {
                kind: "marketplace".to_string(),
                label: "Codex marketplace metadata".to_string(),
            },
            capabilities: Vec::new(),
            diagnostics: plugin_diagnostics
                .into_iter()
                .map(|diagnostic| with_source(diagnostic, "marketplace"))
                .collect(),
        };
        insert_record(
            records,
            by_name,
            CodexPluginRecord {
                summary,
                skill_roots: Vec::new(),
                mcp_roots: Vec::new(),
            },
        );
        if records.len() >= MAX_INVENTORY_ITEMS {
            *omitted_count = omitted_count.saturating_add(1);
            return;
        }
    }
}

fn insert_record(
    records: &mut Vec<CodexPluginRecord>,
    by_name: &mut BTreeMap<String, usize>,
    record: CodexPluginRecord,
) {
    let name = record.summary.name.clone();
    if let Some(index) = by_name.get(&name).copied() {
        records[index].summary.diagnostics.push(simple_diagnostic(
            "duplicate-plugin",
            "Another local Codex source declared the same plugin name",
        ));
        return;
    }
    by_name.insert(name, records.len());
    records.push(record);
}

fn invalid_record(
    id: String,
    name: String,
    source: CodexPluginSource,
    code: &str,
    message: &str,
) -> CodexPluginRecord {
    CodexPluginRecord {
        summary: CodexPluginSummary {
            id,
            name,
            display_name: None,
            description: String::new(),
            version: None,
            state: CodexPluginState::Invalid,
            enabled_state: CodexEnabledState::Unknown,
            source,
            capabilities: Vec::new(),
            diagnostics: vec![simple_diagnostic(code, message)],
        },
        skill_roots: Vec::new(),
        mcp_roots: Vec::new(),
    }
}

fn report_unknown_fields(
    object: &Map<String, Value>,
    diagnostics: &mut Vec<CodexInventoryDiagnostic>,
) {
    const ALLOWED: [&str; 8] = [
        "id",
        "name",
        "display_name",
        "description",
        "version",
        "skills",
        "mcpServers",
        "apps",
    ];
    for key in object.keys() {
        if key != "hooks" && !ALLOWED.contains(&key.as_str()) {
            diagnostics.push(simple_diagnostic(
                "unsupported-manifest-field",
                "The plugin manifest contains an unsupported field",
            ));
        }
    }
}

fn safe_text_field(object: &Map<String, Value>, key: &str, max_bytes: usize) -> Option<String> {
    let value = object.get(key)?.as_str()?;
    if value.is_empty() || value.len() > max_bytes || looks_sensitive(value) {
        return None;
    }
    Some(bounded_display(value, max_bytes))
}

fn safe_plugin_name(value: &str) -> Option<String> {
    if value.is_empty()
        || value.len() > MAX_PLUGIN_NAME_BYTES
        || looks_sensitive(value)
        || value.contains("..")
        || !value.chars().all(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | '.' | '@' | '/')
        })
    {
        return None;
    }
    Some(value.to_string())
}

fn safe_relative_path(value: &str) -> Option<PathBuf> {
    let path = Path::new(value);
    if value.is_empty() || path.is_absolute() || validate_relative_path(path).is_err() {
        return None;
    }
    Some(path.to_path_buf())
}

fn looks_sensitive(value: &str) -> bool {
    let lower = value.to_ascii_lowercase();
    [
        "token",
        "secret",
        "password",
        "api_key",
        "apikey",
        "bearer ",
        "private_key",
        "http://",
        "https://",
        "file://",
    ]
    .iter()
    .any(|marker| lower.contains(marker))
}

fn plugin_id(scope: &CodexInventoryScope, relative: &Path, name: &str) -> String {
    let scope_key = match scope {
        CodexInventoryScope::Global => "global".to_string(),
        CodexInventoryScope::Project { project_id } => format!("project:{project_id}"),
    };
    let mut hasher = Sha256::new();
    hasher.update(b"codex-plugin-v1\0");
    hasher.update(scope_key.as_bytes());
    hasher.update(b"\0");
    hasher.update(path_string(relative).as_bytes());
    hasher.update(b"\0");
    hasher.update(name.as_bytes());
    format!("cdx-plugin-{:x}", hasher.finalize())
}

fn path_string(path: &Path) -> String {
    path.components()
        .filter_map(|component| match component {
            std::path::Component::Normal(value) => Some(value.to_string_lossy().into_owned()),
            _ => None,
        })
        .collect::<Vec<_>>()
        .join("/")
}

fn with_source(
    mut diagnostic: CodexInventoryDiagnostic,
    source_id: &str,
) -> CodexInventoryDiagnostic {
    diagnostic.source_id = Some(source_id.to_string());
    diagnostic
}

fn simple_diagnostic(code: &str, message: &str) -> CodexInventoryDiagnostic {
    CodexInventoryDiagnostic {
        severity: "warning".to_string(),
        code: code.to_string(),
        message: message.to_string(),
        source_id: None,
        relative_path: None,
    }
}

fn scan_diagnostic(
    code: &str,
    message: &str,
    relative_path: Option<&Path>,
) -> CodexInventoryDiagnostic {
    CodexInventoryDiagnostic {
        severity: "warning".to_string(),
        code: code.to_string(),
        message: message.to_string(),
        source_id: None,
        relative_path: relative_path.map(path_string),
    }
}

#[cfg(test)]
#[path = "codex_plugins_tests.rs"]
mod tests;
