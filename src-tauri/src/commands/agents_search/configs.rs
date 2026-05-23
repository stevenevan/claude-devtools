use serde_json::Value;

use crate::watcher;

/// Read agent config files from .claude/agents/*.md.
#[tauri::command]
pub fn read_agent_configs(
    project_root: String,
) -> Result<Value, String> {
    let agents_dir = std::path::Path::new(&project_root)
        .join(".claude")
        .join("agents");

    let mut configs = serde_json::Map::new();

    if agents_dir.is_dir() {
        if let Ok(entries) = std::fs::read_dir(&agents_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.extension().and_then(|e| e.to_str()) == Some("md") {
                    if let Ok(content) = std::fs::read_to_string(&path) {
                        let name = path
                            .file_stem()
                            .unwrap_or_default()
                            .to_string_lossy()
                            .to_string();
                        configs.insert(name, serde_json::json!({
                            "content": content,
                            "path": path.to_string_lossy(),
                        }));
                    }
                }
            }
        }
    }

    Ok(Value::Object(configs))
}

// ---------------------------------------------------------------------------
// Global ~/.claude/ config readers
// ---------------------------------------------------------------------------

/// Parse YAML-like frontmatter from markdown content.
fn parse_frontmatter(content: &str) -> std::collections::HashMap<String, String> {
    let mut map = std::collections::HashMap::new();
    let trimmed = content.trim_start();
    if !trimmed.starts_with("---") {
        return map;
    }
    if let Some(end) = trimmed[3..].find("\n---") {
        let block = &trimmed[3..3 + end];
        for line in block.lines() {
            let line = line.trim();
            if let Some(colon_pos) = line.find(':') {
                let key = line[..colon_pos].trim().to_string();
                let val = line[colon_pos + 1..].trim().to_string();
                if !key.is_empty() {
                    map.insert(key, val);
                }
            }
        }
    }
    map
}

#[tauri::command]
pub fn read_global_agents() -> Result<Value, String> {
    let claude_dir = watcher::resolve_claude_dir().ok_or("Cannot resolve home directory")?;
    let agents_dir = claude_dir.join("agents");

    let mut agents = Vec::new();

    if agents_dir.is_dir() {
        if let Ok(entries) = std::fs::read_dir(&agents_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.extension().and_then(|e| e.to_str()) == Some("md") {
                    if let Ok(content) = std::fs::read_to_string(&path) {
                        let fm = parse_frontmatter(&content);
                        let name = fm
                            .get("name")
                            .cloned()
                            .unwrap_or_else(|| {
                                path.file_stem()
                                    .unwrap_or_default()
                                    .to_string_lossy()
                                    .to_string()
                            });
                        agents.push(serde_json::json!({
                            "name": name,
                            "description": fm.get("description").cloned().unwrap_or_default(),
                            "tools": fm.get("tools").cloned().unwrap_or_default(),
                            "model": fm.get("model").cloned().unwrap_or_default(),
                            "filePath": path.to_string_lossy(),
                            "content": content,
                        }));
                    }
                }
            }
        }
    }

    agents.sort_by(|a, b| {
        let a_name = a.get("name").and_then(|v| v.as_str()).unwrap_or("");
        let b_name = b.get("name").and_then(|v| v.as_str()).unwrap_or("");
        a_name.cmp(b_name)
    });

    Ok(Value::Array(agents))
}

#[tauri::command]
pub fn read_global_skills() -> Result<Value, String> {
    let claude_dir = watcher::resolve_claude_dir().ok_or("Cannot resolve home directory")?;
    let skills_dir = claude_dir.join("skills");

    let mut skills = Vec::new();

    if skills_dir.is_dir() {
        if let Ok(entries) = std::fs::read_dir(&skills_dir) {
            for entry in entries.flatten() {
                let symlink_path = entry.path();

                let file_name = entry.file_name().to_string_lossy().to_string();
                if file_name.starts_with('.') {
                    continue;
                }

                let resolved_path = match std::fs::canonicalize(&symlink_path) {
                    Ok(p) => p,
                    Err(_) => continue,
                };

                if !resolved_path.is_dir() {
                    continue;
                }

                let skill_md = resolved_path.join("SKILL.md");
                let (description, user_invocable) = if skill_md.is_file() {
                    if let Ok(content) = std::fs::read_to_string(&skill_md) {
                        let fm = parse_frontmatter(&content);
                        let desc = fm.get("description").cloned().unwrap_or_default();
                        let invocable = fm.get("user-invocable")
                            .map(|v| v == "true")
                            .unwrap_or(false);
                        (desc, invocable)
                    } else {
                        (String::new(), false)
                    }
                } else {
                    (String::new(), false)
                };

                skills.push(serde_json::json!({
                    "name": file_name,
                    "description": description,
                    "userInvocable": user_invocable,
                    "resolvedPath": resolved_path.to_string_lossy(),
                    "symlinkPath": symlink_path.to_string_lossy(),
                }));
            }
        }
    }

    skills.sort_by(|a, b| {
        let a_name = a.get("name").and_then(|v| v.as_str()).unwrap_or("");
        let b_name = b.get("name").and_then(|v| v.as_str()).unwrap_or("");
        a_name.cmp(b_name)
    });

    Ok(Value::Array(skills))
}

#[tauri::command]
pub fn read_global_plugins() -> Result<Value, String> {
    let claude_dir = watcher::resolve_claude_dir().ok_or("Cannot resolve home directory")?;

    let plugins_file = claude_dir.join("plugins").join("installed_plugins.json");
    let plugins_data: Value = if plugins_file.is_file() {
        let content = std::fs::read_to_string(&plugins_file).map_err(|e| e.to_string())?;
        serde_json::from_str(&content).map_err(|e| e.to_string())?
    } else {
        return Ok(Value::Array(Vec::new()));
    };

    let settings_file = claude_dir.join("settings.json");
    let enabled_plugins: std::collections::HashSet<String> = if settings_file.is_file() {
        if let Ok(content) = std::fs::read_to_string(&settings_file) {
            if let Ok(settings) = serde_json::from_str::<Value>(&content) {
                if let Some(plugins) = settings.get("enabledPlugins").and_then(|v| v.as_object()) {
                    plugins.iter()
                        .filter(|(_, v)| v.as_bool().unwrap_or(false))
                        .map(|(k, _)| k.clone())
                        .collect()
                } else {
                    std::collections::HashSet::new()
                }
            } else {
                std::collections::HashSet::new()
            }
        } else {
            std::collections::HashSet::new()
        }
    } else {
        std::collections::HashSet::new()
    };

    let mut result = Vec::new();

    if let Some(plugins_map) = plugins_data.get("plugins").and_then(|v| v.as_object()) {
        for (key, entries) in plugins_map {
            let (name, marketplace) = if let Some(at_pos) = key.find('@') {
                (key[..at_pos].to_string(), key[at_pos + 1..].to_string())
            } else {
                (key.clone(), String::new())
            };

            if let Some(entry) = entries.as_array().and_then(|arr| arr.first()) {
                let enabled = enabled_plugins.contains(key)
                    || enabled_plugins.contains(&name);

                result.push(serde_json::json!({
                    "id": key,
                    "name": name,
                    "marketplace": marketplace,
                    "version": entry.get("version").and_then(|v| v.as_str()).unwrap_or(""),
                    "installedAt": entry.get("installedAt").and_then(|v| v.as_str()).unwrap_or(""),
                    "lastUpdated": entry.get("lastUpdated").and_then(|v| v.as_str()).unwrap_or(""),
                    "enabled": enabled,
                }));
            }
        }
    }

    result.sort_by(|a, b| {
        let a_name = a.get("name").and_then(|v| v.as_str()).unwrap_or("");
        let b_name = b.get("name").and_then(|v| v.as_str()).unwrap_or("");
        a_name.cmp(b_name)
    });

    Ok(Value::Array(result))
}

#[tauri::command]
pub fn read_global_settings() -> Result<Value, String> {
    let claude_dir = watcher::resolve_claude_dir().ok_or("Cannot resolve home directory")?;
    let settings_file = claude_dir.join("settings.json");

    if settings_file.is_file() {
        let content = std::fs::read_to_string(&settings_file).map_err(|e| e.to_string())?;
        let value: Value = serde_json::from_str(&content).map_err(|e| e.to_string())?;
        Ok(value)
    } else {
        Ok(serde_json::json!({}))
    }
}
