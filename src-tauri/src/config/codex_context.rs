//! Shared Codex project-context validation used by settings and inventory.

use std::fs;
use std::path::{Path, PathBuf};

pub const MAX_PROFILE_NAME_BYTES: usize = 64;

#[derive(Debug, Clone)]
pub struct ResolvedCodexProjectContext {
    pub project_root: PathBuf,
    pub working_directory: PathBuf,
    pub profile: Option<String>,
}

/// Normalize an already server-selected project context. The caller supplies
/// the operation label so existing settings errors remain actionable and
/// stable while inventory gets its own context in diagnostics.
pub fn normalize_project_context(
    project_root: &str,
    working_directory: Option<&str>,
    profile: Option<&str>,
    operation: &str,
) -> Result<ResolvedCodexProjectContext, String> {
    let project_root = validate_directory(project_root, "project root", operation)?;
    let working_directory = match working_directory {
        None => project_root.clone(),
        Some(value) if value.trim().is_empty() => {
            return Err(format!("{operation}: working directory must not be empty"));
        }
        Some(value) => validate_directory(value, "working directory", operation)?,
    };
    if !working_directory.starts_with(&project_root) {
        return Err(format!(
            "{operation}: working directory must be inside the selected project root"
        ));
    }
    let profile = profile
        .map(|value| validate_profile_name(value, operation))
        .transpose()?;
    Ok(ResolvedCodexProjectContext {
        project_root,
        working_directory,
        profile,
    })
}

fn validate_directory(value: &str, label: &str, operation: &str) -> Result<PathBuf, String> {
    let path = Path::new(value.trim());
    if !path.is_absolute() {
        return Err(format!("{operation}: {label} must be an absolute path"));
    }
    let canonical = fs::canonicalize(path)
        .map_err(|_| format!("{operation}: {label} must be an existing directory"))?;
    if !fs::metadata(&canonical)
        .map(|metadata| metadata.is_dir())
        .unwrap_or(false)
    {
        return Err(format!(
            "{operation}: {label} must be an existing directory"
        ));
    }
    Ok(canonical)
}

fn validate_profile_name(value: &str, operation: &str) -> Result<String, String> {
    if value.is_empty()
        || value.len() > MAX_PROFILE_NAME_BYTES
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
    {
        return Err(format!(
            "{operation}: profile must contain only letters, numbers, '-' or '_'"
        ));
    }
    Ok(value.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_working_directory_to_the_project_root() {
        let root = std::env::temp_dir().join(format!("codex-context-{}", std::process::id()));
        crate::testutil::remove_tree(&root);
        fs::create_dir_all(&root).expect("fixture root");

        let context = normalize_project_context(
            &root.to_string_lossy(),
            None,
            Some("review_1"),
            "codex inventory",
        )
        .expect("context");
        assert_eq!(context.project_root, context.working_directory);
        assert_eq!(context.profile.as_deref(), Some("review_1"));
        crate::testutil::remove_tree(root);
    }

    #[test]
    fn rejects_working_directory_outside_the_project() {
        let root = std::env::temp_dir().join(format!("codex-context-root-{}", std::process::id()));
        let outside =
            std::env::temp_dir().join(format!("codex-context-outside-{}", std::process::id()));
        crate::testutil::remove_tree(&root);
        crate::testutil::remove_tree(&outside);
        fs::create_dir_all(&root).expect("root");
        fs::create_dir_all(&outside).expect("outside");

        let error = normalize_project_context(
            &root.to_string_lossy(),
            Some(&outside.to_string_lossy()),
            None,
            "codex inventory",
        )
        .expect_err("outside working directory");
        assert!(error.contains("inside the selected project root"));
        crate::testutil::remove_tree(root);
        crate::testutil::remove_tree(outside);
    }
}
