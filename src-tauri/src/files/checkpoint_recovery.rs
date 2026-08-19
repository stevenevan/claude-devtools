//! Backend-owned recovery copies for source-aware File History Restore.
//!
//! Recovery records are local app data. The renderer receives only opaque ids
//! and display metadata; the real target path never crosses the IPC boundary.

use std::fs::{self, OpenOptions};
use std::io::{Read, Write};
use std::path::{Component, Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::config::root::{app_data_dir, home_dir};
use crate::types::codex_maintenance::RecoveryCopy;
use crate::types::source::SourceKind;

const RECOVERY_DIR: &str = "codex-restore-recovery";
const MANIFEST_NAME: &str = "manifest.json";
const MAX_RECOVERY_COPIES: usize = 128;
const MAX_RECOVERY_BYTES: u64 = 16 * 1024 * 1024;
const MAX_MANIFEST_BYTES: usize = 256 * 1024;
static RECOVERY_LOCK: Mutex<()> = Mutex::new(());

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RecoveryRecord {
    id: String,
    source: SourceKind,
    session_uuid: String,
    file_hash: String,
    version: u32,
    target_path: String,
    target_label: String,
    created_at: i64,
    byte_size: u64,
    checksum: String,
    #[serde(default)]
    target_after_checksum: Option<String>,
    state: String,
}

pub fn list(source: SourceKind) -> Result<Vec<RecoveryCopy>, String> {
    let _lock = RECOVERY_LOCK
        .lock()
        .map_err(|_| "recovery transaction lock is poisoned".to_string())?;
    let records = load_records()?;
    Ok(records
        .into_iter()
        .filter(|record| record.source == source)
        .map(to_public)
        .collect())
}

pub fn create(
    source: SourceKind,
    session_uuid: &str,
    file_hash: &str,
    version: u32,
    target: &Path,
) -> Result<RecoveryCopy, String> {
    let _lock = RECOVERY_LOCK
        .lock()
        .map_err(|_| "recovery transaction lock is poisoned".to_string())?;
    create_locked(source, session_uuid, file_hash, version, target, None)
}

pub fn create_and_write_atomic_if_unchanged(
    source: SourceKind,
    session_uuid: &str,
    file_hash: &str,
    version: u32,
    target: &Path,
    bytes: &[u8],
) -> Result<RecoveryCopy, String> {
    let _lock = RECOVERY_LOCK
        .lock()
        .map_err(|_| "recovery transaction lock is poisoned".to_string())?;
    let recovery = create_locked(
        source,
        session_uuid,
        file_hash,
        version,
        target,
        Some(checksum(bytes)),
    )?;
    write_atomic_if_unchanged_locked(target, bytes, &recovery.checksum)?;
    Ok(recovery)
}

fn create_locked(
    source: SourceKind,
    session_uuid: &str,
    file_hash: &str,
    version: u32,
    target: &Path,
    target_after_checksum: Option<String>,
) -> Result<RecoveryCopy, String> {
    validate_target(target)?;
    let bytes = read_target(target)?;
    if bytes.len() as u64 > MAX_RECOVERY_BYTES {
        return Err("recovery copy exceeds the bounded file size".to_string());
    }
    let checksum = checksum(&bytes);
    let id = Uuid::new_v4().to_string();
    let dir = recovery_dir()?;
    ensure_private_dir(&dir)?;
    let copy_path = dir.join(format!("{id}.bin"));
    write_private_file(&copy_path, &bytes)?;
    let record = RecoveryRecord {
        id: id.clone(),
        source,
        session_uuid: session_uuid.to_string(),
        file_hash: file_hash.to_string(),
        version,
        target_path: target.to_string_lossy().into_owned(),
        target_label: display_path(target),
        created_at: now_ms(),
        byte_size: bytes.len() as u64,
        checksum,
        target_after_checksum,
        state: "retained".to_string(),
    };
    let mut records = load_records()?;
    records.push(record.clone());
    records.sort_by_key(|item| item.created_at);
    while records.len() > MAX_RECOVERY_COPIES {
        let removed = records.remove(0);
        let _ = remove_private_file(&dir.join(format!("{}.bin", removed.id)));
    }
    save_records(&records)?;
    Ok(to_public(record))
}

pub fn get(source: SourceKind, id: &str) -> Result<RecoveryCopy, String> {
    let _lock = RECOVERY_LOCK
        .lock()
        .map_err(|_| "recovery transaction lock is poisoned".to_string())?;
    validate_id(id)?;
    let records = load_records()?;
    let record = records
        .iter()
        .find(|record| record.id == id)
        .ok_or_else(|| "recovery copy was not found".to_string())?;
    if record.source != source {
        return Err("recovery copy source does not match the selected source".to_string());
    }
    Ok(to_public(record.clone()))
}

pub fn restore(
    source: SourceKind,
    id: &str,
    expected_target: &Path,
) -> Result<RecoveryCopy, String> {
    let _lock = RECOVERY_LOCK
        .lock()
        .map_err(|_| "recovery transaction lock is poisoned".to_string())?;
    validate_id(id)?;
    let records = load_records()?;
    let record = records
        .iter()
        .find(|record| record.id == id)
        .ok_or_else(|| "recovery copy was not found".to_string())?;
    if record.source != source {
        return Err("recovery copy source does not match the selected source".to_string());
    }
    if Path::new(&record.target_path) != expected_target {
        return Err("recovery copy target no longer matches the verified origin".to_string());
    }
    let expected_target_checksum = record
        .target_after_checksum
        .as_deref()
        .ok_or_else(|| "recovery copy has no verified post-restore target state".to_string())?;
    let public = to_public(record.clone());
    let path = recovery_dir()?.join(format!("{id}.bin"));
    let bytes = read_file(&path)?;
    if checksum(&bytes) != record.checksum || bytes.len() as u64 != record.byte_size {
        return Err("recovery copy checksum verification failed".to_string());
    }
    let target = PathBuf::from(&record.target_path);
    validate_target(&target)?;
    write_atomic_if_unchanged_locked(&target, &bytes, expected_target_checksum)?;
    Ok(public)
}

pub fn delete(source: SourceKind, id: &str) -> Result<RecoveryCopy, String> {
    let _lock = RECOVERY_LOCK
        .lock()
        .map_err(|_| "recovery transaction lock is poisoned".to_string())?;
    validate_id(id)?;
    let dir = recovery_dir()?;
    let mut records = load_records()?;
    let record = records
        .iter()
        .find(|record| record.id == id)
        .ok_or_else(|| "recovery copy was not found".to_string())?;
    if record.source != source {
        return Err("recovery copy source does not match the selected source".to_string());
    }
    let public = to_public(record.clone());
    let original_len = records.len();
    records.retain(|record| record.id != id);
    if records.len() == original_len {
        return Err("recovery copy was not found".to_string());
    }
    let path = dir.join(format!("{id}.bin"));
    remove_private_file(&path)?;
    save_records(&records)?;
    Ok(public)
}

pub fn write_atomic(target: &Path, bytes: &[u8]) -> Result<(), String> {
    validate_target(target)?;
    let target_mode = target_mode(target)?;
    let parent = target
        .parent()
        .ok_or_else(|| "restore target has no parent directory".to_string())?;
    let name = target
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| "restore target name is invalid".to_string())?;
    let temporary = parent.join(format!(".{name}.codex-restore.tmp"));
    if let Ok(metadata) = fs::symlink_metadata(&temporary) {
        if metadata.file_type().is_symlink() || !metadata.is_file() {
            return Err("restore temporary path is not a regular file".to_string());
        }
        remove_private_file(&temporary)?;
    }
    let result = (|| {
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)
            .map_err(|error| format!("create restore temporary file: {error}"))?;
        file.write_all(bytes)
            .map_err(|error| format!("write restore temporary file: {error}"))?;
        set_file_mode(&file, target_mode)?;
        file.sync_all()
            .map_err(|error| format!("sync restore temporary file: {error}"))?;
        drop(file);
        validate_target(target)?;
        fs::rename(&temporary, target).map_err(|error| format!("replace restore target: {error}"))
    })();
    if result.is_err() {
        let _ = remove_private_file(&temporary);
    }
    result
}

fn target_mode(path: &Path) -> Result<Option<u32>, String> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = fs::metadata(path)
            .map_err(|error| format!("inspect restore target mode: {error}"))?
            .permissions()
            .mode()
            & 0o777;
        return Ok(Some(mode));
    }
    #[cfg(not(unix))]
    {
        let _ = path;
        Ok(None)
    }
}

fn set_file_mode(file: &fs::File, mode: Option<u32>) -> Result<(), String> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = mode.unwrap_or(0o600);
        file.set_permissions(fs::Permissions::from_mode(mode))
            .map_err(|error| format!("set restore temporary file mode: {error}"))?;
    }
    #[cfg(not(unix))]
    {
        let _ = (file, mode);
    }
    Ok(())
}

pub fn write_atomic_if_unchanged(
    target: &Path,
    bytes: &[u8],
    expected_checksum: &str,
) -> Result<(), String> {
    let _lock = RECOVERY_LOCK
        .lock()
        .map_err(|_| "recovery transaction lock is poisoned".to_string())?;
    write_atomic_if_unchanged_locked(target, bytes, expected_checksum)
}

fn write_atomic_if_unchanged_locked(
    target: &Path,
    bytes: &[u8],
    expected_checksum: &str,
) -> Result<(), String> {
    validate_target(target)?;
    let current = read_target(target)?;
    if checksum(&current) != expected_checksum {
        return Err("restore target changed after confirmation; no file was written".to_string());
    }
    write_atomic(target, bytes)
}

fn load_records() -> Result<Vec<RecoveryRecord>, String> {
    let dir = recovery_dir()?;
    ensure_private_dir(&dir)?;
    let path = dir.join(MANIFEST_NAME);
    match read_private_file(&path, MAX_MANIFEST_BYTES) {
        Ok(bytes) => serde_json::from_slice(&bytes)
            .map_err(|error| format!("read recovery manifest: {error}")),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(Vec::new()),
        Err(error) => Err(format!("read recovery manifest: {error}")),
    }
}

fn save_records(records: &[RecoveryRecord]) -> Result<(), String> {
    let dir = recovery_dir()?;
    ensure_private_dir(&dir)?;
    let bytes = serde_json::to_vec(records)
        .map_err(|error| format!("serialize recovery manifest: {error}"))?;
    let temporary = dir.join(".manifest.tmp");
    if let Ok(metadata) = fs::symlink_metadata(&temporary) {
        if metadata.file_type().is_symlink() || !metadata.is_file() {
            return Err("recovery manifest temporary path is invalid".to_string());
        }
        remove_private_file(&temporary)?;
    }
    let result = (|| {
        write_private_file(&temporary, &bytes)?;
        fs::rename(&temporary, dir.join(MANIFEST_NAME))
            .map_err(|error| format!("replace recovery manifest: {error}"))
    })();
    if result.is_err() {
        let _ = remove_private_file(&temporary);
    }
    result
}

fn recovery_dir() -> Result<PathBuf, String> {
    Ok(app_data_dir()?.join(RECOVERY_DIR))
}

fn ensure_private_dir(path: &Path) -> Result<(), String> {
    fs::create_dir_all(path).map_err(|error| format!("create recovery directory: {error}"))?;
    let metadata = fs::symlink_metadata(path)
        .map_err(|error| format!("inspect recovery directory: {error}"))?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err("recovery directory is not a regular directory".to_string());
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o700))
            .map_err(|error| format!("set recovery directory permissions: {error}"))?;
        let mode = fs::metadata(path)
            .map_err(|error| format!("inspect recovery directory permissions: {error}"))?
            .permissions()
            .mode()
            & 0o777;
        if mode != 0o700 {
            return Err("recovery directory permissions are not private".to_string());
        }
    }
    Ok(())
}

fn write_private_file(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .map_err(|error| format!("create private recovery file: {error}"))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        file.set_permissions(fs::Permissions::from_mode(0o600))
            .map_err(|error| format!("set recovery file permissions: {error}"))?;
    }
    file.write_all(bytes)
        .map_err(|error| format!("write private recovery file: {error}"))?;
    file.sync_all()
        .map_err(|error| format!("sync private recovery file: {error}"))
}

fn remove_private_file(path: &Path) -> Result<(), String> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_file() => {
            Err("recovery path is not a regular file".to_string())
        }
        Ok(_) => fs::remove_file(path).map_err(|error| format!("remove recovery file: {error}")),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!("inspect recovery file: {error}")),
    }
}

fn read_file(path: &Path) -> Result<Vec<u8>, String> {
    let metadata =
        fs::symlink_metadata(path).map_err(|error| format!("inspect recovery file: {error}"))?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err("recovery file is not a regular file".to_string());
    }
    let mut file = fs::File::open(path).map_err(|error| format!("open recovery file: {error}"))?;
    let mut bytes = Vec::new();
    file.take(MAX_RECOVERY_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| format!("read recovery file: {error}"))?;
    if bytes.len() as u64 > MAX_RECOVERY_BYTES {
        return Err("recovery file exceeds the bounded size".to_string());
    }
    Ok(bytes)
}

fn read_private_file(path: &Path, max_bytes: usize) -> std::io::Result<Vec<u8>> {
    let metadata = fs::symlink_metadata(path)?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::PermissionDenied,
            "recovery path is not a regular file",
        ));
    }
    let mut file = fs::File::open(path)?;
    let mut bytes = Vec::with_capacity(max_bytes.saturating_add(1));
    file.take(max_bytes as u64 + 1).read_to_end(&mut bytes)?;
    if bytes.len() > max_bytes {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            "recovery file exceeds the bounded size",
        ));
    }
    Ok(bytes)
}

fn read_target(path: &Path) -> Result<Vec<u8>, String> {
    read_file(path).map_err(|error| format!("read restore target: {error}"))
}

fn validate_target(path: &Path) -> Result<(), String> {
    if !path.is_absolute()
        || path
            .components()
            .any(|component| component == Component::ParentDir)
    {
        return Err("restore target must be an absolute path without traversal".to_string());
    }
    let mut component_path = PathBuf::new();
    for component in path.components() {
        match component {
            Component::RootDir | Component::Prefix(_) => component_path.push(component.as_os_str()),
            Component::Normal(name) => {
                component_path.push(name);
                match fs::symlink_metadata(&component_path) {
                    Ok(metadata) if metadata.file_type().is_symlink() => {
                        return Err("restore target contains a symlink component".to_string())
                    }
                    Ok(_) => {}
                    Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                    Err(error) => return Err(format!("inspect restore target component: {error}")),
                }
            }
            Component::CurDir => {}
            Component::ParentDir => unreachable!(),
        }
    }
    let metadata =
        fs::symlink_metadata(path).map_err(|error| format!("inspect restore target: {error}"))?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err("restore target is not a regular file".to_string());
    }
    let parent = path
        .parent()
        .ok_or_else(|| "restore target has no parent directory".to_string())?;
    let parent_metadata = fs::symlink_metadata(parent)
        .map_err(|error| format!("inspect restore target directory: {error}"))?;
    if parent_metadata.file_type().is_symlink() || !parent_metadata.is_dir() {
        return Err("restore target directory is not a regular directory".to_string());
    }
    Ok(())
}

fn checksum(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    format!("{:x}", hasher.finalize())
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or(0)
}

fn validate_id(id: &str) -> Result<(), String> {
    if id.is_empty()
        || id.len() > 128
        || id.contains('/')
        || id.contains('\\')
        || id.contains('.')
        || id.contains('\0')
    {
        return Err("recovery id is invalid".to_string());
    }
    Ok(())
}

fn display_path(path: &Path) -> String {
    if let Ok(home) = home_dir() {
        if let Ok(relative) = path.strip_prefix(home) {
            return format!("~/{}", relative.to_string_lossy().replace('\\', "/"));
        }
    }
    path.file_name()
        .and_then(|name| name.to_str())
        .map(|name| format!("…/{name}"))
        .unwrap_or_else(|| "(path unavailable)".to_string())
}

fn to_public(record: RecoveryRecord) -> RecoveryCopy {
    RecoveryCopy {
        id: record.id,
        source: record.source,
        session_uuid: record.session_uuid,
        file_hash: record.file_hash,
        version: record.version,
        target_label: record.target_label,
        created_at: record.created_at,
        byte_size: record.byte_size,
        checksum: record.checksum,
        state: record.state,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recovery_id_rejects_paths() {
        assert!(validate_id("abc").is_ok());
        assert!(validate_id("../abc").is_err());
        assert!(validate_id("abc/def").is_err());
    }

    #[test]
    fn atomic_restore_refuses_a_changed_target() {
        let target =
            std::env::temp_dir().join(format!("codex-recovery-test-{}.txt", Uuid::new_v4()));
        fs::write(&target, b"before").expect("write recovery test target");
        let expected = checksum(b"before");
        fs::write(&target, b"changed").expect("change recovery test target");

        let error = write_atomic_if_unchanged(&target, b"replacement", &expected)
            .expect_err("changed target must be rejected");
        assert!(error.contains("target changed"));
        assert_eq!(
            fs::read(&target).expect("read recovery test target"),
            b"changed"
        );

        fs::remove_file(&target).expect("remove recovery test target");
    }
}
