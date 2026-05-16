use std::io::{self, Write};
use std::path::Path;
use std::sync::LazyLock;

use regex::Regex;

pub const REDACTED_MARKER: &str = "<REDACTED>";

pub static TOKEN_PATTERNS: LazyLock<Vec<Regex>> = LazyLock::new(|| {
    vec![
        Regex::new(r"sk-[A-Za-z0-9_\-]{16,}").expect("sk- regex"),
        Regex::new(r"gh[ps]_[A-Za-z0-9]{30,}").expect("github token regex"),
        Regex::new(r"eyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}")
            .expect("jwt regex"),
    ]
});

pub fn redact_tokens(input: &str) -> String {
    let mut out = input.to_string();
    for pat in TOKEN_PATTERNS.iter() {
        out = pat.replace_all(&out, REDACTED_MARKER).into_owned();
    }
    out
}

pub struct Redact<'a, T: ?Sized>(pub &'a T);

impl std::fmt::Display for Redact<'_, Path> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let tail = self
            .0
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_else(|| "<unknown>".to_string());
        write!(f, "~/.../{tail}")
    }
}

impl std::fmt::Debug for Redact<'_, Path> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        std::fmt::Display::fmt(self, f)
    }
}

pub struct RedactingWriter<W: Write> {
    inner: W,
}

impl<W: Write> RedactingWriter<W> {
    pub fn new(inner: W) -> Self {
        Self { inner }
    }
}

impl<W: Write> Write for RedactingWriter<W> {
    fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
        match std::str::from_utf8(buf) {
            Ok(s) => {
                let redacted = redact_tokens(s);
                self.inner.write_all(redacted.as_bytes())?;
                Ok(buf.len())
            }
            Err(_) => self.inner.write(buf),
        }
    }

    fn flush(&mut self) -> io::Result<()> {
        self.inner.flush()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn redacts_openai_key() {
        let out = redact_tokens("token=sk-abc1234567890defghi rest");
        assert!(!out.contains("sk-abc"));
        assert!(out.contains(REDACTED_MARKER));
    }

    #[test]
    fn redacts_github_pat() {
        let out = redact_tokens("ghp_abcdef1234567890ABCDEF1234567890XX trailing");
        assert!(!out.contains("ghp_abc"));
        assert!(out.contains(REDACTED_MARKER));
    }

    #[test]
    fn redacts_github_server_token() {
        let out = redact_tokens("ghs_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA1234");
        assert!(!out.contains("ghs_AAA"));
        assert!(out.contains(REDACTED_MARKER));
    }

    #[test]
    fn redacts_jwt() {
        let jwt =
            "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV";
        let out = redact_tokens(&format!("Bearer {jwt}"));
        assert!(!out.contains("eyJhbG"));
        assert!(out.contains(REDACTED_MARKER));
    }

    #[test]
    fn leaves_safe_text_alone() {
        let s = "hello world, regular log message, no secrets here";
        assert_eq!(redact_tokens(s), s);
    }

    #[test]
    fn redact_path_displays_tail_only() {
        let p = PathBuf::from("/Users/stevenevan/Documents/GitHub/claude-devtools-tauri/secret.txt");
        let rendered = format!("{}", Redact(p.as_path()));
        assert!(!rendered.contains("stevenevan"));
        assert!(!rendered.contains("Documents"));
        assert!(rendered.contains("secret.txt"));
        assert!(rendered.starts_with("~/.../"));
    }

    #[test]
    fn redact_path_debug_matches_display() {
        let p = PathBuf::from("/tmp/foo/bar.jsonl");
        let d = format!("{:?}", Redact(p.as_path()));
        let s = format!("{}", Redact(p.as_path()));
        assert_eq!(d, s);
    }

    #[test]
    fn redact_path_handles_no_filename() {
        let p = PathBuf::from("/");
        let rendered = format!("{}", Redact(p.as_path()));
        assert!(rendered.contains("<unknown>"));
    }

    #[test]
    fn redacting_writer_strips_tokens_through_stream() {
        let mut sink: Vec<u8> = Vec::new();
        {
            let mut w = RedactingWriter::new(&mut sink);
            w.write_all(b"plain prefix sk-abc1234567890defghi suffix\n")
                .expect("write");
            w.flush().expect("flush");
        }
        let written = String::from_utf8(sink).expect("utf8");
        assert!(!written.contains("sk-abc"));
        assert!(written.contains(REDACTED_MARKER));
    }
}
