//! Ports `text_write_test.go` — the instruction-file editor cases. Uses
//! canonicalized temp dirs (never real files); the ported functions take `root`
//! explicitly, so HOME is not touched.

use super::*;
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

fn make_temp_dir(tag: &str) -> PathBuf {
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let n = COUNTER.fetch_add(1, Ordering::SeqCst);
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let dir = std::env::temp_dir().join(format!(
        "text-write-{tag}-{}-{nanos}-{n}",
        std::process::id()
    ));
    fs::create_dir_all(&dir).unwrap();
    fs::canonicalize(&dir).unwrap()
}

fn instruction_test_root() -> PathBuf {
    let tmp = make_temp_dir("root");
    let root = tmp.join(".claude");
    fs::create_dir_all(&root).unwrap();
    root
}

#[test]
fn write_text_file_read_round_trip() {
    let root = instruction_test_root();
    let root_str = root.to_str().unwrap();
    let body = "# CLAUDE.md\n\nRule: <do> & \"quote\" — unicode café 日本語\n";

    write_text_file(root_str, "CLAUDE.md", body.as_bytes()).unwrap();
    let got = read_text_file(root_str, "CLAUDE.md").unwrap();
    assert_eq!(got, body.as_bytes());
    assert!(
        !root.join("CLAUDE.md.bak").exists(),
        "expected no .bak after first write"
    );

    let second = format!("{body}\nappended rule\n");
    write_text_file(root_str, "CLAUDE.md", second.as_bytes()).unwrap();
    let bak = fs::read_to_string(root.join("CLAUDE.md.bak")).unwrap();
    assert_eq!(bak, body, ".bak must hold first-write content");
    let got2 = read_text_file(root_str, "CLAUDE.md").unwrap();
    assert_eq!(got2, second.as_bytes());
}

#[test]
fn mutate_text_file_transform_receives_current_and_writes_output() {
    let root = instruction_test_root();
    let root_str = root.to_str().unwrap();
    write_text_file(root_str, "rules/style.md", b"v1").unwrap();

    let mut seen = String::new();
    mutate_text_file(root_str, "rules/style.md", |current| {
        seen = String::from_utf8_lossy(current).into_owned();
        Ok(format!("{seen}-v2").into_bytes())
    })
    .unwrap();
    assert_eq!(seen, "v1", "transform must see the current bytes");

    let got = read_text_file(root_str, "rules/style.md").unwrap();
    assert_eq!(got, b"v1-v2");
}

#[test]
fn write_text_file_rejects_escaping_or_non_canonical_paths() {
    let cases = [
        "rules/../../../etc/x", // traversal
        "rules-evil.md",        // sibling-prefix, not segment-bounded
        "/etc/x",               // absolute
        "rules/./x.md",         // non-canonical (clean changes it)
        "../../etc/x",          // parent escape
    ];
    for rel in cases {
        let root = instruction_test_root();
        assert!(
            write_text_file(root.to_str().unwrap(), rel, b"payload").is_err(),
            "expected write_text_file({rel:?}) to be rejected"
        );
    }
}

#[test]
fn write_text_file_rejects_symlinked_parent_escape() {
    let root = instruction_test_root();
    let outside = make_temp_dir("outside");

    std::os::unix::fs::symlink(&outside, root.join("rules")).unwrap();

    assert!(
        write_text_file(root.to_str().unwrap(), "rules/x.md", b"payload").is_err(),
        "expected rejection of a symlinked rules/ escaping root"
    );
    assert!(
        !outside.join("x.md").exists(),
        "file leaked outside root via symlinked parent"
    );
}

#[test]
fn write_text_file_rejects_non_utf8_content() {
    let root = instruction_test_root();
    assert!(
        write_text_file(root.to_str().unwrap(), "CLAUDE.md", &[0xff, 0xfe]).is_err(),
        "expected non-UTF-8 content to be rejected"
    );
    assert!(
        !root.join("CLAUDE.md").exists(),
        "expected no file written"
    );
}

#[test]
fn list_instruction_files_reports_allowlisted_only() {
    let root = instruction_test_root();
    let root_str = root.to_str().unwrap();
    let seed = [
        ("CLAUDE.md", "claude md body"),
        ("RTK.md", "rtk body"),
        ("rules/style.md", "style rules body"),
        ("commands/foo.toml", "[tool]\nname=\"foo\""),
    ];
    for (rel, content) in seed {
        write_text_file(root_str, rel, content.as_bytes()).unwrap();
    }
    // Non-allowlisted sibling must be excluded.
    fs::write(root.join("notes.txt"), b"not tracked").unwrap();

    let got = list_instruction_files(root_str).unwrap();
    let by_path: std::collections::HashMap<String, &InstructionFile> =
        got.iter().map(|f| (f.rel_path.clone(), f)).collect();

    for (rel, content) in seed {
        let entry = by_path
            .get(rel)
            .unwrap_or_else(|| panic!("missing entry for {rel:?}"));
        assert_eq!(entry.bytes, content.len(), "{rel:?} bytes");
        assert!(
            entry.approx_tokens > 0,
            "{rel:?} approx_tokens = {}",
            entry.approx_tokens
        );
    }
    assert!(
        !by_path.contains_key("notes.txt"),
        "non-allowlisted sibling leaked into list"
    );
}
