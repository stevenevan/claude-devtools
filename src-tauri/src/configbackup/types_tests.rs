//! Ports the allowlist / id-guard cases from `configbackup_test.go`
//! (`TestValidateImportRejectsMaliciousEntries` + the segment-bounded matcher).

use super::*;

#[test]
fn allowlist_accepts_exact_top_level_files() {
    for rel in ["settings.json", "CLAUDE.md", "RTK.md"] {
        assert!(match_config_allowlist(rel), "{rel} should be allowlisted");
    }
    // segment-bounded: a textual sibling of an exact name is rejected.
    assert!(!match_config_allowlist("settings.jsonx"));
    assert!(!match_config_allowlist("CLAUDE.md.bak"));
}

#[test]
fn allowlist_accepts_dir_globs_any_depth() {
    for rel in [
        "rules/style.md",
        "rules/a/b/c.md",
        "commands/deploy.md",
        "tools/x/y/z.sh",
    ] {
        assert!(match_config_allowlist(rel), "{rel} should be allowlisted");
    }
    // bare dir (len==1) never matches; a prefix sibling never passes.
    assert!(!match_config_allowlist("rules"));
    assert!(!match_config_allowlist("rules-evil.md"));
    assert!(!match_config_allowlist("commands"));
}

#[test]
fn allowlist_agents_exactly_one_md() {
    assert!(match_config_allowlist("agents/helper.md"));
    assert!(!match_config_allowlist("agents/helper.txt"));
    assert!(!match_config_allowlist("agents/sub/deep.md")); // too deep
    assert!(!match_config_allowlist("agents")); // bare dir
}

#[test]
fn allowlist_memory_shapes() {
    assert!(match_config_allowlist("projects/-Users-x-proj/memory/MEMORY.md"));
    assert!(match_config_allowlist("projects/-Users-x-proj/memory/fact.md"));
    assert!(!match_config_allowlist("projects/x/memory")); // len 3, no file
    assert!(!match_config_allowlist("projects/x/evil.jsonl")); // wrong sub / ext
    assert!(!match_config_allowlist("projects/x/memory/nested/deep.md")); // len 5

    assert!(match_config_allowlist("agent-memory/foo/MEMORY.md"));
    assert!(!match_config_allowlist("agent-memory/foo")); // len 2
    assert!(!match_config_allowlist("agent-memory/foo/bar/baz.md")); // len 4
}

#[test]
fn allowlist_skills_shapes() {
    assert!(match_config_allowlist("skills/demo/SKILL.md"));
    assert!(match_config_allowlist("skills/demo/references/a.md"));
    assert!(match_config_allowlist("skills/demo/references/deep/nested.txt"));
    assert!(!match_config_allowlist("skills/demo/other.md")); // not SKILL.md
    assert!(!match_config_allowlist("skills/demo")); // len 2
    assert!(!match_config_allowlist("skills/demo/references")); // bare dir len 3
}

#[test]
fn allowlist_rejects_malicious_entries() {
    // Mirrors TestValidateImportRejectsMaliciousEntries's rejected shapes.
    for rel in [
        "../../evil",
        "/etc/evil",
        "agents/../../x",
        "projects/x/evil.jsonl",
        ".",
        "..",
        "",
    ] {
        assert!(!match_config_allowlist(rel), "{rel:?} must be rejected");
    }
}

#[test]
fn validate_backup_id_accepts_uuid_rejects_paths() {
    assert!(validate_backup_id("550e8400-e29b-41d4-a716-446655440000").is_ok());
    assert!(validate_backup_id("simple").is_ok());
    for bad in ["", ".", "..", "a/b", "/abs", "sub/dir", "./x"] {
        assert!(validate_backup_id(bad).is_err(), "{bad:?} must be rejected");
    }
}

#[test]
fn category_for_rel_buckets() {
    assert_eq!(category_for_rel("settings.json"), "settings");
    assert_eq!(category_for_rel("CLAUDE.md"), "instructions");
    assert_eq!(category_for_rel("RTK.md"), "instructions");
    assert_eq!(category_for_rel("rules/x.md"), "instructions");
    assert_eq!(category_for_rel("commands/x.md"), "instructions");
    assert_eq!(category_for_rel("tools/x.sh"), "instructions");
    assert_eq!(category_for_rel("agents/a.md"), "agents");
    assert_eq!(category_for_rel("projects/x/memory/y.md"), "memory");
    assert_eq!(category_for_rel("agent-memory/x/y.md"), "memory");
    assert_eq!(category_for_rel("skills/x/SKILL.md"), "skills");
    assert_eq!(category_for_rel("unknown.txt"), "");
}

#[test]
fn clean_path_matches_go_semantics() {
    assert_eq!(clean_path(""), ".");
    assert_eq!(clean_path("a/b/../c"), "a/c");
    assert_eq!(clean_path("agents/../../x"), "../x");
    assert_eq!(clean_path("rules//style.md"), "rules/style.md");
    assert_eq!(clean_path("./settings.json"), "settings.json");
    assert_eq!(clean_path("/etc/./evil"), "/etc/evil");
}
