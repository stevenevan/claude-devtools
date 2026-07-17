//! Ports `settings_sources_test.go` — read-only enumeration + merged provenance.
//! `$HOME` is redirected to a temp dir (never the real `~/.claude`).

use std::path::PathBuf;

use crate::files::settings_write::test_home::{redirect_home, unique_temp_dir, write_settings_file, HomeGuard};

use super::{
    enumerate_settings_sources, Source, KIND_GLOBAL, KIND_GLOBAL_NESTED_ANOMALY, KIND_PROJECT,
    KIND_PROJECT_LOCAL,
};

const TEST_SECRET_VALUE: &str = "sk-ant-secret123";

/// Builds the global (with a real-looking secret), nested-anomaly, project and
/// project-local sources. Mirrors `sourcesFixture`.
fn sources_fixture() -> (HomeGuard, PathBuf) {
    let h = redirect_home();
    let project_root = unique_temp_dir("settings-project");
    std::fs::create_dir_all(&project_root).unwrap();

    let global_dir = h.claude_dir.clone();
    write_settings_file(
        &global_dir,
        &global_dir.join("settings.json"),
        &format!(
            r#"{{
            "theme": "dark",
            "env": {{"ANTHROPIC_API_KEY": "{TEST_SECRET_VALUE}"}},
            "permissions": {{"defaultMode": "acceptEdits"}}
        }}"#
        ),
    );

    let nested_dir = global_dir.join(".claude");
    write_settings_file(
        &nested_dir,
        &nested_dir.join("settings.local.json"),
        r#"{"permissions": {"allow": ["Bash(rm:*)"]}}"#,
    );

    let project_dir = project_root.join(".claude");
    write_settings_file(
        &project_dir,
        &project_dir.join("settings.json"),
        r#"{"theme": "light"}"#,
    );
    write_settings_file(
        &project_dir,
        &project_dir.join("settings.local.json"),
        r#"{"customFlag": true}"#,
    );

    (h, project_root)
}

fn find_source<'a>(sources: &'a [Source], kind: &str) -> Option<&'a Source> {
    sources.iter().find(|s| s.kind == kind)
}

#[test]
fn all_four_surfaced() {
    let (h, project_root) = sources_fixture();

    let view = enumerate_settings_sources(&project_root.to_string_lossy())
        .expect("enumerate_settings_sources");
    assert_eq!(view.sources.len(), 4, "{:?}", view.sources);

    let global = find_source(&view.sources, KIND_GLOBAL).expect("global");
    assert!(global.exists && !global.is_anomaly, "{global:?}");

    let nested = find_source(&view.sources, KIND_GLOBAL_NESTED_ANOMALY).expect("nested");
    assert!(nested.exists && nested.is_anomaly, "{nested:?}");

    let project = find_source(&view.sources, KIND_PROJECT).expect("project");
    assert!(project.exists && !project.is_anomaly, "{project:?}");

    let project_local = find_source(&view.sources, KIND_PROJECT_LOCAL).expect("project-local");
    assert!(project_local.exists && !project_local.is_anomaly, "{project_local:?}");
    drop(h);
}

#[test]
fn missing_project_sources_report_exists_false() {
    let h = redirect_home();
    let global_dir = h.claude_dir.clone();
    write_settings_file(
        &global_dir,
        &global_dir.join("settings.json"),
        r#"{"theme": "dark"}"#,
    );

    let project_root = unique_temp_dir("settings-project"); // no .claude/ dir at all
    std::fs::create_dir_all(&project_root).unwrap();

    let view = enumerate_settings_sources(&project_root.to_string_lossy())
        .expect("enumerate_settings_sources");
    assert_eq!(view.sources.len(), 3, "{:?}", view.sources);
    let project = find_source(&view.sources, KIND_PROJECT).expect("project");
    assert!(!project.exists, "{project:?}");
    drop(h);
}

#[test]
fn merged_provenance() {
    let (h, project_root) = sources_fixture();

    let view = enumerate_settings_sources(&project_root.to_string_lossy())
        .expect("enumerate_settings_sources");

    assert_eq!(view.merged["theme"], "light", "project should win over global");
    let project_settings_path = project_root
        .join(".claude")
        .join("settings.json")
        .to_string_lossy()
        .into_owned();
    assert_eq!(view.provenance["theme"], project_settings_path);

    let global_settings_path = h
        .home
        .join(".claude")
        .join("settings.json")
        .to_string_lossy()
        .into_owned();
    assert!(view.merged.contains_key("env"), "global-only key should survive");
    assert_eq!(view.provenance["env"], global_settings_path);

    assert_eq!(view.merged["customFlag"], true, "project-local key should survive");

    // The nested anomaly's key must never win the merge.
    assert_eq!(
        view.provenance["permissions"], global_settings_path,
        "nested anomaly must not win"
    );
    drop(h);
}

/// The SEC L2 no-leak case. The Rust port never logs, so there is no logger to
/// capture — the substance is: the parse-error path (corrupt project-local)
/// skips that source without erroring, and the secret stays in `raw` (unmasked
/// by design), never masked/dropped by enumeration.
#[test]
fn parse_error_path_skips_source_secret_stays_in_raw() {
    let (h, project_root) = sources_fixture();

    let view = enumerate_settings_sources(&project_root.to_string_lossy())
        .expect("normal path");
    let global = view
        .sources
        .iter()
        .find(|s| s.kind == KIND_GLOBAL)
        .expect("global");
    assert!(
        global.raw.contains(TEST_SECRET_VALUE),
        "raw is deliberately unmasked"
    );

    // Corrupt project-local to force the merge_sources parse-error path.
    let project_local_path = project_root.join(".claude").join("settings.local.json");
    std::fs::write(&project_local_path, "{not valid json").unwrap();

    let view = enumerate_settings_sources(&project_root.to_string_lossy())
        .expect("parse-error path");
    assert!(
        !view.merged.contains_key("customFlag"),
        "customFlag absent once project-local is unparseable"
    );
    drop(h);
}
