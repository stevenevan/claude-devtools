//! Session snapshots — gzip-compressed serialized SessionDetail (sprint 36).
//!
//! Snapshots live in the app-data `snapshots/` dir as `<id>.json.gz`, with
//! metadata alongside as `<id>.meta.json` for quick listing without
//! decompressing the payload.
//!
//! The on-disk format is FROZEN for cross-version compatibility: payload =
//! gzip(json(detail)); meta = pretty json(SnapshotMeta).

use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

use flate2::read::GzDecoder;
use flate2::write::GzEncoder;
use flate2::Compression;
use serde::{Deserialize, Serialize};

use crate::config::root;
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

/// Rejects any frontend-supplied id that could traverse out of the snapshots
/// dir. Legitimate ids are always `uuid::new_v4()` (hex + `-`), so requiring
/// ASCII alnum/`-` is loss-free for real snapshots while blocking `/`, `\`,
/// `..`, empty, and control characters before any path is built.
fn validate_snapshot_id(id: &str) -> Result<(), String> {
    if id.is_empty() || !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
        return Err("invalid snapshot id".to_string());
    }
    Ok(())
}

fn snapshots_dir() -> Result<PathBuf, String> {
    let dir = match std::env::var("CLAUDE_DEVTOOLS_SNAPSHOTS_DIR") {
        Ok(override_path) if !override_path.is_empty() => PathBuf::from(override_path),
        _ => root::app_data_dir()?.join("snapshots"),
    };
    fs::create_dir_all(&dir).map_err(|e| format!("Cannot create snapshots dir: {e}"))?;
    Ok(dir)
}

fn payload_path(dir: &Path, id: &str) -> PathBuf {
    dir.join(format!("{id}.json.gz"))
}

fn meta_path(dir: &Path, id: &str) -> PathBuf {
    dir.join(format!("{id}.meta.json"))
}

fn now_ms() -> f64 {
    // Matches Go's `float64(time.Now().UnixNano()) / 1e6` (fractional ms).
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos() as f64
        / 1e6
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
    // Go's os.ReadDir returns entries sorted by filename; mirror that so the
    // stable created-at sort below produces byte-identical ordering on ties.
    let mut entries: Vec<_> = fs::read_dir(&dir)
        .map_err(|e| format!("Read dir failed: {e}"))?
        .flatten()
        .collect();
    entries.sort_by_key(|e| e.file_name());

    let mut out: Vec<SnapshotMeta> = Vec::new();
    for entry in entries {
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if !name.ends_with(".meta.json") {
            continue;
        }
        let bytes = match fs::read(entry.path()) {
            Ok(b) => b,
            Err(_) => continue,
        };
        if let Ok(meta) = serde_json::from_slice::<SnapshotMeta>(&bytes) {
            out.push(meta);
        }
    }
    out.sort_by(|a, b| {
        b.created_at
            .partial_cmp(&a.created_at)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    Ok(out)
}

pub fn delete_snapshot(id: &str) -> Result<(), String> {
    validate_snapshot_id(id)?;
    let dir = snapshots_dir()?;
    let _ = fs::remove_file(payload_path(&dir, id));
    let _ = fs::remove_file(meta_path(&dir, id));
    Ok(())
}

pub fn open_snapshot(id: &str) -> Result<SessionDetail, String> {
    validate_snapshot_id(id)?;
    let dir = snapshots_dir()?;
    let bytes =
        fs::read(payload_path(&dir, id)).map_err(|e| format!("Read snapshot {id} failed: {e}"))?;
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

    #[test]
    fn rejects_path_traversal_ids() {
        for bad in [
            "",
            "../secret",
            "..",
            "a/b",
            "a\\b",
            "id with space",
            "foo.bar",
            "café",
        ] {
            assert!(
                validate_snapshot_id(bad).is_err(),
                "id {bad:?} must be rejected"
            );
            assert!(open_snapshot(bad).is_err(), "open({bad:?}) must be rejected");
            assert!(
                delete_snapshot(bad).is_err(),
                "delete({bad:?}) must be rejected"
            );
        }
        // A real uuid-shaped id passes validation.
        assert!(validate_snapshot_id(&uuid::Uuid::new_v4().to_string()).is_ok());
    }
}
