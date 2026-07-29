//! `tempfile` is not a dep → use `std::env::temp_dir()` + a unique subdir
//! (never touches real `~/.claude` files), matching `filehistory_reader_tests.rs`.

use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use super::*;

const UUID: &str = "session-1";
const HASH: &str = "abc123";

fn make_temp_root() -> PathBuf {
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let n = COUNTER.fetch_add(1, Ordering::SeqCst);
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let dir = std::env::temp_dir().join(format!(
        "claude-checkpoint-origin-test-{}-{nanos}-{n}",
        std::process::id()
    ));
    fs::create_dir_all(&dir).unwrap();
    fs::canonicalize(&dir).unwrap()
}

/// Writes `<root>/projects/<project>/<UUID>.jsonl` with the given lines.
fn write_session(root: &PathBuf, project: &str, lines: &[String]) {
    let dir = root.join("projects").join(project);
    fs::create_dir_all(&dir).unwrap();
    fs::write(dir.join(format!("{UUID}.jsonl")), lines.join("\n")).unwrap();
}

/// One `file-history-snapshot` line carrying a single `trackedFileBackups` entry.
fn snapshot_line(key: &str, entry_json: &str) -> String {
    format!(
        r#"{{"type":"file-history-snapshot","snapshot":{{"trackedFileBackups":{{"{key}":{entry_json}}}}}}}"#
    )
}

fn entry(backup_name: &str, real_parent_dir: Option<&str>) -> String {
    match real_parent_dir {
        Some(dir) => format!(
            r#"{{"backupFileName":"{backup_name}","version":2,"backupTime":"2026-07-29T09:00:00.000Z","realParentDir":"{dir}"}}"#
        ),
        None => format!(
            r#"{{"backupFileName":"{backup_name}","version":2,"backupTime":"2026-07-29T09:00:00.000Z"}}"#
        ),
    }
}

fn resolve(root: &PathBuf) -> Option<CheckpointOrigin> {
    resolve_checkpoint_origin(&root.to_string_lossy(), UUID, HASH).expect("resolve")
}

#[test]
fn resolves_absolute_key_without_real_parent_dir() {
    let root = make_temp_root();
    write_session(
        &root,
        "-Users-me-proj",
        &[snapshot_line("/Users/me/proj/main.rs", &entry("abc123@v2", None))],
    );

    let origin = resolve(&root).expect("origin");
    assert_eq!(origin.real_path, "/Users/me/proj/main.rs");
    assert_eq!(
        origin.backup_time.as_deref(),
        Some("2026-07-29T09:00:00.000Z")
    );
}

#[test]
fn resolves_relative_key_via_real_parent_dir() {
    let root = make_temp_root();
    write_session(
        &root,
        "-Users-me-proj",
        &[snapshot_line(
            "scripts/build.ts",
            &entry("abc123@v2", Some("/Users/me/proj/scripts")),
        )],
    );

    // realParentDir already ends in `scripts`, so the join takes the key's
    // BASENAME — joining the whole key would double the directory.
    assert_eq!(
        resolve(&root).expect("origin").real_path,
        "/Users/me/proj/scripts/build.ts"
    );
}

#[test]
fn resolves_relative_key_via_session_cwd() {
    let root = make_temp_root();
    write_session(
        &root,
        "-Users-me-proj",
        &[
            r#"{"type":"user","cwd":"/Users/me/proj"}"#.to_string(),
            snapshot_line("scripts/build.ts", &entry("abc123@v2", None)),
        ],
    );

    // The largest shape bucket on disk: relative key, no realParentDir. Here
    // the FULL key is joined to cwd, not just its basename.
    assert_eq!(
        resolve(&root).expect("origin").real_path,
        "/Users/me/proj/scripts/build.ts"
    );
}

#[test]
fn resolves_v1_leaf_when_snapshot_only_names_v2() {
    let root = make_temp_root();
    write_session(
        &root,
        "-Users-me-proj",
        &[snapshot_line("/Users/me/proj/main.rs", &entry("abc123@v2", None))],
    );

    // The regression this module exists for: an exact `{hash}@v1` match would
    // find nothing, because the map only ever names the CURRENT backup.
    assert_eq!(
        resolve(&root).expect("origin").real_path,
        "/Users/me/proj/main.rs"
    );
}

#[test]
fn skips_null_backup_file_name() {
    let root = make_temp_root();
    write_session(
        &root,
        "-Users-me-proj",
        &[snapshot_line(
            "/Users/me/proj/main.rs",
            r#"{"backupFileName":null,"version":2,"backupTime":"2026-07-29T09:00:00.000Z"}"#,
        )],
    );

    assert!(resolve(&root).is_none(), "null backupFileName must not resolve");
}

#[test]
fn skips_string_valued_entry() {
    let root = make_temp_root();
    write_session(
        &root,
        "-Users-me-proj",
        &[snapshot_line("/Users/me/proj/main.rs", r#""abc123@v2""#)],
    );

    // The `Record<string, string>` shape declared in jsonl.ts — skipped, not
    // assumed away.
    assert!(resolve(&root).is_none(), "string entry must not resolve");
}

#[test]
fn skips_malformed_and_oversized_lines() {
    let root = make_temp_root();
    let oversized = format!("{{\"pad\":\"{}\"}}", "x".repeat(MAX_JSONL_LINE_BYTES + 1));
    write_session(
        &root,
        "-Users-me-proj",
        &[
            "{not json at all".to_string(),
            oversized,
            snapshot_line("/Users/me/proj/main.rs", &entry("abc123@v2", None)),
        ],
    );

    assert_eq!(
        resolve(&root).expect("origin").real_path,
        "/Users/me/proj/main.rs"
    );
}

#[test]
fn later_line_wins_backup_time() {
    let root = make_temp_root();
    write_session(
        &root,
        "-Users-me-proj",
        &[
            snapshot_line("/Users/me/proj/main.rs", &entry("abc123@v1", None)),
            snapshot_line(
                "/Users/me/proj/main.rs",
                r#"{"backupFileName":"abc123@v2","version":2,"backupTime":"2026-07-30T10:00:00.000Z"}"#,
            ),
        ],
    );

    let origin = resolve(&root).expect("origin");
    assert_eq!(origin.real_path, "/Users/me/proj/main.rs");
    assert_eq!(
        origin.backup_time.as_deref(),
        Some("2026-07-30T10:00:00.000Z")
    );
}

#[test]
fn fails_closed_on_two_distinct_paths_for_one_hash() {
    let root = make_temp_root();
    write_session(
        &root,
        "-Users-me-proj",
        &[
            snapshot_line("/Users/me/proj/main.rs", &entry("abc123@v1", None)),
            snapshot_line("/Users/me/other/main.rs", &entry("abc123@v2", None)),
        ],
    );

    assert!(
        resolve(&root).is_none(),
        "an ambiguous hash must not pre-aim an overwrite"
    );
}

#[test]
fn rejects_parent_dir_traversal_in_real_parent_dir() {
    let root = make_temp_root();
    write_session(
        &root,
        "-Users-me-proj",
        &[snapshot_line(
            "main.rs",
            &entry("abc123@v2", Some("/Users/me/proj/../../../etc")),
        )],
    );

    assert!(resolve(&root).is_none(), "`..` must never survive validation");
}

#[test]
fn rejects_key_with_no_final_component() {
    let root = make_temp_root();
    write_session(
        &root,
        "-Users-me-proj",
        &[snapshot_line(
            "..",
            &entry("abc123@v2", Some("/Users/me/proj")),
        )],
    );

    assert!(resolve(&root).is_none(), "`..` key has no basename to join");
}

#[test]
fn rejects_relative_result_when_cwd_is_unknown() {
    let root = make_temp_root();
    write_session(
        &root,
        "-Users-me-proj",
        &[snapshot_line("scripts/build.ts", &entry("abc123@v2", None))],
    );

    assert!(
        resolve(&root).is_none(),
        "no realParentDir and no cwd leaves nothing absolute to return"
    );
}

#[test]
fn fails_closed_when_uuid_exists_under_two_projects() {
    let root = make_temp_root();
    let line = snapshot_line("/Users/me/proj/main.rs", &entry("abc123@v2", None));
    write_session(&root, "-Users-me-proj", &[line.clone()]);
    write_session(&root, "-Users-me-other", &[line]);

    assert!(
        resolve(&root).is_none(),
        "read_dir order must not decide the overwrite target"
    );
}

#[test]
fn missing_session_file_resolves_to_none() {
    let root = make_temp_root();
    fs::create_dir_all(root.join("projects").join("-Users-me-proj")).unwrap();

    assert!(resolve(&root).is_none());
}

#[test]
fn missing_projects_dir_resolves_to_none() {
    let root = make_temp_root();

    assert!(resolve(&root).is_none());
}

#[test]
fn rejects_traversal_in_ids() {
    let root = make_temp_root();
    let root_str = root.to_string_lossy().into_owned();

    assert!(resolve_checkpoint_origin(&root_str, "../escape", HASH).is_err());
    assert!(resolve_checkpoint_origin(&root_str, UUID, "../escape").is_err());
}
