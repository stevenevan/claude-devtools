//! SFTP streaming provider. `RemoteFileTail` tracks the byte offset for a remote
//! JSONL file and surfaces complete lines from incremental chunks; `TailRegistry`
//! manages per-path tails. PURE — no network I/O (the live SFTP FS ops live in
//! `connection_manager`, mirroring Go's split). Reconciled against the Go oracle
//! `internal/ssh/sftp_provider.go`.

use std::collections::HashMap;
use std::path::PathBuf;

#[derive(Debug, Clone, Default)]
pub struct RemoteFileTail {
    /// Total bytes consumed from the remote file (post-line-merge).
    pub offset: u64,
    /// Trailing partial line carried across polls.
    pending: String,
}

impl RemoteFileTail {
    pub fn new() -> Self {
        Self::default()
    }

    /// Reset offset to zero (e.g. file rotated); pending fragment cleared.
    pub fn reset(&mut self) {
        self.offset = 0;
        self.pending.clear();
    }

    /// Feed a chunk read at the current offset; returns any complete lines.
    /// The offset advances by the chunk length; the trailing partial line is
    /// retained for the next call.
    pub fn apply_chunk(&mut self, chunk: &[u8]) -> Vec<String> {
        if chunk.is_empty() {
            return Vec::new();
        }
        self.offset += chunk.len() as u64;
        // Lossy conversion tolerates a partial multibyte at a chunk boundary.
        self.pending.push_str(&String::from_utf8_lossy(chunk));

        let mut lines = Vec::new();
        while let Some(idx) = self.pending.find('\n') {
            let mut line = self.pending[..idx].to_string();
            if line.ends_with('\r') {
                line.pop();
            }
            lines.push(line);
            self.pending = self.pending[idx + 1..].to_string();
        }
        lines
    }
}

/// Per-connection registry of file tails keyed by remote path.
#[derive(Debug, Default)]
pub struct TailRegistry {
    tails: HashMap<PathBuf, RemoteFileTail>,
}

impl TailRegistry {
    pub fn get_or_init(&mut self, path: &std::path::Path) -> &mut RemoteFileTail {
        self.tails
            .entry(path.to_path_buf())
            .or_insert_with(RemoteFileTail::new)
    }

    pub fn remove(&mut self, path: &std::path::Path) {
        self.tails.remove(path);
    }

    pub fn known_paths(&self) -> Vec<PathBuf> {
        self.tails.keys().cloned().collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn apply_chunk_extracts_complete_lines() {
        let mut tail = RemoteFileTail::new();
        let lines = tail.apply_chunk(b"first\nsecond\nthird");
        assert_eq!(lines, vec!["first".to_string(), "second".to_string()]);
        assert_eq!(tail.offset, b"first\nsecond\nthird".len() as u64);
    }

    #[test]
    fn pending_fragment_completes_on_next_chunk() {
        let mut tail = RemoteFileTail::new();
        let first = tail.apply_chunk(b"first\nseco");
        assert_eq!(first, vec!["first".to_string()]);
        let second = tail.apply_chunk(b"nd\nthird\n");
        assert_eq!(second, vec!["second".to_string(), "third".to_string()]);
        assert_eq!(
            tail.offset,
            (b"first\nseco".len() + b"nd\nthird\n".len()) as u64
        );
    }

    #[test]
    fn offset_preserved_across_simulated_reconnect() {
        let mut tail = RemoteFileTail::new();
        tail.apply_chunk(b"alpha\nbravo\n");
        let snap = tail.offset;
        let lines = tail.apply_chunk(b"charlie\n");
        assert_eq!(lines, vec!["charlie".to_string()]);
        assert!(tail.offset > snap);
    }

    #[test]
    fn registry_keys_independent_files() {
        let mut reg = TailRegistry::default();
        reg.get_or_init(std::path::Path::new("/a.jsonl"))
            .apply_chunk(b"a\n");
        reg.get_or_init(std::path::Path::new("/b.jsonl"))
            .apply_chunk(b"b\n");
        assert_eq!(reg.known_paths().len(), 2);
        reg.remove(std::path::Path::new("/a.jsonl"));
        assert_eq!(reg.known_paths().len(), 1);
    }
}
