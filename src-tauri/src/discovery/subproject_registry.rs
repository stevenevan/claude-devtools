/// Subproject registry — tracks composite project IDs for multi-cwd projects.
///
/// When sessions in the same encoded directory have different `cwd` values,
/// they are split into separate projects with composite IDs: `{encodedPath}::{hash}`.

use std::collections::{HashMap, HashSet};

use sha2::{Digest, Sha256};

/// Entry in the subproject registry.
#[derive(Debug, Clone)]
pub struct SubprojectEntry {
    pub cwd: String,
    pub session_ids: HashSet<String>,
}

/// Registry of composite project IDs.
#[derive(Debug, Default)]
pub struct SubprojectRegistry {
    entries: HashMap<String, SubprojectEntry>,
}

impl SubprojectRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    /// Register a subproject and return its composite ID.
    pub fn register(
        &mut self,
        base_dir: &str,
        cwd: &str,
        session_ids: Vec<String>,
    ) -> String {
        let hash = compute_cwd_hash(cwd);
        let composite_id = format!("{base_dir}::{hash}");

        let entry = self.entries.entry(composite_id.clone()).or_insert_with(|| {
            SubprojectEntry {
                cwd: cwd.to_string(),
                session_ids: HashSet::new(),
            }
        });

        for id in session_ids {
            entry.session_ids.insert(id);
        }

        composite_id
    }

    /// Get the session filter for a composite project ID.
    /// Returns None if the project ID is not composite.
    pub fn get_session_filter(&self, project_id: &str) -> Option<&HashSet<String>> {
        self.entries.get(project_id).map(|e| &e.session_ids)
    }

    /// Check if a project ID is a composite ID.
    pub fn is_composite(project_id: &str) -> bool {
        project_id.contains("::")
    }

    /// Clear the registry.
    pub fn clear(&mut self) {
        self.entries.clear();
    }
}

/// Compute the 8-character hex hash of a cwd string.
fn compute_cwd_hash(cwd: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(cwd.as_bytes());
    let result = hasher.finalize();
    hex_encode(&result[..4]) // 4 bytes = 8 hex chars
}

fn hex_encode(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_register_and_get_filter() {
        let mut registry = SubprojectRegistry::new();
        let id = registry.register(
            "-Users-name-project",
            "/Users/name/project",
            vec!["sess1".to_string(), "sess2".to_string()],
        );

        assert!(id.starts_with("-Users-name-project::"));
        assert_eq!(id.len(), "-Users-name-project::".len() + 8);

        let filter = registry.get_session_filter(&id).unwrap();
        assert!(filter.contains("sess1"));
        assert!(filter.contains("sess2"));
    }

    #[test]
    fn test_is_composite() {
        assert!(SubprojectRegistry::is_composite(
            "-Users-name-project::abcdef01"
        ));
        assert!(!SubprojectRegistry::is_composite("-Users-name-project"));
    }

    #[test]
    fn test_consistent_hash() {
        let hash1 = compute_cwd_hash("/Users/name/project");
        let hash2 = compute_cwd_hash("/Users/name/project");
        assert_eq!(hash1, hash2);
        assert_eq!(hash1.len(), 8);
    }

    #[test]
    fn test_different_cwds_different_hashes() {
        let hash1 = compute_cwd_hash("/Users/name/project1");
        let hash2 = compute_cwd_hash("/Users/name/project2");
        assert_ne!(hash1, hash2);
    }

    #[test]
    fn test_clear() {
        let mut registry = SubprojectRegistry::new();
        registry.register(
            "-Users-name-project",
            "/Users/name/project",
            vec!["sess1".to_string()],
        );
        registry.clear();
        assert!(registry.entries.is_empty());
    }
}
