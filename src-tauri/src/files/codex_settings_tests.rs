use std::fs;
use std::path::Path;

use super::{discover_at, CodexSettingsContext};

fn fixture(name: &str) -> std::path::PathBuf {
    let path = std::env::temp_dir().join(format!(
        "claude-codex-settings-{name}-{}",
        std::process::id()
    ));
    let _ = fs::remove_dir_all(&path);
    fs::create_dir_all(&path).expect("fixture root");
    path
}

fn context(project_root: &Path, working_directory: &Path) -> CodexSettingsContext {
    CodexSettingsContext {
        project_root: project_root.to_string_lossy().into_owned(),
        working_directory: Some(working_directory.to_string_lossy().into_owned()),
        profile: Some("review".to_string()),
    }
}

#[test]
fn trusted_nested_project_layer_wins_and_profile_is_projection() {
    let root = fixture("nested");
    let nested = root.join("src").join("app");
    fs::create_dir_all(nested.join(".codex")).expect("nested dirs");
    fs::create_dir_all(root.join(".codex")).expect("root dirs");
    let codex_home = root.join("codex-home");
    fs::create_dir_all(&codex_home).expect("codex home");
    fs::write(
        codex_home.join("config.toml"),
        format!(
            "model = \"user-model\"\n[projects.\"{}\"]\ntrust_level = \"trusted\"\n",
            root.display()
        ),
    )
    .expect("user config");
    fs::write(root.join(".codex/config.toml"), "model = \"root-model\"\n").expect("root config");
    fs::write(
        nested.join(".codex/config.toml"),
        "model = \"nested-model\"\n",
    )
    .expect("nested config");
    fs::write(
        codex_home.join("review.config.toml"),
        "sandbox_mode = \"workspace-write\"\n",
    )
    .expect("profile config");

    let view = discover_at(
        &codex_home,
        &context(&root, &nested),
        Some(&root.join("missing-system")),
    )
    .expect("discover");
    assert_eq!(view.trust.state, "trusted");
    assert_eq!(view.context.profile.as_deref(), Some("review"));
    assert!(view.context.profile_is_projection);
    assert_eq!(
        view.settings
            .iter()
            .find(|setting| setting.key == "model")
            .map(|setting| setting.value.scalar.as_deref()),
        Some(Some("nested-model"))
    );
    assert_eq!(
        view.settings
            .iter()
            .find(|setting| setting.key == "sandbox_mode")
            .map(|setting| setting.source_id.as_str()),
        Some("profile")
    );
    assert!(view
        .sources
        .iter()
        .all(|source| !source.label.contains(root.to_string_lossy().as_ref())));
    let _ = fs::remove_dir_all(root);
}

#[test]
fn missing_trust_keeps_project_values_inactive() {
    let root = fixture("untrusted");
    let codex_home = root.join("codex-home");
    fs::create_dir_all(root.join(".codex")).expect("project dirs");
    fs::create_dir_all(&codex_home).expect("codex home");
    fs::write(codex_home.join("config.toml"), "model = \"user-model\"\n").expect("user config");
    fs::write(
        root.join(".codex/config.toml"),
        "model = \"project-model\"\n",
    )
    .expect("project config");
    let view = discover_at(
        &codex_home,
        &context(&root, &root),
        Some(&root.join("missing-system")),
    )
    .expect("discover");
    assert_eq!(view.trust.state, "unknown");
    assert_eq!(view.settings[0].value.scalar.as_deref(), Some("user-model"));
    assert_eq!(view.sources[1].status, "inactive-unverified");
    let _ = fs::remove_dir_all(root);
}

#[test]
fn malformed_lower_source_does_not_hide_valid_user_value() {
    let root = fixture("malformed");
    let codex_home = root.join("codex-home");
    let system = root.join("system");
    fs::create_dir_all(&codex_home).expect("codex home");
    fs::create_dir_all(&system).expect("system");
    fs::write(codex_home.join("config.toml"), "model = \"safe-model\"\n").expect("user config");
    fs::write(system.join("config.toml"), "model = [\n").expect("system config");
    let view = discover_at(&codex_home, &context(&root, &root), Some(&system)).expect("discover");
    assert_eq!(
        view.settings
            .iter()
            .find(|setting| setting.key == "model")
            .and_then(|setting| setting.value.scalar.as_deref()),
        Some("safe-model")
    );
    assert!(view
        .diagnostics
        .iter()
        .any(|diagnostic| diagnostic.code == "invalid-toml"));
    let json = serde_json::to_string(&view).expect("serialize");
    assert!(!json.contains("model = ["));
    let _ = fs::remove_dir_all(root);
}

#[test]
fn secret_shaped_model_is_not_returned() {
    let root = fixture("redaction");
    let codex_home = root.join("codex-home");
    fs::create_dir_all(&codex_home).expect("codex home");
    fs::write(
        codex_home.join("config.toml"),
        "model = \"sk-super-secret-token\"\n",
    )
    .expect("user config");
    let view = discover_at(
        &codex_home,
        &context(&root, &root),
        Some(&root.join("missing-system")),
    )
    .expect("discover");
    assert!(!view.settings.iter().any(|setting| setting.key == "model"));
    let json = serde_json::to_string(&view).expect("serialize");
    assert!(!json.contains("sk-super-secret-token"));
    let _ = fs::remove_dir_all(root);
}

#[test]
fn system_value_can_be_overridden_by_a_safe_user_default() {
    let root = fixture("system-override");
    let codex_home = root.join("codex-home");
    let system = root.join("system");
    fs::create_dir_all(&codex_home).expect("codex home");
    fs::create_dir_all(&system).expect("system");
    fs::write(codex_home.join("config.toml"), "# user config\n").expect("user config");
    fs::write(system.join("config.toml"), "model = \"system-model\"\n").expect("system config");

    let view = discover_at(&codex_home, &context(&root, &root), Some(&system)).expect("discover");
    let model = view
        .settings
        .iter()
        .find(|setting| setting.key == "model")
        .expect("model");
    assert_eq!(model.source_id, "system");
    assert!(model.editable);
    assert_eq!(model.user_value, None);
    let _ = fs::remove_dir_all(root);
}

#[test]
fn managed_allowlists_are_bounded_and_not_exposed() {
    let root = fixture("managed-allowlists");
    let codex_home = root.join("codex-home");
    let system = root.join("system");
    fs::create_dir_all(&codex_home).expect("codex home");
    fs::create_dir_all(&system).expect("system");
    fs::write(
        codex_home.join("config.toml"),
        "approval_policy = \"on-request\"\nsandbox_mode = \"read-only\"\n",
    )
    .expect("user config");
    fs::write(
        system.join("requirements.toml"),
        "allowed_approval_policies = [\"on-request\", \"never\"]\nallowed_sandbox_modes = [\"read-only\"]\n\n[allowed_permission_profiles]\nsafe = true\n",
    )
    .expect("requirements");

    let view = discover_at(&codex_home, &context(&root, &root), Some(&system)).expect("discover");
    let approval = view
        .policy
        .constraints
        .iter()
        .find(|constraint| constraint.key == "approval_policy")
        .expect("approval constraint");
    assert_eq!(approval.value.kind, "allowedValues");
    assert!(view.policy.resolution == "incomplete");
    let json = serde_json::to_string(&view).expect("serialize");
    assert!(!json.contains("allowed_approval_policies"));
    assert!(!json.contains("never"));
    let _ = fs::remove_dir_all(root);
}

#[test]
fn granular_approval_and_default_permissions_are_read_only() {
    let root = fixture("policy");
    let codex_home = root.join("codex-home");
    fs::create_dir_all(&codex_home).expect("codex home");
    fs::write(
        codex_home.join("config.toml"),
        "approval_policy = { granular = { password = \"hunter2\", location = \"/private/path\" } }\nsandbox_mode = \"workspace-write\"\n\n[default_permissions]\nmode = \"safe\"\n",
    )
    .expect("user config");
    let view = discover_at(
        &codex_home,
        &context(&root, &root),
        Some(&root.join("missing-system")),
    )
    .expect("discover");
    let approval = view
        .settings
        .iter()
        .find(|setting| setting.key == "approval_policy");
    assert_eq!(
        approval.map(|setting| setting.value.kind.as_str()),
        Some("approvalGranular")
    );
    assert!(!approval.expect("approval").editable);
    let sandbox = view
        .settings
        .iter()
        .find(|setting| setting.key == "sandbox_mode");
    assert!(!sandbox.expect("sandbox").editable);
    assert!(view.policy.resolution == "incomplete");
    let json = serde_json::to_string(&view).expect("serialize");
    assert!(!json.contains("hunter2"));
    assert!(!json.contains("/private/path"));
    let _ = fs::remove_dir_all(root);
}
