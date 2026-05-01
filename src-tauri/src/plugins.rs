/// Plugin discovery (sprint 38).
///
/// The host *only* enumerates plugin files on disk. All execution happens
/// in a sandboxed Web Worker on the renderer side — Rust never evaluates
/// plugin JavaScript.

use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PluginEntry {
    pub id: String,
    pub path: String,
}

fn plugins_dir() -> Result<PathBuf, String> {
    if let Ok(override_path) = std::env::var("CLAUDE_DEVTOOLS_PLUGINS_DIR") {
        return Ok(PathBuf::from(override_path));
    }
    let home = dirs::home_dir().ok_or_else(|| "Cannot resolve home directory".to_string())?;
    Ok(home.join(".claude-devtools").join("plugins"))
}

pub fn discover_plugins(dir: &Path) -> Vec<PluginEntry> {
    let entries = match fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return Vec::new(),
    };
    let mut out = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        if path.extension().and_then(|s| s.to_str()) != Some("js") {
            continue;
        }
        let id = match path.file_stem().and_then(|s| s.to_str()) {
            Some(s) => s.to_string(),
            None => continue,
        };
        out.push(PluginEntry {
            id,
            path: path.to_string_lossy().to_string(),
        });
    }
    out.sort_by(|a, b| a.id.cmp(&b.id));
    out
}

#[tauri::command]
pub fn plugins_discover() -> Result<Vec<PluginEntry>, String> {
    let dir = plugins_dir()?;
    if !dir.exists() {
        return Ok(Vec::new());
    }
    Ok(discover_plugins(&dir))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn discover_only_js_files() {
        let tmp = std::env::temp_dir().join(format!("plugins-test-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&tmp).expect("mkdir");
        fs::write(tmp.join("hello.js"), "// noop").unwrap();
        fs::write(tmp.join("ignored.txt"), "skip").unwrap();
        fs::write(tmp.join("README.md"), "skip").unwrap();
        fs::create_dir_all(tmp.join("subdir")).unwrap();

        let found = discover_plugins(&tmp);
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].id, "hello");

        fs::remove_dir_all(&tmp).ok();
    }

    #[test]
    fn missing_dir_returns_empty() {
        let tmp = std::env::temp_dir().join(format!("plugins-missing-{}", uuid::Uuid::new_v4()));
        let found = discover_plugins(&tmp);
        assert!(found.is_empty());
    }
}
