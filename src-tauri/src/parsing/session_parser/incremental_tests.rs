use super::*;
use super::super::streaming::SessionFileMetadata;
use std::io::Write;
use std::path::Path;

fn test_dir(name: &str) -> std::path::PathBuf {
    let dir = std::env::temp_dir()
        .join("claude-devtools-test")
        .join(name);
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

#[test]
fn test_incremental_nonexistent_file() {
    let meta = SessionFileMetadata::default();
    let (msgs, _, offset) =
        parse_jsonl_incremental(Path::new("/nonexistent/file.jsonl"), 0, &meta).unwrap();
    assert!(msgs.is_empty());
    assert_eq!(offset, 0);
}

#[test]
fn test_incremental_from_zero() {
    let dir = test_dir("incr_zero");
    let file_path = dir.join("session.jsonl");

    let mut file = std::fs::File::create(&file_path).unwrap();
    writeln!(
        file,
        r#"{{"type":"user","uuid":"u1","parentUuid":null,"isSidechain":false,"cwd":"/tmp","message":{{"role":"user","content":"first"}}}}"#
    )
    .unwrap();

    let meta = SessionFileMetadata::default();
    let (msgs, _, new_offset) = parse_jsonl_incremental(&file_path, 0, &meta).unwrap();
    assert_eq!(msgs.len(), 1);
    assert!(new_offset > 0);

    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn test_incremental_reads_only_new_lines() {
    let dir = test_dir("incr_new");
    let file_path = dir.join("session.jsonl");

    let mut file = std::fs::File::create(&file_path).unwrap();
    writeln!(
        file,
        r#"{{"type":"user","uuid":"u1","parentUuid":null,"isSidechain":false,"cwd":"/tmp","message":{{"role":"user","content":"first"}}}}"#
    )
    .unwrap();

    let meta = SessionFileMetadata::default();
    let (msgs1, meta1, offset1) = parse_jsonl_incremental(&file_path, 0, &meta).unwrap();
    assert_eq!(msgs1.len(), 1);

    let mut file = std::fs::OpenOptions::new()
        .append(true)
        .open(&file_path)
        .unwrap();
    writeln!(
        file,
        r#"{{"type":"user","uuid":"u2","parentUuid":null,"isSidechain":false,"cwd":"/tmp","message":{{"role":"user","content":"second"}}}}"#
    )
    .unwrap();

    let (msgs2, _, offset2) = parse_jsonl_incremental(&file_path, offset1, &meta1).unwrap();
    assert_eq!(msgs2.len(), 1);
    assert_eq!(msgs2[0].uuid, "u2");
    assert!(offset2 > offset1);

    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn test_incremental_no_new_data() {
    let dir = test_dir("incr_no_new");
    let file_path = dir.join("session.jsonl");

    let mut file = std::fs::File::create(&file_path).unwrap();
    writeln!(
        file,
        r#"{{"type":"user","uuid":"u1","parentUuid":null,"isSidechain":false,"cwd":"/tmp","message":{{"role":"user","content":"only"}}}}"#
    )
    .unwrap();

    let meta = SessionFileMetadata::default();
    let (_, meta1, offset1) = parse_jsonl_incremental(&file_path, 0, &meta).unwrap();

    let (msgs, _, offset2) = parse_jsonl_incremental(&file_path, offset1, &meta1).unwrap();
    assert!(msgs.is_empty());
    assert_eq!(offset1, offset2);

    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn test_incremental_preserves_existing_metadata() {
    let dir = test_dir("incr_meta");
    let file_path = dir.join("session.jsonl");

    let mut file = std::fs::File::create(&file_path).unwrap();
    writeln!(file, r#"{{"type":"custom-title","customTitle":"My Title"}}"#).unwrap();

    let meta = SessionFileMetadata::default();
    let (_, meta1, offset1) = parse_jsonl_incremental(&file_path, 0, &meta).unwrap();
    assert_eq!(meta1.custom_title.as_deref(), Some("My Title"));

    let mut file = std::fs::OpenOptions::new()
        .append(true)
        .open(&file_path)
        .unwrap();
    writeln!(
        file,
        r#"{{"type":"user","uuid":"u1","parentUuid":null,"isSidechain":false,"cwd":"/tmp","message":{{"role":"user","content":"hi"}}}}"#
    )
    .unwrap();

    let (msgs, meta2, _) = parse_jsonl_incremental(&file_path, offset1, &meta1).unwrap();
    assert_eq!(msgs.len(), 1);
    assert_eq!(meta2.custom_title.as_deref(), Some("My Title"));

    let _ = std::fs::remove_dir_all(&dir);
}
