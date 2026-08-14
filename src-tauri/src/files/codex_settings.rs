//! Bounded, renderer-safe discovery of Codex TOML configuration.
//!
//! This module deliberately models only the small set of settings that the
//! application can explain and, later, safely edit. It never returns raw TOML
//! or unknown values. Each read parses fresh bytes into `DocumentMut`; no TOML
//! document is retained between calls.

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value as JsonValue};
use sha2::{Digest, Sha256};
use toml_edit::{DocumentMut, Item, Value};

use crate::config::root;

const MAX_SOURCE_BYTES: u64 = 256 * 1024;
const MAX_SOURCE_COUNT: usize = 64;
const MAX_PROFILE_NAME_BYTES: usize = 64;
const MAX_SAFE_TEXT_BYTES: usize = 256;
const MAX_STRUCTURED_DEPTH: usize = 5;

const SUPPORTED_KEYS: [&str; 4] = [
    "model",
    "approval_policy",
    "sandbox_mode",
    "default_permissions",
];
const PROVENANCE_KEYS: [&str; 2] = ["features", "profiles"];

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexSettingsContext {
    pub project_root: String,
    pub working_directory: Option<String>,
    pub profile: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexSettingsView {
    pub context: CodexSettingsContextView,
    pub trust: CodexTrustStatus,
    pub settings: Vec<CodexResolvedSetting>,
    pub sources: Vec<CodexSettingsSource>,
    pub provenance: Vec<CodexProvenanceRow>,
    pub diagnostics: Vec<CodexDiagnostic>,
    pub policy: CodexPolicyStatus,
    pub user_revision: String,
    pub target: String,
    pub can_edit: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexSettingsContextView {
    pub project_root: String,
    pub working_directory: String,
    pub profile: Option<String>,
    pub profile_is_projection: bool,
    pub cli_overrides_available: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexTrustStatus {
    pub state: String,
    pub source_label: String,
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexSettingsSource {
    pub id: String,
    pub label: String,
    pub kind: String,
    pub status: String,
    pub active: bool,
    pub precedence: usize,
    pub revision: Option<String>,
    pub supported_keys: Vec<String>,
    pub values: Vec<CodexSourceValue>,
    pub diagnostics: Vec<CodexDiagnostic>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexSourceValue {
    pub key: String,
    pub value: CodexSettingValue,
    pub editable: bool,
    pub read_only_reason: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexResolvedSetting {
    pub key: String,
    pub value: CodexSettingValue,
    pub source_id: String,
    pub source_label: String,
    pub editable: bool,
    pub read_only_reason: Option<String>,
    pub user_value: Option<CodexSettingValue>,
    pub shadowed: Vec<CodexShadowedValue>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexShadowedValue {
    pub source_id: String,
    pub source_label: String,
    pub value: CodexSettingValue,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexSettingValue {
    pub kind: String,
    pub scalar: Option<String>,
    pub display: String,
    pub structured: Option<JsonValue>,
    pub redacted: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexProvenanceRow {
    pub key: String,
    pub source_id: String,
    pub source_label: String,
    pub note: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexDiagnostic {
    pub source_id: String,
    pub severity: String,
    pub code: String,
    pub message: String,
    pub line: Option<usize>,
    pub column: Option<usize>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexPolicyStatus {
    pub local_requirements_available: bool,
    pub cloud_requirements_available: bool,
    pub resolution: String,
    pub constraints: Vec<CodexPolicyConstraint>,
    pub diagnostics: Vec<CodexDiagnostic>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexPolicyConstraint {
    pub key: String,
    pub value: CodexSettingValue,
    pub source_label: String,
}

#[derive(Debug, Clone)]
struct NormalizedContext {
    project_root: PathBuf,
    working_directory: PathBuf,
    profile: Option<String>,
}

#[derive(Debug, Clone)]
struct RawDefinition {
    key: String,
    value: CodexSettingValue,
}

#[derive(Debug, Clone)]
struct SourceRecord {
    source: CodexSettingsSource,
    definitions: BTreeMap<String, RawDefinition>,
    provenance_keys: Vec<String>,
    trust_state: TrustState,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum TrustState {
    Trusted,
    Untrusted,
    Missing,
    Invalid,
}

#[derive(Debug, Clone)]
struct ParsedDocument {
    definitions: BTreeMap<String, RawDefinition>,
    provenance_keys: Vec<String>,
    trust_state: Option<TrustState>,
    diagnostics: Vec<LocalDiagnostic>,
}

#[derive(Debug, Clone)]
struct LocalDiagnostic {
    severity: &'static str,
    code: &'static str,
    message: &'static str,
}

#[derive(Debug, Clone)]
struct FileRead {
    status: &'static str,
    revision: Option<String>,
    bytes: Option<Vec<u8>>,
    error: Option<&'static str>,
}

/// Discover Codex configuration using the process's configured `$CODEX_HOME`.
pub fn discover(context: &CodexSettingsContext) -> Result<CodexSettingsView, String> {
    let codex_home = root::codex_dir()?;
    discover_at(&codex_home, context, Some(Path::new("/etc/codex")))
}

/// Test seam for deterministic fixtures. `codex_home` and `system_root` are
/// supplied by the caller; production uses only `root::codex_dir()` above.
pub fn discover_at(
    codex_home: &Path,
    context: &CodexSettingsContext,
    system_root: Option<&Path>,
) -> Result<CodexSettingsView, String> {
    let context = normalize_context(context)?;
    if !codex_home.is_absolute() {
        return Err("codex settings: resolved CODEX_HOME must be absolute".to_string());
    }

    let user_path = codex_home.join("config.toml");
    let user = inspect_source(
        "user",
        "User config (~/.codex/config.toml)",
        "user",
        &user_path,
        true,
        5,
        Some(context.project_root.to_string_lossy().as_ref()),
    );
    let trust = trust_status(user_trust_state(&user), &user.source.status);

    let project_paths = project_layer_paths(&context.project_root, &context.working_directory);
    if project_paths.len() > MAX_SOURCE_COUNT {
        return Err("codex settings: project configuration chain is too deep".to_string());
    }
    let project_records: Vec<SourceRecord> = project_paths
        .iter()
        .enumerate()
        .map(|(index, path)| {
            let label = if index == 0 {
                "Project layer 1 (root)".to_string()
            } else {
                format!("Project layer {} (nested)", index + 1)
            };
            let active = trust.state == "trusted";
            let mut record = inspect_source(
                &format!("project-{index}"),
                &label,
                "project",
                path,
                active,
                index,
                None,
            );
            if !active {
                record.source.status = if trust.state == "untrusted" {
                    "inactive-untrusted".to_string()
                } else {
                    "inactive-unverified".to_string()
                };
                record.source.values.clear();
                record.definitions.clear();
            }
            record
        })
        .collect();

    let profile = context.profile.as_deref().map(|name| {
        inspect_source(
            "profile",
            &format!("Selected profile ({name})"),
            "profile",
            &codex_home.join(format!("{name}.config.toml")),
            true,
            3,
            None,
        )
    });

    let system = system_root.map(|system_root| {
        inspect_source(
            "system",
            "System config",
            "system",
            &system_root.join("config.toml"),
            true,
            6,
            None,
        )
    });

    let requirements = system_root.map(|system_root| {
        inspect_source(
            "managed-requirements",
            "Managed requirements (local)",
            "managedPolicy",
            &system_root.join("requirements.toml"),
            true,
            1,
            None,
        )
    });

    let cli = unavailable_source(
        "cli",
        "CLI overrides (unavailable)",
        "cli",
        0,
        "CLI flags from a running Codex process are not observable here",
    );
    let default = default_source();

    let mut display_records = Vec::new();
    display_records.push(cli.clone());
    display_records.extend(project_records.iter().cloned());
    if let Some(profile) = profile.clone() {
        display_records.push(profile);
    } else {
        display_records.push(unavailable_source(
            "profile",
            "Selected profile (none)",
            "profile",
            3,
            "No profile was selected for this inspection",
        ));
    }
    display_records.push(user.clone());
    if let Some(system) = system.clone() {
        display_records.push(system);
    } else {
        display_records.push(unavailable_source(
            "system",
            "System config (unavailable)",
            "system",
            6,
            "System configuration is unavailable on this platform",
        ));
    }
    if let Some(requirements) = requirements.clone() {
        display_records.push(requirements);
    } else {
        display_records.push(unavailable_source(
            "managed-requirements",
            "Managed requirements (unavailable)",
            "managedPolicy",
            1,
            "Local managed requirements are unavailable on this platform",
        ));
    }
    display_records.push(default.clone());

    // Effective precedence is high-to-low. The project layer closest to the
    // working directory is considered before its parents.
    let mut precedence_records = Vec::new();
    precedence_records.push(cli);
    precedence_records.extend(project_records.iter().rev().cloned());
    if let Some(profile) = profile {
        precedence_records.push(profile);
    }
    precedence_records.push(user.clone());
    if let Some(system) = system {
        precedence_records.push(system);
    }
    precedence_records.push(default);

    let mut settings = Vec::new();
    let mut winners: BTreeMap<String, (RawDefinition, String, String, bool)> = BTreeMap::new();
    let mut shadowed: BTreeMap<String, Vec<CodexShadowedValue>> = BTreeMap::new();
    for record in &precedence_records {
        if !record.source.active {
            continue;
        }
        for definition in record.definitions.values() {
            if winners.contains_key(&definition.key) {
                shadowed
                    .entry(definition.key.clone())
                    .or_default()
                    .push(CodexShadowedValue {
                        source_id: record.source.id.clone(),
                        source_label: record.source.label.clone(),
                        value: definition.value.clone(),
                    });
            } else {
                winners.insert(
                    definition.key.clone(),
                    (
                        definition.clone(),
                        record.source.id.clone(),
                        record.source.label.clone(),
                        record.source.kind == "user",
                    ),
                );
            }
        }
    }

    let user_values: BTreeMap<String, CodexSettingValue> = user
        .definitions
        .values()
        .map(|definition| (definition.key.clone(), definition.value.clone()))
        .collect();
    let has_default_permissions = winners.contains_key("default_permissions");
    for key in SUPPORTED_KEYS {
        let Some((definition, source_id, source_label, source_is_user)) = winners.get(key) else {
            continue;
        };
        let mut editable = *source_is_user && is_user_editable(definition, true, "user");
        let mut read_only_reason = if key == "default_permissions" {
            Some("Permission profiles are read-only in this sprint".to_string())
        } else if definition.value.kind == "approvalGranular" {
            Some("Granular approval rules are read-only in this sprint".to_string())
        } else if !source_is_user {
            Some("A higher-priority read-only source owns this value".to_string())
        } else {
            None
        };
        if key == "sandbox_mode" && definition.value.scalar.as_deref() == Some("danger-full-access")
        {
            editable = false;
            read_only_reason = Some(
                "danger-full-access requires an explicit safety decision and is read-only here"
                    .to_string(),
            );
        }
        if has_default_permissions && (key == "sandbox_mode" || key == "approval_policy") {
            editable = false;
            read_only_reason = Some(
                "default_permissions is present; edit safety settings only in a later policy-aware sprint"
                    .to_string(),
            );
        }
        settings.push(CodexResolvedSetting {
            key: key.to_string(),
            value: definition.value.clone(),
            source_id: source_id.clone(),
            source_label: source_label.clone(),
            editable,
            read_only_reason,
            user_value: user_values.get(key).cloned(),
            shadowed: shadowed.remove(key).unwrap_or_default(),
        });
    }

    let mut diagnostics = Vec::new();
    for record in &display_records {
        diagnostics.extend(record.source.diagnostics.clone());
    }
    let (policy, policy_diagnostics) = build_policy(requirements.as_ref(), &settings);
    diagnostics.extend(policy_diagnostics);

    let mut provenance = Vec::new();
    for record in &display_records {
        for key in &record.provenance_keys {
            provenance.push(CodexProvenanceRow {
                key: key.clone(),
                source_id: record.source.id.clone(),
                source_label: record.source.label.clone(),
                note: "Present in this source; raw feature/profile values are intentionally not exposed"
                    .to_string(),
            });
        }
    }

    Ok(CodexSettingsView {
        context: CodexSettingsContextView {
            project_root: context.project_root.to_string_lossy().into_owned(),
            working_directory: context.working_directory.to_string_lossy().into_owned(),
            profile: context.profile,
            profile_is_projection: true,
            cli_overrides_available: false,
        },
        trust,
        settings,
        sources: display_records
            .into_iter()
            .map(|record| record.source)
            .collect(),
        provenance,
        diagnostics,
        policy,
        user_revision: user
            .source
            .revision
            .unwrap_or_else(|| "missing".to_string()),
        target: "user config (~/.codex/config.toml)".to_string(),
        can_edit: true,
    })
}

fn normalize_context(context: &CodexSettingsContext) -> Result<NormalizedContext, String> {
    let project_root = validate_directory(&context.project_root, "project root")?;
    let working_directory = match context.working_directory.as_deref() {
        None => project_root.clone(),
        Some(value) if value.trim().is_empty() => {
            return Err("codex settings: working directory must not be empty".to_string());
        }
        Some(value) => validate_directory(value, "working directory")?,
    };
    if !working_directory.starts_with(&project_root) {
        return Err(
            "codex settings: working directory must be inside the selected project root"
                .to_string(),
        );
    }
    let profile = context
        .profile
        .as_deref()
        .map(validate_profile_name)
        .transpose()?;
    Ok(NormalizedContext {
        project_root,
        working_directory,
        profile,
    })
}

fn validate_directory(value: &str, label: &str) -> Result<PathBuf, String> {
    let path = Path::new(value.trim());
    if !path.is_absolute() {
        return Err(format!("codex settings: {label} must be an absolute path"));
    }
    let canonical = fs::canonicalize(path)
        .map_err(|_| format!("codex settings: {label} must be an existing directory"))?;
    if !fs::metadata(&canonical)
        .map(|metadata| metadata.is_dir())
        .unwrap_or(false)
    {
        return Err(format!(
            "codex settings: {label} must be an existing directory"
        ));
    }
    Ok(canonical)
}

fn validate_profile_name(value: &str) -> Result<String, String> {
    if value.is_empty()
        || value.len() > MAX_PROFILE_NAME_BYTES
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
    {
        return Err(
            "codex settings: profile must contain only letters, numbers, '-' or '_'".to_string(),
        );
    }
    Ok(value.to_string())
}

fn project_layer_paths(project_root: &Path, working_directory: &Path) -> Vec<PathBuf> {
    let relative = working_directory
        .strip_prefix(project_root)
        .unwrap_or(Path::new(""));
    let mut paths = Vec::new();
    let mut current = project_root.to_path_buf();
    paths.push(current.join(".codex/config.toml"));
    for component in relative.components() {
        current.push(component.as_os_str());
        paths.push(current.join(".codex/config.toml"));
    }
    paths
}

fn inspect_source(
    id: &str,
    label: &str,
    kind: &str,
    path: &Path,
    active: bool,
    precedence: usize,
    trust_project: Option<&str>,
) -> SourceRecord {
    let read = read_bounded_file(path);
    let mut diagnostics = Vec::new();
    let mut definitions = BTreeMap::new();
    let mut provenance_keys = Vec::new();
    let mut trust_state = TrustState::Missing;
    let status = if let Some(error) = read.error {
        diagnostics.push(CodexDiagnostic {
            source_id: id.to_string(),
            severity: "warning".to_string(),
            code: error.to_string(),
            message: source_error_message(error).to_string(),
            line: None,
            column: None,
        });
        read.status.to_string()
    } else if let Some(bytes) = read.bytes.as_deref() {
        match parse_document(bytes, trust_project) {
            Ok(parsed) => {
                definitions = parsed.definitions;
                provenance_keys = parsed.provenance_keys;
                trust_state = parsed.trust_state.unwrap_or(TrustState::Missing);
                diagnostics.extend(parsed.diagnostics.into_iter().map(|diagnostic| {
                    CodexDiagnostic {
                        source_id: id.to_string(),
                        severity: diagnostic.severity.to_string(),
                        code: diagnostic.code.to_string(),
                        message: diagnostic.message.to_string(),
                        line: None,
                        column: None,
                    }
                }));
                "available".to_string()
            }
            Err(diagnostic) => {
                diagnostics.push(CodexDiagnostic {
                    source_id: id.to_string(),
                    severity: "error".to_string(),
                    code: "invalid-toml".to_string(),
                    message: diagnostic.to_string(),
                    line: Some(1),
                    column: Some(1),
                });
                "invalid".to_string()
            }
        }
    } else {
        read.status.to_string()
    };

    let source_values = definitions
        .values()
        .map(|definition| {
            let editable = is_user_editable(definition, active, kind);
            CodexSourceValue {
                key: definition.key.clone(),
                value: definition.value.clone(),
                editable,
                read_only_reason: if editable {
                    None
                } else if kind == "user" && active {
                    Some("This setting value is read-only in the safe editor".to_string())
                } else {
                    Some("This source is read-only in the settings editor".to_string())
                },
            }
        })
        .collect();
    let mut supported_keys: Vec<String> = definitions.keys().cloned().collect();
    supported_keys.extend(provenance_keys.iter().cloned());
    supported_keys.sort();
    supported_keys.dedup();
    let diagnostics_for_source = diagnostics.clone();
    SourceRecord {
        source: CodexSettingsSource {
            id: id.to_string(),
            label: label.to_string(),
            kind: kind.to_string(),
            status,
            active,
            precedence,
            revision: read.revision,
            supported_keys,
            values: source_values,
            diagnostics: diagnostics_for_source,
        },
        definitions,
        provenance_keys,
        trust_state,
    }
}

fn unavailable_source(
    id: &str,
    label: &str,
    kind: &str,
    precedence: usize,
    message: &str,
) -> SourceRecord {
    let diagnostic = CodexDiagnostic {
        source_id: id.to_string(),
        severity: "info".to_string(),
        code: "unavailable".to_string(),
        message: message.to_string(),
        line: None,
        column: None,
    };
    SourceRecord {
        source: CodexSettingsSource {
            id: id.to_string(),
            label: label.to_string(),
            kind: kind.to_string(),
            status: "unavailable".to_string(),
            active: false,
            precedence,
            revision: None,
            supported_keys: Vec::new(),
            values: Vec::new(),
            diagnostics: vec![diagnostic],
        },
        definitions: BTreeMap::new(),
        provenance_keys: Vec::new(),
        trust_state: TrustState::Missing,
    }
}

fn default_source() -> SourceRecord {
    SourceRecord {
        source: CodexSettingsSource {
            id: "defaults".to_string(),
            label: "Codex defaults".to_string(),
            kind: "default".to_string(),
            status: "available".to_string(),
            active: true,
            precedence: 99,
            revision: None,
            supported_keys: Vec::new(),
            values: Vec::new(),
            diagnostics: Vec::new(),
        },
        definitions: BTreeMap::new(),
        provenance_keys: Vec::new(),
        trust_state: TrustState::Missing,
    }
}

fn read_bounded_file(path: &Path) -> FileRead {
    let metadata = match fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return FileRead {
                status: "missing",
                revision: None,
                bytes: None,
                error: None,
            }
        }
        Err(_) => {
            return FileRead {
                status: "unreadable",
                revision: None,
                bytes: None,
                error: Some("unreadable"),
            }
        }
    };
    if metadata.file_type().is_symlink() {
        return FileRead {
            status: "invalid",
            revision: None,
            bytes: None,
            error: Some("symlink-rejected"),
        };
    }
    if !metadata.is_file() {
        return FileRead {
            status: "invalid",
            revision: None,
            bytes: None,
            error: Some("not-regular-file"),
        };
    }
    if metadata.len() > MAX_SOURCE_BYTES {
        return FileRead {
            status: "invalid",
            revision: None,
            bytes: None,
            error: Some("source-too-large"),
        };
    }
    match fs::read(path) {
        Ok(bytes) => FileRead {
            status: "available",
            revision: Some(revision(&bytes)),
            bytes: Some(bytes),
            error: None,
        },
        Err(_) => FileRead {
            status: "unreadable",
            revision: None,
            bytes: None,
            error: Some("unreadable"),
        },
    }
}

fn parse_document(
    bytes: &[u8],
    trust_project: Option<&str>,
) -> Result<ParsedDocument, &'static str> {
    let text = std::str::from_utf8(bytes).map_err(|_| "source is not valid UTF-8")?;
    let document: DocumentMut = text.parse().map_err(|_| "source could not be parsed")?;
    let mut definitions = BTreeMap::new();
    let mut provenance_keys = Vec::new();
    let mut diagnostics = Vec::new();
    for key in SUPPORTED_KEYS {
        let Some(item) = document.get(key) else {
            continue;
        };
        match parse_supported_value(key, item) {
            Ok(Some(value)) => {
                definitions.insert(
                    key.to_string(),
                    RawDefinition {
                        key: key.to_string(),
                        value,
                    },
                );
            }
            Ok(None) => diagnostics.push(LocalDiagnostic {
                severity: "warning",
                code: "unsupported-value",
                message: "A supported setting had an invalid or sensitive value and was omitted",
            }),
            Err(message) => diagnostics.push(LocalDiagnostic {
                severity: "warning",
                code: "unsupported-value",
                message,
            }),
        }
    }
    for key in PROVENANCE_KEYS {
        if document.get(key).is_some() {
            provenance_keys.push(key.to_string());
        }
    }
    let trust_state = trust_project.map(|project| read_trust_state(&document, project));
    Ok(ParsedDocument {
        definitions,
        provenance_keys,
        trust_state,
        diagnostics,
    })
}

fn parse_supported_value(
    key: &str,
    item: &Item,
) -> Result<Option<CodexSettingValue>, &'static str> {
    match key {
        "model" => {
            let Some(value) = item.as_value().and_then(Value::as_str) else {
                return Ok(None);
            };
            let Some(value) = safe_text(value, true) else {
                return Ok(None);
            };
            Ok(Some(scalar_value("text", value)))
        }
        "approval_policy" => {
            if let Some(value) = item.as_value().and_then(Value::as_str) {
                if !matches!(value, "untrusted" | "on-request" | "never") {
                    return Err("Approval policy value is not supported by the safe editor");
                }
                return Ok(Some(scalar_value("approval", value.to_string())));
            }
            let Some(structured) = safe_json_from_item(item, 0) else {
                return Ok(None);
            };
            Ok(Some(structured_value("approvalGranular", structured)))
        }
        "sandbox_mode" => {
            let Some(value) = item.as_value().and_then(Value::as_str) else {
                return Ok(None);
            };
            if !matches!(
                value,
                "read-only" | "workspace-write" | "danger-full-access"
            ) {
                return Err("Sandbox mode value is not supported by the safe editor");
            }
            Ok(Some(scalar_value("sandbox", value.to_string())))
        }
        "default_permissions" => {
            let Some(structured) = safe_json_from_item(item, 0) else {
                return Ok(None);
            };
            Ok(Some(structured_value("permissionProfile", structured)))
        }
        _ => Ok(None),
    }
}

fn safe_json_from_item(item: &Item, depth: usize) -> Option<JsonValue> {
    if depth > MAX_STRUCTURED_DEPTH {
        return None;
    }
    if let Some(value) = item.as_value() {
        if let Some(value) = value.as_str() {
            return Some(match safe_text(value, false) {
                Some(value) => JsonValue::String(value),
                None => JsonValue::String("[redacted]".to_string()),
            });
        }
        if let Some(value) = value.as_bool() {
            return Some(JsonValue::Bool(value));
        }
        if let Some(value) = value.as_integer() {
            return Some(JsonValue::Number(value.into()));
        }
        if let Some(value) = value.as_float() {
            return serde_json::Number::from_f64(value).map(JsonValue::Number);
        }
        if let Some(array) = value.as_array() {
            let values = array
                .iter()
                .map(|item| safe_json_from_item(item, depth + 1))
                .collect::<Option<Vec<_>>>()?;
            return Some(JsonValue::Array(values));
        }
    }
    if let Some(table) = item.as_table() {
        let mut object = Map::new();
        for (key, value) in table {
            if !safe_key(key) {
                continue;
            }
            if let Some(value) = safe_json_from_item(value, depth + 1) {
                object.insert(key.to_string(), value);
            }
        }
        return Some(JsonValue::Object(object));
    }
    if let Some(array) = item.as_array_of_tables() {
        let values = array
            .iter()
            .map(|table| safe_json_from_item(&Item::Table(table.clone()), depth + 1))
            .collect::<Option<Vec<_>>>()?;
        return Some(JsonValue::Array(values));
    }
    None
}

fn safe_text(value: &str, model: bool) -> Option<String> {
    if value.is_empty()
        || value.len() > MAX_SAFE_TEXT_BYTES
        || value.chars().any(char::is_control)
        || looks_secret_like(value)
        || (model && looks_path_like(value))
    {
        return None;
    }
    Some(value.to_string())
}

fn safe_key(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 64
        && value
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || matches!(character, '_' | '-'))
}

fn looks_secret_like(value: &str) -> bool {
    let lower = value.to_ascii_lowercase();
    [
        "sk-",
        "token",
        "secret",
        "password",
        "api_key",
        "apikey",
        "bearer ",
        "private_key",
    ]
    .iter()
    .any(|marker| lower.contains(marker))
}

fn looks_path_like(value: &str) -> bool {
    value.starts_with('/')
        || value.starts_with('~')
        || value.starts_with("./")
        || value.starts_with("../")
        || value.contains('/')
        || value.contains('\\')
}

fn scalar_value(kind: &str, scalar: String) -> CodexSettingValue {
    CodexSettingValue {
        kind: kind.to_string(),
        display: scalar.clone(),
        scalar: Some(scalar),
        structured: None,
        redacted: false,
    }
}

fn structured_value(kind: &str, structured: JsonValue) -> CodexSettingValue {
    CodexSettingValue {
        kind: kind.to_string(),
        display: "Structured value (read-only)".to_string(),
        scalar: None,
        structured: Some(structured),
        redacted: false,
    }
}

fn read_trust_state(document: &DocumentMut, project: &str) -> TrustState {
    let Some(projects) = document.get("projects").and_then(Item::as_table) else {
        return TrustState::Missing;
    };
    let Some(project_item) = projects.get(project) else {
        return TrustState::Missing;
    };
    let Some(level) = project_item
        .as_table()
        .and_then(|table| table.get("trust_level"))
        .and_then(Item::as_value)
        .and_then(Value::as_str)
    else {
        return TrustState::Invalid;
    };
    match level {
        "trusted" => TrustState::Trusted,
        "untrusted" => TrustState::Untrusted,
        _ => TrustState::Invalid,
    }
}

fn user_trust_state(user: &SourceRecord) -> TrustState {
    user.trust_state
}

fn trust_status(state: TrustState, user_status: &str) -> CodexTrustStatus {
    let (state, reason) = match state {
        TrustState::Trusted => ("trusted", None),
        TrustState::Untrusted => ("untrusted", Some("Codex project layers are inactive")),
        TrustState::Invalid => ("unknown", Some("Trust metadata is invalid")),
        TrustState::Missing => (
            "unknown",
            Some("No exact trusted project entry was found in user config"),
        ),
    };
    CodexTrustStatus {
        state: state.to_string(),
        source_label: if user_status == "available" {
            "User config projects.trust_level".to_string()
        } else {
            "User config (unavailable)".to_string()
        },
        reason: reason.map(str::to_string),
    }
}

fn build_policy(
    requirements: Option<&SourceRecord>,
    settings: &[CodexResolvedSetting],
) -> (CodexPolicyStatus, Vec<CodexDiagnostic>) {
    let mut diagnostics = Vec::new();
    let mut constraints = Vec::new();
    let local_available = requirements
        .map(|record| record.source.status == "available")
        .unwrap_or(false);
    if let Some(requirements) = requirements {
        for definition in requirements.definitions.values() {
            constraints.push(CodexPolicyConstraint {
                key: definition.key.clone(),
                value: definition.value.clone(),
                source_label: requirements.source.label.clone(),
            });
        }
    }
    if !local_available {
        diagnostics.push(CodexDiagnostic {
            source_id: "managed-requirements".to_string(),
            severity: "info".to_string(),
            code: "policy-unavailable".to_string(),
            message: "Cloud or MDM managed requirements cannot be observed locally".to_string(),
            line: None,
            column: None,
        });
    }
    for setting in settings {
        let Some(constraint) = constraints
            .iter()
            .find(|constraint| constraint.key == setting.key)
        else {
            continue;
        };
        if constraint.value.scalar.is_some() && constraint.value.scalar != setting.value.scalar {
            diagnostics.push(CodexDiagnostic {
                source_id: "managed-requirements".to_string(),
                severity: "warning".to_string(),
                code: "policy-conflict".to_string(),
                message: "A written setting conflicts with a local managed requirement".to_string(),
                line: None,
                column: None,
            });
        }
    }
    let has_conflict = diagnostics
        .iter()
        .any(|diagnostic| diagnostic.code == "policy-conflict");
    let resolution = if local_available && !has_conflict {
        "complete"
    } else {
        "incomplete"
    };
    (
        CodexPolicyStatus {
            local_requirements_available: local_available,
            cloud_requirements_available: false,
            resolution: resolution.to_string(),
            constraints,
            diagnostics: diagnostics.clone(),
        },
        diagnostics,
    )
}

fn is_user_editable(definition: &RawDefinition, active: bool, kind: &str) -> bool {
    if !active || kind != "user" || definition.key == "default_permissions" {
        return false;
    }
    if definition.value.kind == "approvalGranular" {
        return false;
    }
    definition.key != "sandbox_mode"
        || definition.value.scalar.as_deref() != Some("danger-full-access")
}

fn source_error_message(code: &str) -> &'static str {
    match code {
        "source-too-large" => "Source exceeds the bounded settings read limit",
        "symlink-rejected" => "Source is a symlink and was skipped",
        "not-regular-file" => "Source is not a regular file and was skipped",
        "unreadable" => "Source could not be read",
        _ => "Source could not be inspected",
    }
}

fn revision(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    format!("{:x}", hasher.finalize())
}

#[cfg(test)]
#[path = "codex_settings_tests.rs"]
mod tests;
