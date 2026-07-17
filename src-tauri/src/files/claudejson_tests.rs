//! Ports `claudejson_test.go` — census/triage, per-value reveal masking, whole
//! masked read, retry-error contract, and backup enumeration + bad-name guards.

use std::collections::HashMap;

use super::claudejson_test_support::*;
use super::*;

fn index_keys(keys: &[ClaudeJsonKey]) -> HashMap<String, ClaudeJsonKey> {
    keys.iter().map(|k| (k.name.clone(), k.clone())).collect()
}

fn assert_try_again(err: &str) {
    let msg = err.to_lowercase();
    assert!(msg.contains("try again"), "error should say 'try again', got {err:?}");
    assert!(
        !msg.contains("corrupt") && !msg.contains("repair"),
        "error must never say corrupt/repair, got {err:?}"
    );
}

#[test]
fn read_claude_json_census() {
    let h = claude_json_home();
    let live_on_disk = h.home.join("liveworkdir");
    std::fs::create_dir_all(&live_on_disk).unwrap();
    let live_on_disk = live_on_disk.to_string_lossy().into_owned();
    // Encoded projects/ dir decoding to a hyphen-free, on-disk-absent path.
    std::fs::create_dir_all(h.home.join(".claude").join("projects").join("-zzz-livehist-projectx"))
        .unwrap();
    write_claude_json(&h.home, &fixture_content_bytes(&live_on_disk), 0o644);

    let census = read_claude_json().expect("read_claude_json");
    let top = index_keys(&census.top_level);
    let flags = index_keys(&census.flags);

    assert!(!top.contains_key("projects"), "projects must not appear in TopLevel");
    for flag in ["hasSeenTasksHint", "cachedChangelog"] {
        assert!(flags.contains_key(flag), "flag {flag:?} missing from Flags group");
        assert!(!top.contains_key(flag), "flag {flag:?} leaked into TopLevel");
    }

    assert!(top["oauthAccount"].secret, "oauthAccount must be flagged secret (key match)");
    assert_eq!(top["oauthAccount"].kind, "object");
    assert!(top["helper"].secret, "helper must be flagged secret (value shape match)");
    assert!(!top["theme"].secret, "theme must not be flagged secret");
    assert_eq!(top["theme"].kind, "string");
    assert_eq!(top["numStartups"].kind, "number");

    let triage: HashMap<String, String> = census
        .projects
        .iter()
        .map(|p| (p.path.clone(), p.triage.clone()))
        .collect();
    let want = [
        (live_on_disk.as_str(), "live"),
        ("/zzz_stale_project_dir", "stale"),
        ("/zzz-unverifiable-dir", "unverifiable"),
        ("/zzz/livehist/projectx", "live"),
    ];
    for (path, exp) in want {
        assert_eq!(triage.get(path).map(String::as_str), Some(exp), "triage[{path:?}]");
    }
}

#[test]
fn reveal_claude_json_value_masks_secrets() {
    let h = claude_json_home();
    let live = h.home.join("liveworkdir").to_string_lossy().into_owned();
    write_claude_json(&h.home, &fixture_content_bytes(&live), 0o644);

    assert_eq!(reveal_claude_json_value("theme").unwrap(), "\"dark\"");

    let oauth = reveal_claude_json_value("oauthAccount").unwrap();
    assert!(!oauth.contains(FIXTURE_EMAIL), "reveal oauthAccount leaked email: {oauth:?}");
    assert!(oauth.contains(CLAUDE_JSON_MASK), "reveal oauthAccount not masked: {oauth:?}");

    let helper = reveal_claude_json_value("helper").unwrap();
    assert!(!helper.contains(FIXTURE_TOKEN), "reveal helper leaked token: {helper:?}");

    assert!(reveal_claude_json_value("nope").is_err(), "reveal of missing key must error");
}

#[test]
fn read_claude_json_masked_hides_secrets() {
    let h = claude_json_home();
    let live = h.home.join("liveworkdir").to_string_lossy().into_owned();
    write_claude_json(&h.home, &fixture_content_bytes(&live), 0o644);

    let masked = read_claude_json_masked().unwrap();
    assert!(
        !masked.contains(FIXTURE_EMAIL) && !masked.contains(FIXTURE_TOKEN),
        "masked live read leaked secrets: {masked:?}"
    );
    assert!(masked.contains(CLAUDE_JSON_MASK), "masked live read not masked");
    assert!(masked.contains("dark"), "masked live read dropped non-secret value");
}

#[test]
fn read_claude_json_retry_error_missing_file() {
    let _h = claude_json_home(); // no .claude.json written
    let err = read_claude_json().expect_err("expected error for missing file");
    assert_try_again(&err);
}

#[test]
fn read_claude_json_retry_error_invalid_json() {
    let h = claude_json_home();
    std::fs::write(h.home.join(".claude.json"), b"{not valid").unwrap();
    let err = read_claude_json().expect_err("expected error for invalid JSON");
    assert_try_again(&err);
}

#[test]
fn claude_json_backups_enumerate_and_mask() {
    let h = claude_json_home();
    let backups_dir = h.home.join(".claude").join("backups");
    let backup_content = serde_json::to_vec(&serde_json::json!({
        "helper": FIXTURE_TOKEN,
        "oauthAccount": {"emailAddress": FIXTURE_EMAIL},
        "theme": "dark"
    }))
    .unwrap();
    let names = [".claude.json.backup.1783695046813", ".claude.json.backup.1783698012205"];
    for name in names {
        std::fs::write(backups_dir.join(name), &backup_content).unwrap();
    }
    // Non-backup sibling must be ignored by enumeration.
    std::fs::write(backups_dir.join("notes.txt"), b"x").unwrap();

    let backups = list_claude_json_backups().unwrap();
    assert_eq!(backups.len(), 2, "want 2 backups");

    let masked = read_claude_json_backup(names[0]).unwrap();
    assert!(
        !masked.contains(FIXTURE_EMAIL) && !masked.contains(FIXTURE_TOKEN),
        "backup read leaked secrets: {masked:?}"
    );
    assert!(masked.contains(CLAUDE_JSON_MASK), "backup read not masked");
    assert!(masked.contains("dark"), "backup read dropped non-secret value");
}

#[test]
fn read_claude_json_backup_rejects_bad_names() {
    let _h = claude_json_home();
    let bad = [
        "",
        "..",
        ".",
        "../../../etc/passwd",
        "evil.txt",
        "foo/.claude.json.backup.1",
        "..claude.json.backup.1", // contains ".."
        ".claude.json.backup",    // missing timestamp suffix
    ];
    for name in bad {
        assert!(
            read_claude_json_backup(name).is_err(),
            "expected read_claude_json_backup({name:?}) to be rejected"
        );
    }
}
