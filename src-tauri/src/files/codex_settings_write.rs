//! Typed, local-only writer for the user Codex config.
//!
//! The renderer never supplies a path or TOML. A patch is validated, the user
//! file is reread under one process-wide mutex, its byte revision is compared,
//! a private recovery snapshot is created, and a fresh `DocumentMut` is
//! atomically written. Project, profile, system, and managed-policy files are
//! never writable through this module.

use std::fs::{self, File};
use std::io::{self, Read, Write};
use std::path::Path;
use std::sync::{LazyLock, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use toml_edit::{value, DocumentMut, Item, Value};

use super::codex_settings::{self, CodexSettingsContext, CodexSettingsView};

const MAX_MODEL_BYTES: usize = 256;
const MAX_CONFIG_BYTES: u64 = 256 * 1024;
const TARGET_NAME: &str = "config.toml";
const SNAPSHOT_IDENTITY: &str = "config.toml.bak";
const ERR_REVISION: &str = "codex settings: configuration changed; refresh before applying";

static CODEX_SETTINGS_WRITE_MU: LazyLock<Mutex<()>> = LazyLock::new(|| Mutex::new(()));

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields, default)]
pub struct CodexSettingsPatch {
    pub model: Option<String>,
    pub approval_policy: Option<String>,
    pub sandbox_mode: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CodexFieldDiff {
    pub key: String,
    pub old_value: String,
    pub new_value: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexSettingsPreview {
    pub target: String,
    pub expected_revision: String,
    pub current_revision: String,
    pub proposed_revision: String,
    pub diff: Vec<CodexFieldDiff>,
    pub warnings: Vec<String>,
    pub can_apply: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexSettingsConflict {
    pub target: String,
    pub expected_revision: String,
    pub actual_revision: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "status", content = "data", rename_all = "camelCase")]
pub enum CodexSettingsPreviewResult {
    Ready(CodexSettingsPreview),
    Conflict(CodexSettingsConflict),
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexSnapshotStatus {
    pub created: bool,
    pub identity: String,
    pub note: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexVerifiedField {
    pub key: String,
    pub value: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexWriteVerification {
    pub verified: bool,
    pub fields: Vec<CodexVerifiedField>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexSettingsWriteResult {
    pub target: String,
    pub revision: String,
    pub diff: Vec<CodexFieldDiff>,
    pub snapshot: CodexSnapshotStatus,
    pub verification: CodexWriteVerification,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "status", content = "data", rename_all = "camelCase")]
pub enum CodexSettingsApplyResult {
    Applied(CodexSettingsWriteResult),
    Conflict(CodexSettingsConflict),
}

#[derive(Debug, Clone)]
struct CurrentConfig {
    bytes: Option<Vec<u8>>,
    revision: String,
}

#[derive(Debug)]
struct ParentDir {
    #[cfg(unix)]
    fd: std::os::fd::OwnedFd,
    #[cfg(not(unix))]
    path: PathBuf,
}

/// Preview a typed patch against a supplied Codex home. Production uses the
/// configured root and `/etc/codex`; tests inject both roots.
pub fn preview_at(
    codex_home: &Path,
    context: &CodexSettingsContext,
    patch: &CodexSettingsPatch,
    expected_revision: &str,
    system_root: Option<&Path>,
) -> Result<CodexSettingsPreviewResult, String> {
    validate_patch(patch)?;
    validate_revision(expected_revision)?;
    let _guard = lock_writer();

    let view = codex_settings::discover_at(codex_home, context, system_root)?;
    let current = read_current(codex_home)?;
    if current.revision != expected_revision {
        return Ok(CodexSettingsPreviewResult::Conflict(conflict(
            expected_revision,
            &current.revision,
        )));
    }
    ensure_patch_targets_user(&view, patch)?;
    let proposed = render_patch(current.bytes.as_deref().unwrap_or_default(), patch)?;
    Ok(CodexSettingsPreviewResult::Ready(build_preview(
        &view,
        expected_revision,
        &proposed,
        patch,
    )))
}

/// Apply a typed patch with a compare-and-swap revision check. The parent is
/// opened before the final read/snapshot/write sequence so Unix operations use
/// descriptor-relative no-follow calls rather than a path that can be swapped.
pub fn apply_at(
    codex_home: &Path,
    context: &CodexSettingsContext,
    patch: &CodexSettingsPatch,
    expected_revision: &str,
    system_root: Option<&Path>,
) -> Result<CodexSettingsApplyResult, String> {
    validate_patch(patch)?;
    validate_revision(expected_revision)?;
    let _guard = lock_writer();

    let view = codex_settings::discover_at(codex_home, context, system_root)?;
    let current = read_current(codex_home)?;
    if current.revision != expected_revision {
        return Ok(CodexSettingsApplyResult::Conflict(conflict(
            expected_revision,
            &current.revision,
        )));
    }
    ensure_patch_targets_user(&view, patch)?;
    // Reopen the resolved parent after all validation. This second read is a
    // compare-and-swap check for an external edit between discovery and open.
    let parent = open_parent(codex_home, true)?;
    let current = read_current_from_parent(&parent)?;
    if current.revision != expected_revision {
        return Ok(CodexSettingsApplyResult::Conflict(conflict(
            expected_revision,
            &current.revision,
        )));
    }
    let proposed = render_patch(current.bytes.as_deref().unwrap_or_default(), patch)?;

    let snapshot = match current.bytes.as_deref() {
        Some(bytes) => {
            write_snapshot(&parent, bytes).map_err(|error| {
                format!("codex settings: create {SNAPSHOT_IDENTITY} snapshot before write: {error}")
            })?;
            CodexSnapshotStatus {
                created: true,
                identity: SNAPSHOT_IDENTITY.to_string(),
                note: "A private pre-write snapshot was created; restore UI is deferred"
                    .to_string(),
            }
        }
        None => CodexSnapshotStatus {
            created: false,
            identity: SNAPSHOT_IDENTITY.to_string(),
            note: "No previous user config existed, so no pre-write snapshot was needed"
                .to_string(),
        },
    };
    let snapshot_created = snapshot.created;

    let install = write_atomic(&parent, proposed.as_slice(), expected_revision)
        .map_err(|error| with_snapshot_recovery(error, snapshot_created))?;
    if let InstallOutcome::Conflict(actual_revision) = install {
        return Ok(CodexSettingsApplyResult::Conflict(conflict(
            expected_revision,
            &actual_revision,
        )));
    }
    let after = read_current_from_parent(&parent)
        .map_err(|error| with_snapshot_recovery(error, snapshot_created))?;
    let after_bytes = after.bytes.as_deref().ok_or_else(|| {
        with_snapshot_recovery(
            "codex settings: written config disappeared during verification".to_string(),
            snapshot_created,
        )
    })?;
    let verified = verify_patch(after_bytes, patch)
        .map_err(|error| with_snapshot_recovery(error, snapshot_created))?;
    let verified_view = codex_settings::discover_at(codex_home, context, system_root)
        .map_err(|error| with_snapshot_recovery(error, snapshot_created))?;
    verify_effective_patch(&verified_view, patch)
        .map_err(|error| with_snapshot_recovery(error, snapshot_created))?;
    Ok(CodexSettingsApplyResult::Applied(
        CodexSettingsWriteResult {
            target: "user config (~/.codex/config.toml)".to_string(),
            revision: after.revision,
            diff: build_diff(&view, patch),
            snapshot,
            verification: CodexWriteVerification {
                verified: true,
                fields: verified,
            },
        },
    ))
}

fn lock_writer() -> std::sync::MutexGuard<'static, ()> {
    CODEX_SETTINGS_WRITE_MU
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn validate_patch(patch: &CodexSettingsPatch) -> Result<(), String> {
    if patch.model.is_none() && patch.approval_policy.is_none() && patch.sandbox_mode.is_none() {
        return Err("codex settings: patch contains no supported fields".to_string());
    }
    if let Some(model) = patch.model.as_deref() {
        if model.is_empty()
            || model.len() > MAX_MODEL_BYTES
            || has_control(model)
            || looks_secret_like(model)
            || looks_path_like(model)
        {
            return Err("codex settings: model value is invalid for the safe editor".to_string());
        }
    }
    if let Some(approval) = patch.approval_policy.as_deref() {
        if !matches!(approval, "untrusted" | "on-request" | "never") {
            return Err("codex settings: approval policy value is not supported".to_string());
        }
    }
    if let Some(sandbox) = patch.sandbox_mode.as_deref() {
        if !matches!(sandbox, "read-only" | "workspace-write") {
            return Err(
                "codex settings: sandbox value is limited to read-only or workspace-write"
                    .to_string(),
            );
        }
    }
    Ok(())
}

fn validate_revision(revision: &str) -> Result<(), String> {
    if revision == "missing"
        || (revision.len() == 64 && revision.bytes().all(|byte| byte.is_ascii_hexdigit()))
    {
        Ok(())
    } else {
        Err("codex settings: expected revision is malformed".to_string())
    }
}

fn ensure_patch_targets_user(
    view: &CodexSettingsView,
    patch: &CodexSettingsPatch,
) -> Result<(), String> {
    let has_default_permissions = view
        .settings
        .iter()
        .any(|setting| setting.key == "default_permissions")
        || view
            .policy
            .constraints
            .iter()
            .any(|constraint| constraint.key == "default_permissions");
    if has_default_permissions && (patch.approval_policy.is_some() || patch.sandbox_mode.is_some())
    {
        return Err(
            "codex settings: approval and sandbox edits are blocked while default_permissions is present"
                .to_string(),
        );
    }
    for (key, value) in patch_fields(patch) {
        if let Some(setting) = view.settings.iter().find(|setting| setting.key == key) {
            if !setting.editable {
                return Err(format!(
                    "codex settings: {key} is owned by a read-only source; user defaults would be shadowed"
                ));
            }
        }
        if let Some(constraint) = view
            .policy
            .constraints
            .iter()
            .find(|constraint| constraint.key == key)
        {
            let allowed = constraint
                .allowed_values
                .as_ref()
                .map(|values| values.iter().any(|candidate| candidate == value))
                .unwrap_or_else(|| constraint.value.scalar.as_deref() == Some(value));
            if !allowed {
                return Err(format!(
                    "codex settings: {key} conflicts with a local managed requirement"
                ));
            }
        }
    }
    Ok(())
}

fn with_snapshot_recovery(error: String, snapshot_created: bool) -> String {
    if snapshot_created {
        format!("{error}; pre-write snapshot {SNAPSHOT_IDENTITY} is available for recovery")
    } else {
        format!("{error}; no pre-write snapshot was created because the user config was new")
    }
}

fn build_preview(
    view: &CodexSettingsView,
    expected_revision: &str,
    proposed: &[u8],
    patch: &CodexSettingsPatch,
) -> CodexSettingsPreview {
    let mut warnings = Vec::new();
    if view.policy.resolution == "incomplete" {
        warnings.push(
            "Managed policy resolution is incomplete; cloud/MDM rules are unavailable".to_string(),
        );
    }
    CodexSettingsPreview {
        target: "user config (~/.codex/config.toml)".to_string(),
        expected_revision: expected_revision.to_string(),
        current_revision: expected_revision.to_string(),
        proposed_revision: revision(proposed),
        diff: build_diff(view, patch),
        warnings,
        can_apply: true,
    }
}

fn build_diff(view: &CodexSettingsView, patch: &CodexSettingsPatch) -> Vec<CodexFieldDiff> {
    patch_fields(patch)
        .into_iter()
        .map(|(key, new_value)| CodexFieldDiff {
            key: key.to_string(),
            old_value: view
                .settings
                .iter()
                .find(|setting| setting.key == key)
                .map(|setting| setting.value.display.clone())
                .unwrap_or_else(|| "Not set".to_string()),
            new_value: new_value.to_string(),
        })
        .collect()
}

fn patch_fields(patch: &CodexSettingsPatch) -> Vec<(&'static str, &str)> {
    let mut fields = Vec::new();
    if let Some(value) = patch.model.as_deref() {
        fields.push(("model", value));
    }
    if let Some(value) = patch.approval_policy.as_deref() {
        fields.push(("approval_policy", value));
    }
    if let Some(value) = patch.sandbox_mode.as_deref() {
        fields.push(("sandbox_mode", value));
    }
    fields
}

fn render_patch(current: &[u8], patch: &CodexSettingsPatch) -> Result<Vec<u8>, String> {
    let text =
        std::str::from_utf8(current).map_err(|_| "codex settings: user config is not UTF-8")?;
    let mut document: DocumentMut = text
        .parse()
        .map_err(|_| "codex settings: user config could not be parsed for preview")?;
    if let Some(model) = patch.model.as_deref() {
        document["model"] = value(model);
    }
    if let Some(approval) = patch.approval_policy.as_deref() {
        document["approval_policy"] = value(approval);
    }
    if let Some(sandbox) = patch.sandbox_mode.as_deref() {
        document["sandbox_mode"] = value(sandbox);
    }
    Ok(document.to_string().into_bytes())
}

fn verify_patch(
    bytes: &[u8],
    patch: &CodexSettingsPatch,
) -> Result<Vec<CodexVerifiedField>, String> {
    let text = std::str::from_utf8(bytes)
        .map_err(|_| "codex settings: verification bytes are not UTF-8")?;
    let document: DocumentMut = text
        .parse()
        .map_err(|_| "codex settings: written config could not be parsed during verification")?;
    let mut verified = Vec::new();
    for (key, expected) in patch_fields(patch) {
        let actual = document
            .get(key)
            .and_then(Item::as_value)
            .and_then(Value::as_str)
            .ok_or_else(|| format!("codex settings: verification could not read {key}"))?;
        if actual != expected {
            return Err(format!("codex settings: verification failed for {key}"));
        }
        verified.push(CodexVerifiedField {
            key: key.to_string(),
            value: actual.to_string(),
        });
    }
    Ok(verified)
}

fn verify_effective_patch(
    view: &CodexSettingsView,
    patch: &CodexSettingsPatch,
) -> Result<(), String> {
    for (key, expected) in patch_fields(patch) {
        let setting = view
            .settings
            .iter()
            .find(|setting| setting.key == key)
            .ok_or_else(|| format!("codex settings: verification could not resolve {key}"))?;
        if setting.value.scalar.as_deref() != Some(expected) {
            return Err(format!(
                "codex settings: verification did not observe the requested {key} value"
            ));
        }
    }
    Ok(())
}

fn conflict(expected: &str, actual: &str) -> CodexSettingsConflict {
    CodexSettingsConflict {
        target: "user config (~/.codex/config.toml)".to_string(),
        expected_revision: expected.to_string(),
        actual_revision: actual.to_string(),
        message: ERR_REVISION.to_string(),
    }
}

fn read_current(codex_home: &Path) -> Result<CurrentConfig, String> {
    let Some(parent) = open_parent(codex_home, false)? else {
        return Ok(CurrentConfig {
            bytes: None,
            revision: "missing".to_string(),
        });
    };
    read_current_from_parent(&parent)
}

fn read_current_from_parent(parent: &ParentDir) -> Result<CurrentConfig, String> {
    let bytes = read_named(parent, TARGET_NAME)?;
    let revision = bytes
        .as_deref()
        .map(revision)
        .unwrap_or_else(|| "missing".to_string());
    Ok(CurrentConfig { bytes, revision })
}

fn open_parent(codex_home: &Path, create: bool) -> Result<Option<ParentDir>, String> {
    if !codex_home.is_absolute() {
        return Err("codex settings: resolved CODEX_HOME must be absolute".to_string());
    }
    match fs::symlink_metadata(codex_home) {
        Ok(metadata) if metadata.file_type().is_symlink() => {
            return Err("codex settings: CODEX_HOME symlink is rejected for writes".to_string())
        }
        Ok(metadata) if !metadata.is_dir() => {
            return Err("codex settings: CODEX_HOME is not a directory".to_string())
        }
        Ok(_) => {}
        Err(error) if error.kind() == io::ErrorKind::NotFound && !create => return Ok(None),
        Err(_error) if _error.kind() == io::ErrorKind::NotFound && create => {}
        Err(error) => {
            return Err(format!("codex settings: inspect CODEX_HOME: {error}"));
        }
    }
    if create && !codex_home.exists() {
        fs::create_dir_all(codex_home)
            .map_err(|error| format!("codex settings: create CODEX_HOME: {error}"))?;
        #[cfg(unix)]
        fs::set_permissions(codex_home, fs::Permissions::from_mode(0o700))
            .map_err(|error| format!("codex settings: secure CODEX_HOME: {error}"))?;
    }
    #[cfg(unix)]
    {
        let bytes = std::ffi::CString::new(codex_home.as_os_str().as_bytes())
            .map_err(|_| "codex settings: CODEX_HOME contains an invalid path")?;
        let fd = unsafe {
            libc::open(
                bytes.as_ptr(),
                libc::O_RDONLY | libc::O_DIRECTORY | libc::O_CLOEXEC | libc::O_NOFOLLOW,
            )
        };
        if fd < 0 {
            return Err(format!(
                "codex settings: open CODEX_HOME parent: {}",
                io::Error::last_os_error()
            ));
        }
        return Ok(Some(ParentDir {
            fd: unsafe { std::os::fd::OwnedFd::from_raw_fd(fd) },
        }));
    }
    #[cfg(not(unix))]
    {
        let canonical = fs::canonicalize(codex_home)
            .map_err(|error| format!("codex settings: resolve CODEX_HOME parent: {error}"))?;
        Ok(Some(ParentDir { path: canonical }))
    }
}

fn read_named(parent: &ParentDir, name: &str) -> Result<Option<Vec<u8>>, String> {
    #[cfg(unix)]
    {
        let c_name = std::ffi::CString::new(name)
            .map_err(|_| "codex settings: invalid config file name".to_string())?;
        let fd = unsafe {
            libc::openat(
                parent.fd.as_raw_fd(),
                c_name.as_ptr(),
                libc::O_RDONLY | libc::O_CLOEXEC | libc::O_NOFOLLOW,
            )
        };
        if fd < 0 {
            let error = io::Error::last_os_error();
            if error.kind() == io::ErrorKind::NotFound {
                return Ok(None);
            }
            if error.raw_os_error() == Some(libc::ELOOP) {
                return Err("codex settings: config.toml symlink is rejected".to_string());
            }
            return Err(format!("codex settings: open config.toml: {error}"));
        }
        let file = unsafe { File::from_raw_fd(fd) };
        let metadata = file
            .metadata()
            .map_err(|error| format!("codex settings: inspect config.toml: {error}"))?;
        if !metadata.is_file() {
            return Err("codex settings: config.toml is not a regular file".to_string());
        }
        if metadata.len() > MAX_CONFIG_BYTES {
            return Err("codex settings: config.toml exceeds the bounded write limit".to_string());
        }
        let mut bytes = Vec::with_capacity(metadata.len() as usize);
        let mut file = file;
        file.read_to_end(&mut bytes)
            .map_err(|error| format!("codex settings: read config.toml: {error}"))?;
        return Ok(Some(bytes));
    }
    #[cfg(not(unix))]
    {
        let path = parent.path.join(name);
        let metadata = match fs::symlink_metadata(&path) {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
            Err(error) => return Err(format!("codex settings: inspect config.toml: {error}")),
        };
        if metadata.file_type().is_symlink() || !metadata.is_file() {
            return Err("codex settings: config.toml is not a regular file".to_string());
        }
        if metadata.len() > MAX_CONFIG_BYTES {
            return Err("codex settings: config.toml exceeds the bounded write limit".to_string());
        }
        fs::read(path)
            .map(Some)
            .map_err(|error| format!("codex settings: read config.toml: {error}"))
    }
}

fn write_snapshot(parent: &ParentDir, bytes: &[u8]) -> Result<String, String> {
    let (name, mut file) = create_unique(parent, SNAPSHOT_IDENTITY, true)?;
    if let Err(error) = file.write_all(bytes).and_then(|_| file.sync_all()) {
        let _ = remove_named(parent, &name);
        return Err(error.to_string());
    }
    Ok(name)
}

#[derive(Debug)]
enum InstallOutcome {
    Applied,
    Conflict(String),
}

fn write_atomic(
    parent: &ParentDir,
    bytes: &[u8],
    expected_revision: &str,
) -> Result<InstallOutcome, String> {
    let (name, mut file) = create_unique(parent, ".codex-settings.tmp", false)
        .map_err(|error| format!("codex settings: create private temp file: {error}"))?;
    if let Err(error) = file.write_all(bytes).and_then(|_| file.sync_all()) {
        let _ = remove_named(parent, &name);
        return Err(format!("codex settings: write private temp file: {error}"));
    }
    drop(file);
    let result = install_temp(parent, &name, expected_revision);
    if result.is_err() {
        let _ = remove_named(parent, &name);
    }
    result
}

fn install_temp(
    parent: &ParentDir,
    temp_name: &str,
    expected_revision: &str,
) -> Result<InstallOutcome, String> {
    if expected_revision == "missing" {
        match link_named(parent, temp_name, TARGET_NAME) {
            Ok(()) => {
                remove_named(parent, temp_name).map_err(|error| {
                    format!("codex settings: remove private temp file: {error}")
                })?;
                return Ok(InstallOutcome::Applied);
            }
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {
                let actual = read_current_from_parent(parent)?.revision;
                let _ = remove_named(parent, temp_name);
                return Ok(InstallOutcome::Conflict(actual));
            }
            Err(error) => {
                return Err(format!(
                    "codex settings: install new config without replacement: {error}"
                ));
            }
        }
    }

    match exchange_named(parent, temp_name, TARGET_NAME) {
        Ok(()) => {}
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            let _ = remove_named(parent, temp_name);
            return Ok(InstallOutcome::Conflict("missing".to_string()));
        }
        Err(error) => {
            return Err(format!(
                "codex settings: atomically compare and replace config.toml: {error}"
            ));
        }
    }
    let previous = match read_named(parent, temp_name) {
        Ok(Some(bytes)) => bytes,
        Ok(None) => Vec::new(),
        Err(error) => {
            let rollback = exchange_named(parent, temp_name, TARGET_NAME);
            return Err(match rollback {
                Ok(()) => format!("codex settings: inspect displaced config: {error}"),
                Err(rollback) => format!(
                    "codex settings: inspect displaced config: {error}; rollback failed: {rollback}"
                ),
            });
        }
    };
    let actual_revision = revision(&previous);
    if actual_revision != expected_revision {
        exchange_named(parent, temp_name, TARGET_NAME).map_err(|error| {
            format!("codex settings: configuration changed and rollback failed: {error}")
        })?;
        remove_named(parent, temp_name)
            .map_err(|error| format!("codex settings: remove private temp file: {error}"))?;
        return Ok(InstallOutcome::Conflict(actual_revision));
    }
    remove_named(parent, temp_name)
        .map_err(|error| format!("codex settings: remove private displaced config: {error}"))?;
    Ok(InstallOutcome::Applied)
}

fn create_unique(
    parent: &ParentDir,
    preferred: &str,
    allow_preferred: bool,
) -> Result<(String, File), String> {
    let nonce = unique_nonce();
    let mut names = Vec::new();
    if allow_preferred {
        names.push(preferred.to_string());
    }
    names.push(format!("{preferred}.{nonce}"));
    for name in names {
        match create_new_named(parent, &name) {
            Ok(file) => return Ok((name, file)),
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(error.to_string()),
        }
    }
    Err("no unique private sibling name was available".to_string())
}

fn unique_nonce() -> u128 {
    static COUNTER: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let counter = COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let time = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or(0);
    time ^ u128::from(counter)
}

fn create_new_named(parent: &ParentDir, name: &str) -> io::Result<File> {
    #[cfg(unix)]
    {
        let c_name =
            std::ffi::CString::new(name).map_err(|_| io::Error::from_raw_os_error(libc::EINVAL))?;
        let fd = unsafe {
            libc::openat(
                parent.fd.as_raw_fd(),
                c_name.as_ptr(),
                libc::O_WRONLY | libc::O_CREAT | libc::O_EXCL | libc::O_CLOEXEC | libc::O_NOFOLLOW,
                0o600,
            )
        };
        if fd < 0 {
            return Err(io::Error::last_os_error());
        }
        let result = unsafe { libc::fchmod(fd, 0o600) };
        if result != 0 {
            let error = io::Error::last_os_error();
            unsafe { libc::close(fd) };
            let _ = remove_named(parent, name);
            return Err(error);
        }
        Ok(unsafe { File::from_raw_fd(fd) })
    }
    #[cfg(not(unix))]
    {
        OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(parent.path.join(name))
    }
}

fn remove_named(parent: &ParentDir, name: &str) -> io::Result<()> {
    #[cfg(unix)]
    {
        let c_name =
            std::ffi::CString::new(name).map_err(|_| io::Error::from_raw_os_error(libc::EINVAL))?;
        let result = unsafe { libc::unlinkat(parent.fd.as_raw_fd(), c_name.as_ptr(), 0) };
        if result == 0 {
            Ok(())
        } else {
            Err(io::Error::last_os_error())
        }
    }
    #[cfg(not(unix))]
    fs::remove_file(parent.path.join(name))
}

fn link_named(parent: &ParentDir, from: &str, to: &str) -> io::Result<()> {
    #[cfg(unix)]
    {
        let from =
            std::ffi::CString::new(from).map_err(|_| io::Error::from_raw_os_error(libc::EINVAL))?;
        let to =
            std::ffi::CString::new(to).map_err(|_| io::Error::from_raw_os_error(libc::EINVAL))?;
        let result = unsafe {
            libc::linkat(
                parent.fd.as_raw_fd(),
                from.as_ptr(),
                parent.fd.as_raw_fd(),
                to.as_ptr(),
                0,
            )
        };
        if result == 0 {
            Ok(())
        } else {
            Err(io::Error::last_os_error())
        }
    }
    #[cfg(not(unix))]
    fs::hard_link(parent.path.join(from), parent.path.join(to))
}

fn exchange_named(parent: &ParentDir, from: &str, to: &str) -> io::Result<()> {
    #[cfg(target_os = "macos")]
    {
        let from =
            std::ffi::CString::new(from).map_err(|_| io::Error::from_raw_os_error(libc::EINVAL))?;
        let to =
            std::ffi::CString::new(to).map_err(|_| io::Error::from_raw_os_error(libc::EINVAL))?;
        let result = unsafe {
            libc::renameatx_np(
                parent.fd.as_raw_fd(),
                from.as_ptr(),
                parent.fd.as_raw_fd(),
                to.as_ptr(),
                libc::RENAME_SWAP,
            )
        };
        if result == 0 {
            Ok(())
        } else {
            Err(io::Error::last_os_error())
        }
    }
    #[cfg(target_os = "linux")]
    {
        let from =
            std::ffi::CString::new(from).map_err(|_| io::Error::from_raw_os_error(libc::EINVAL))?;
        let to =
            std::ffi::CString::new(to).map_err(|_| io::Error::from_raw_os_error(libc::EINVAL))?;
        let result = unsafe {
            libc::renameat2(
                parent.fd.as_raw_fd(),
                from.as_ptr(),
                parent.fd.as_raw_fd(),
                to.as_ptr(),
                libc::RENAME_EXCHANGE,
            )
        };
        if result == 0 {
            Ok(())
        } else {
            Err(io::Error::last_os_error())
        }
    }
    #[cfg(all(unix, not(any(target_os = "macos", target_os = "linux"))))]
    {
        let _ = (parent, from, to);
        Err(io::Error::new(
            io::ErrorKind::Unsupported,
            "atomic compare-and-swap is unavailable on this Unix platform",
        ))
    }
    #[cfg(not(unix))]
    {
        let _ = (parent, from, to);
        Err(io::Error::new(
            io::ErrorKind::Unsupported,
            "atomic compare-and-swap is unavailable on this platform",
        ))
    }
}

fn revision(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    format!("{:x}", hasher.finalize())
}

fn has_control(value: &str) -> bool {
    value.chars().any(char::is_control)
}

fn looks_secret_like(value: &str) -> bool {
    let lower = value.to_ascii_lowercase();
    [
        "sk-", "token", "secret", "password", "api_key", "apikey", "bearer ",
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

#[cfg(unix)]
use std::os::fd::{AsRawFd, FromRawFd};

#[cfg(unix)]
use std::os::unix::ffi::OsStrExt;

#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;

#[cfg(not(unix))]
use std::fs::OpenOptions;

#[cfg(not(unix))]
use std::path::PathBuf;

#[cfg(test)]
#[path = "codex_settings_write_tests.rs"]
mod tests;
