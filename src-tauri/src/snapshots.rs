/// Session snapshots — gzip-compressed serialized SessionDetail (sprint 36).
///
/// Snapshots are stored in `~/.claude-devtools/snapshots/` as
/// `<id>.json.gz` files. Metadata is stored alongside as `<id>.meta.json`
/// for quick listing without decompressing the payload.

use std::fs;
use std::io::{Read, Write};
use std::path::PathBuf;

use flate2::Compression;
use flate2::read::GzDecoder;
use flate2::write::GzEncoder;
use serde::{Deserialize, Serialize};

use crate::types::chunks::SessionDetail;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotMeta {
    pub id: String,
    pub label: String,
    pub source_session_id: String,
    pub source_project_id: String,
    pub created_at: f64,
    pub message_count: u32,
    pub chunk_count: u32,
    /// Compressed payload size on disk in bytes.
    pub size_bytes: u64,
}

fn snapshots_dir() -> Result<PathBuf, String> {
    let dir = if let Ok(override_path) = std::env::var("CLAUDE_DEVTOOLS_SNAPSHOTS_DIR") {
        PathBuf::from(override_path)
    } else {
        let home = dirs::home_dir().ok_or_else(|| "Cannot resolve home directory".to_string())?;
        home.join(".claude-devtools").join("snapshots")
    };
    if !dir.exists() {
        fs::create_dir_all(&dir).map_err(|e| format!("Cannot create snapshots dir: {e}"))?;
    }
    Ok(dir)
}

fn payload_path(dir: &PathBuf, id: &str) -> PathBuf {
    dir.join(format!("{id}.json.gz"))
}

fn meta_path(dir: &PathBuf, id: &str) -> PathBuf {
    dir.join(format!("{id}.meta.json"))
}

fn now_ms() -> f64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs_f64()
        * 1000.0
}

pub fn create_snapshot(label: &str, detail: &SessionDetail) -> Result<SnapshotMeta, String> {
    let dir = snapshots_dir()?;
    let id = uuid::Uuid::new_v4().to_string();

    let json = serde_json::to_vec(detail).map_err(|e| format!("Serialize failed: {e}"))?;
    let mut encoder = GzEncoder::new(Vec::new(), Compression::default());
    encoder
        .write_all(&json)
        .map_err(|e| format!("Compress failed: {e}"))?;
    let compressed = encoder.finish().map_err(|e| format!("Finish failed: {e}"))?;

    let payload = payload_path(&dir, &id);
    fs::write(&payload, &compressed).map_err(|e| format!("Write payload failed: {e}"))?;

    let meta = SnapshotMeta {
        id: id.clone(),
        label: label.to_string(),
        source_session_id: detail.session.id.clone(),
        source_project_id: detail.session.project_id.clone(),
        created_at: now_ms(),
        message_count: detail.messages.len() as u32,
        chunk_count: detail.chunks.len() as u32,
        size_bytes: compressed.len() as u64,
    };

    let meta_json = serde_json::to_vec_pretty(&meta).map_err(|e| format!("Meta serialize: {e}"))?;
    fs::write(meta_path(&dir, &id), meta_json).map_err(|e| format!("Write meta failed: {e}"))?;

    Ok(meta)
}

pub fn list_snapshots() -> Result<Vec<SnapshotMeta>, String> {
    let dir = snapshots_dir()?;
    let mut out: Vec<SnapshotMeta> = Vec::new();
    let entries = fs::read_dir(&dir).map_err(|e| format!("Read dir failed: {e}"))?;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|s| s.to_str()) != Some("json") {
            continue;
        }
        if !path
            .file_name()
            .and_then(|s| s.to_str())
            .map(|n| n.ends_with(".meta.json"))
            .unwrap_or(false)
        {
            continue;
        }
        let bytes = match fs::read(&path) {
            Ok(b) => b,
            Err(_) => continue,
        };
        if let Ok(meta) = serde_json::from_slice::<SnapshotMeta>(&bytes) {
            out.push(meta);
        }
    }
    out.sort_by(|a, b| b.created_at.partial_cmp(&a.created_at).unwrap_or(std::cmp::Ordering::Equal));
    Ok(out)
}

pub fn delete_snapshot(id: &str) -> Result<(), String> {
    let dir = snapshots_dir()?;
    let _ = fs::remove_file(payload_path(&dir, id));
    let _ = fs::remove_file(meta_path(&dir, id));
    Ok(())
}

// ----- Tauri commands -----

#[tauri::command]
pub fn snapshots_list() -> Result<Vec<SnapshotMeta>, String> {
    list_snapshots()
}

#[tauri::command]
pub fn snapshots_create_from_session(
    project_id: String,
    session_id: String,
    label: Option<String>,
    cache: tauri::State<'_, std::sync::Arc<std::sync::Mutex<crate::cache::SessionCache>>>,
) -> Result<SnapshotMeta, String> {
    let detail = crate::commands::get_session_detail(project_id, session_id, cache)?;
    let label = label
        .filter(|l| !l.trim().is_empty())
        .unwrap_or_else(|| detail.session.id.clone());
    create_snapshot(&label, &detail)
}

#[tauri::command]
pub fn snapshots_delete(snapshot_id: String) -> Result<(), String> {
    delete_snapshot(&snapshot_id)
}

#[tauri::command]
pub fn snapshots_open(snapshot_id: String) -> Result<SessionDetail, String> {
    open_snapshot(&snapshot_id)
}

pub fn open_snapshot(id: &str) -> Result<SessionDetail, String> {
    let dir = snapshots_dir()?;
    let bytes = fs::read(payload_path(&dir, id))
        .map_err(|e| format!("Read snapshot {id} failed: {e}"))?;
    let mut decoder = GzDecoder::new(&bytes[..]);
    let mut json = Vec::new();
    decoder
        .read_to_end(&mut json)
        .map_err(|e| format!("Decompress failed: {e}"))?;
    serde_json::from_slice(&json).map_err(|e| format!("Deserialize failed: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::chunks::SessionDetail;
    use crate::types::domain::{Session, SessionMetrics};

    fn fixture_detail() -> SessionDetail {
        SessionDetail {
            session: Session {
                id: "sess-1".to_string(),
                project_id: "proj-1".to_string(),
                project_path: "/tmp/test".to_string(),
                todo_data: None,
                created_at: 0.0,
                first_message: None,
                message_timestamp: None,
                has_subagents: false,
                message_count: 0,
                is_ongoing: Some(false),
                git_branch: None,
                metadata_level: None,
                context_consumption: None,
                compaction_count: None,
                phase_breakdown: None,
                custom_title: None,
                agent_name: None,
            },
            messages: vec![],
            chunks: vec![],
            processes: vec![],
            metrics: SessionMetrics::default(),
        }
    }

    #[test]
    fn round_trip_snapshot_compresses_and_restores() {
        let tmp = std::env::temp_dir().join(format!("snapshots-test-{}", uuid::Uuid::new_v4()));
        std::env::set_var("CLAUDE_DEVTOOLS_SNAPSHOTS_DIR", &tmp);
        let detail = fixture_detail();
        let meta = create_snapshot("Test snapshot", &detail).expect("create");
        assert!(meta.size_bytes > 0, "compressed payload should be non-empty");

        let listed = list_snapshots().expect("list");
        assert!(listed.iter().any(|m| m.id == meta.id), "should appear in list");

        let restored = open_snapshot(&meta.id).expect("open");
        assert_eq!(restored.session.id, detail.session.id);

        delete_snapshot(&meta.id).expect("delete");
        let listed_after = list_snapshots().expect("list after delete");
        assert!(!listed_after.iter().any(|m| m.id == meta.id));

        let _ = std::fs::remove_dir_all(&tmp);
        std::env::remove_var("CLAUDE_DEVTOOLS_SNAPSHOTS_DIR");
    }
}
