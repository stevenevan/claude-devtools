//! Go↔Rust parser parity (Cycle B §2, W3–W6 tier): parse each committed
//! synthetic fixture and assert the Rust parser's `ParsedMessage[]` canon-matches
//! the Go-generated golden (`internal/paritytest/testdata/*.messages.golden.json`).
//! Regenerate goldens with `GEN_GOLDENS=1 go test ./internal/paritytest/`.

use std::fs;
use std::path::Path;

use crate::parsing::session_parser::parse_jsonl_file;
use crate::testutil::{canon, canon_str};

#[test]
fn messages_match_go_goldens() {
    // cargo runs tests with CWD = crate root (src-tauri).
    let dir = Path::new("../internal/paritytest/testdata");
    let mut checked = 0;
    for entry in fs::read_dir(dir).expect("read testdata dir") {
        let path = entry.unwrap().path();
        if path.extension().and_then(|e| e.to_str()) != Some("jsonl") {
            continue;
        }
        let stem = path.file_stem().unwrap().to_str().unwrap().to_string();
        let golden = dir.join(format!("{stem}.messages.golden.json"));
        let (messages, _meta) = parse_jsonl_file(&path).expect("parse fixture");
        let golden_json = fs::read_to_string(&golden).unwrap_or_else(|e| {
            panic!("read golden for {stem}: {e} — run `GEN_GOLDENS=1 go test ./internal/paritytest/`")
        });
        assert_eq!(canon(&messages), canon_str(&golden_json), "parser parity for {stem}");
        checked += 1;
    }
    assert!(checked > 0, "no *.jsonl fixtures found under {dir:?}");
}
