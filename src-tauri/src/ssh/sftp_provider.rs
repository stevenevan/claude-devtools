//! SFTP streaming provider (sprint 45).
//!
//! `RemoteFileTail` tracks the byte offset for a remote JSONL file and
//! exposes a single `apply_chunk` method that callers feed with the
//! bytes returned by an SFTP read. The provider's job is to slice
//! complete-line bytes from the buffer and surface them as `String`s
//! while remembering any unterminated trailing fragment for the next
//! poll. This decouples the line-extraction logic from the russh-sftp
//! transport and keeps the offset preserved across reconnects.

use std::collections::HashMap;
use std::path::PathBuf;

#[derive(Debug, Clone)]
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

    /// Reset offset to zero (e.g. file rotated). Pending fragment cleared.
    pub fn reset(&mut self) {
        self.offset = 0;
        self.pending.clear();
    }

    /// Feed a chunk of bytes read from the remote file at the current
    /// offset. Returns any complete lines extracted; pending content is
    /// retained for the next call. The offset is advanced by the number
    /// of bytes consumed (which is the entire chunk len).
    pub fn apply_chunk(&mut self, chunk: &[u8]) -> Vec<String> {
        if chunk.is_empty() {
            return Vec::new();
        }
        self.offset += chunk.len() as u64;
        // Tolerate non-UTF-8 by lossy conversion — Claude JSONL is UTF-8 but
        // a partial multibyte at boundary should not crash the loop.
        let text = String::from_utf8_lossy(chunk);
        self.pending.push_str(&text);

        let mut lines = Vec::new();
        loop {
            match self.pending.find('\n') {
                Some(idx) => {
                    let mut line = self.pending[..idx].to_string();
                    if line.ends_with('\r') {
                        line.pop();
                    }
                    lines.push(line);
                    self.pending = self.pending[idx + 1..].to_string();
                }
                None => break,
            }
        }
        lines
    }
}

impl Default for RemoteFileTail {
    fn default() -> Self {
        Self {
            offset: 0,
            pending: String::new(),
        }
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
        // Offset reflects total bytes consumed (preserved across "polls").
        assert_eq!(tail.offset, (b"first\nseco".len() + b"nd\nthird\n".len()) as u64);
    }

    #[test]
    fn offset_preserved_when_simulating_reconnect() {
        // Simulate: read 100 bytes, "drop", continue reading from offset.
        let mut tail = RemoteFileTail::new();
        tail.apply_chunk(b"alpha\nbravo\n");
        let snapshot_offset = tail.offset;
        // Reconnect: NEW chunk starts at the existing offset.
        let lines = tail.apply_chunk(b"charlie\n");
        assert_eq!(lines, vec!["charlie".to_string()]);
        assert!(tail.offset > snapshot_offset, "offset advanced");
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
