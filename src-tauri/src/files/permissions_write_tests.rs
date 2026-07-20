//! Ports `internal/files/permissions_write_test.go`. Uses the shared
//! `settings_write::test_home` scaffolding (process-wide env lock + temp `$HOME`)
//! so parallel Rust tests never clobber each other's home — and NEVER touch the
//! real `~/.claude`. Every project file lives under a fresh temp dir.

use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};

use serde_json::Value;

use super::{
    add_permission_rule, get_permission_rules, move_permission_rule, PermissionRuleRow,
    PermissionScope, PERM_ALLOW, PERM_ASK, PERM_DENY, SCOPE_GLOBAL, SCOPE_PROJECT_LOCAL,
};
use crate::files::settings_sources::{KIND_GLOBAL, KIND_PROJECT, KIND_PROJECT_LOCAL};
use crate::files::settings_write::test_home::{
    redirect_home, unique_temp_dir, write_settings_file, HomeGuard,
};

/// Seeds a temp `$HOME` global settings.json and a temp project with committed
/// (.claude/settings.json) + project-local (.claude/settings.local.json) files.
fn permissions_fixture() -> (HomeGuard, PathBuf) {
    let guard = redirect_home();
    write_settings_file(
        &guard.claude_dir,
        &guard.claude_dir.join("settings.json"),
        r#"{
    "permissions": {"defaultMode": "acceptEdits", "allow": ["Bash(ls:*)"], "deny": ["Bash(rm:*)"]}
}"#,
    );

    let project_root = unique_temp_dir("perm-project");
    let project_dir = project_root.join(".claude");
    write_settings_file(
        &project_dir,
        &project_dir.join("settings.json"),
        r#"{"permissions": {"allow": ["Read(*)"]}}"#,
    );
    write_settings_file(
        &project_dir,
        &project_dir.join("settings.local.json"),
        r#"{"permissions": {"ask": ["Bash(git:*)"]}}"#,
    );
    (guard, project_root)
}

fn scope_global() -> PermissionScope {
    PermissionScope {
        kind: SCOPE_GLOBAL.to_string(),
        project_root: String::new(),
    }
}

fn scope_project_local(root: &Path) -> PermissionScope {
    PermissionScope {
        kind: SCOPE_PROJECT_LOCAL.to_string(),
        project_root: root.to_string_lossy().into_owned(),
    }
}

fn find_rule<'a>(rows: &'a [PermissionRuleRow], rule: &str) -> Option<&'a PermissionRuleRow> {
    rows.iter().find(|r| r.rule == rule)
}

fn read_permission_list(path: &Path, list: &str) -> Vec<String> {
    let Ok(raw) = fs::read(path) else {
        return Vec::new();
    };
    let m: Value = serde_json::from_slice(&raw).expect("parse json");
    m.get("permissions")
        .and_then(Value::as_object)
        .and_then(|p| p.get(list))
        .and_then(Value::as_array)
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_str().map(str::to_string))
                .collect()
        })
        .unwrap_or_default()
}

fn contains_str(xs: &[String], want: &str) -> bool {
    xs.iter().any(|x| x == want)
}

fn with_bak(path: &Path) -> PathBuf {
    let mut os = path.as_os_str().to_os_string();
    os.push(".bak");
    PathBuf::from(os)
}

fn mode_of(path: &Path) -> u32 {
    fs::metadata(path).unwrap().permissions().mode() & 0o777
}

#[test]
fn get_permission_rules_three_sources() {
    let (guard, project_root) = permissions_fixture();
    let view = get_permission_rules(project_root.to_str().unwrap()).expect("get rules");

    let global = guard
        .claude_dir
        .join("settings.json")
        .to_string_lossy()
        .into_owned();
    let proj = project_root
        .join(".claude")
        .join("settings.json")
        .to_string_lossy()
        .into_owned();
    let proj_local = project_root
        .join(".claude")
        .join("settings.local.json")
        .to_string_lossy()
        .into_owned();

    let cases = [
        ("Bash(ls:*)", PERM_ALLOW, KIND_GLOBAL, &global, true),
        ("Bash(rm:*)", PERM_DENY, KIND_GLOBAL, &global, true),
        ("Read(*)", PERM_ALLOW, KIND_PROJECT, &proj, false),
        ("Bash(git:*)", PERM_ASK, KIND_PROJECT_LOCAL, &proj_local, true),
    ];
    for (rule, list, kind, path, writable) in cases {
        let row = find_rule(&view.rows, rule).unwrap_or_else(|| panic!("rule {rule} missing"));
        assert_eq!(row.list, list, "rule {rule} list");
        assert_eq!(row.source_kind, kind, "rule {rule} kind");
        assert_eq!(&row.source_path, path, "rule {rule} path");
        assert_eq!(row.writable, writable, "rule {rule} writable");
    }
}

#[test]
fn move_permission_rule_round_trip() {
    let (guard, project_root) = permissions_fixture();
    let global = guard.claude_dir.join("settings.json");
    let project_local = project_root.join(".claude").join("settings.local.json");

    move_permission_rule(
        scope_global(),
        scope_project_local(&project_root),
        PERM_ALLOW,
        PERM_ASK,
        "Bash(ls:*)",
    )
    .expect("move");

    assert!(
        !contains_str(&read_permission_list(&global, PERM_ALLOW), "Bash(ls:*)"),
        "rule still present in global allow after move"
    );
    assert!(
        contains_str(&read_permission_list(&project_local, PERM_ASK), "Bash(ls:*)"),
        "rule missing from project-local ask after move"
    );
}

#[test]
fn add_permission_rule_crash_between_invariant() {
    let (guard, project_root) = permissions_fixture();
    let global = guard.claude_dir.join("settings.json");
    let project_local = project_root.join(".claude").join("settings.local.json");

    // Only the add half runs (target write); the remove never happens.
    add_permission_rule(scope_project_local(&project_root), PERM_ASK, "Bash(ls:*)").expect("add");

    assert!(
        contains_str(&read_permission_list(&project_local, PERM_ASK), "Bash(ls:*)"),
        "rule not present in target after add"
    );
    assert!(
        contains_str(&read_permission_list(&global, PERM_ALLOW), "Bash(ls:*)"),
        "rule vanished from source before remove ran"
    );
}

#[test]
fn add_permission_rule_global_preserves_unknown_keys() {
    let (guard, _project_root) = permissions_fixture();
    let global = guard.claude_dir.join("settings.json");

    write_settings_file(
        &guard.claude_dir,
        &global,
        r#"{
    "theme": "dark",
    "permissions": {"defaultMode": "acceptEdits", "allow": ["Bash(ls:*)"]}
}"#,
    );

    add_permission_rule(scope_global(), PERM_DENY, "Bash(rm:*)").expect("add");

    let got: Value = serde_json::from_slice(&fs::read(&global).unwrap()).expect("parse");
    assert_eq!(
        got.get("theme").and_then(Value::as_str),
        Some("dark"),
        "theme preserved"
    );
    assert_eq!(
        got.get("permissions")
            .and_then(|p| p.get("defaultMode"))
            .and_then(Value::as_str),
        Some("acceptEdits"),
        "permissions.defaultMode preserved"
    );
    assert!(
        contains_str(&read_permission_list(&global, PERM_DENY), "Bash(rm:*)"),
        "added deny rule missing"
    );
    assert!(
        contains_str(&read_permission_list(&global, PERM_ALLOW), "Bash(ls:*)"),
        "existing allow rule dropped"
    );
}

#[test]
fn add_permission_rule_project_local_preserves_keys_and_uses_own_bak() {
    let (_guard, project_root) = permissions_fixture();
    let project_dir = project_root.join(".claude");
    let project_local = project_dir.join("settings.local.json");

    write_settings_file(
        &project_dir,
        &project_local,
        r#"{
    "customFlag": true,
    "env": {"SECRET": "shh"},
    "permissions": {"ask": ["Bash(git:*)"]}
}"#,
    );
    let seed = fs::read(&project_local).expect("read seed");

    add_permission_rule(scope_project_local(&project_root), PERM_ALLOW, "Read(src/*)").expect("add");

    let got: Value = serde_json::from_slice(&fs::read(&project_local).unwrap()).expect("parse");
    assert_eq!(
        got.get("customFlag").and_then(Value::as_bool),
        Some(true),
        "customFlag preserved"
    );
    assert_eq!(
        got.get("env")
            .and_then(|e| e.get("SECRET"))
            .and_then(Value::as_str),
        Some("shh"),
        "env.SECRET preserved"
    );
    assert!(
        contains_str(&read_permission_list(&project_local, PERM_ALLOW), "Read(src/*)"),
        "added allow rule missing"
    );

    // project-local must use its OWN .bak holding the pre-mutation bytes.
    let bak = with_bak(&project_local);
    assert_eq!(
        fs::read(&bak).expect("settings.local.json.bak not written"),
        seed,
        "project-local .bak does not hold pre-mutation content"
    );
    // Both .bak and the final file are 0o600 (may hold env secrets).
    assert_eq!(mode_of(&bak), 0o600, "project-local .bak mode");
    assert_eq!(mode_of(&project_local), 0o600, "settings.local.json mode");
}

#[test]
fn add_permission_rule_first_ever_grant_creates_local_settings() {
    let _guard = redirect_home();
    let project_root = unique_temp_dir("perm-first");
    fs::create_dir_all(&project_root).unwrap();

    let project_local = project_root.join(".claude").join("settings.local.json");
    assert!(
        !project_local.exists(),
        "precondition: settings.local.json should not exist yet"
    );

    add_permission_rule(scope_project_local(&project_root), PERM_DENY, "Bash(curl:*)")
        .expect("first-ever grant");

    assert!(
        contains_str(&read_permission_list(&project_local, PERM_DENY), "Bash(curl:*)"),
        "first-ever grant did not create settings.local.json with the rule"
    );
    // No pre-existing file → no .bak.
    assert!(
        !with_bak(&project_local).exists(),
        "expected no .bak for first-ever grant"
    );
}

#[test]
fn add_permission_rule_invalid_list_rejected_before_write() {
    let guard = redirect_home();
    let settings_file = guard.claude_dir.join("settings.json");

    let err = add_permission_rule(scope_global(), "bogus", "Bash(ls:*)")
        .expect_err("expected error for invalid list");
    assert_eq!(
        err,
        "files: invalid permission list \"bogus\" (want allow|deny|ask)"
    );
    assert!(
        !settings_file.exists(),
        "settings.json should not have been written"
    );
}

#[test]
fn add_permission_rule_display_only_kind_rejected_before_write() {
    let _guard = redirect_home();
    let project_root = unique_temp_dir("perm-display");
    fs::create_dir_all(&project_root).unwrap();
    let project_local = project_root.join(".claude").join("settings.local.json");

    // KIND_PROJECT is display-only and must never reach the writer.
    let err = add_permission_rule(
        PermissionScope {
            kind: KIND_PROJECT.to_string(),
            project_root: project_root.to_string_lossy().into_owned(),
        },
        PERM_ALLOW,
        "Read(*)",
    )
    .expect_err("expected error for display-only scope kind");
    assert_eq!(
        err,
        "files: invalid permission scope kind \"project\" (want global|project-local)"
    );
    assert!(
        !project_local.exists(),
        "settings.local.json should not have been written"
    );
}
