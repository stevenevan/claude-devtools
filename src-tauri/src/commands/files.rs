use serde_json::Value;

#[tauri::command]
pub fn validate_path(
    relative_path: String,
    project_path: String,
) -> Result<Value, String> {
    let base = std::path::Path::new(&project_path);
    let joined = base.join(&relative_path);

    let canonical = joined.canonicalize().ok();
    let base_canonical = base.canonicalize().ok();

    if let (Some(ref c), Some(ref bc)) = (&canonical, &base_canonical) {
        if !c.starts_with(bc) {
            return Ok(serde_json::json!({ "exists": false }));
        }
    }

    let exists = joined.exists();
    let is_directory = joined.is_dir();

    Ok(serde_json::json!({
        "exists": exists,
        "isDirectory": is_directory,
    }))
}

#[tauri::command]
pub fn validate_mentions(
    mentions: Vec<Value>,
    project_path: String,
) -> Result<Value, String> {
    let base = std::path::Path::new(&project_path);
    let mut result = serde_json::Map::new();

    for mention in &mentions {
        if let Some(value) = mention.get("value").and_then(|v| v.as_str()) {
            let joined = base.join(value);
            result.insert(value.to_string(), Value::Bool(joined.exists()));
        }
    }

    Ok(Value::Object(result))
}

#[tauri::command]
pub fn read_claude_md_files(
    project_root: String,
) -> Result<Value, String> {
    let mut files = serde_json::Map::new();
    let root = std::path::Path::new(&project_root);

    if let Some(home) = dirs::home_dir() {
        let global = home.join(".claude").join("CLAUDE.md");
        if let Ok(content) = std::fs::read_to_string(&global) {
            files.insert("global".to_string(), serde_json::json!({
                "path": global.to_string_lossy(),
                "content": content,
                "exists": true,
            }));
        }
    }

    let project_md = root.join("CLAUDE.md");
    if let Ok(content) = std::fs::read_to_string(&project_md) {
        files.insert("project".to_string(), serde_json::json!({
            "path": project_md.to_string_lossy(),
            "content": content,
            "exists": true,
        }));
    }

    let rules_dir = root.join(".claude").join("rules");
    if rules_dir.is_dir() {
        if let Ok(entries) = std::fs::read_dir(&rules_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.extension().and_then(|e| e.to_str()) == Some("md") {
                    if let Ok(content) = std::fs::read_to_string(&path) {
                        let key = format!(
                            "rules/{}",
                            path.file_name().unwrap_or_default().to_string_lossy()
                        );
                        files.insert(key, serde_json::json!({
                            "path": path.to_string_lossy(),
                            "content": content,
                            "exists": true,
                        }));
                    }
                }
            }
        }
    }

    Ok(Value::Object(files))
}

#[tauri::command]
pub fn read_directory_claude_md(
    dir_path: String,
) -> Result<Value, String> {
    let md_path = std::path::Path::new(&dir_path).join("CLAUDE.md");
    if let Ok(content) = std::fs::read_to_string(&md_path) {
        Ok(serde_json::json!({
            "path": md_path.to_string_lossy(),
            "content": content,
            "exists": true,
        }))
    } else {
        Ok(serde_json::json!({
            "path": md_path.to_string_lossy(),
            "content": "",
            "exists": false,
        }))
    }
}

#[tauri::command]
pub fn read_mentioned_file(
    absolute_path: String,
    project_root: String,
    max_tokens: Option<usize>,
) -> Result<Option<Value>, String> {
    let path = std::path::Path::new(&absolute_path);

    let root = std::path::Path::new(&project_root);
    if let (Ok(cp), Ok(cr)) = (path.canonicalize(), root.canonicalize()) {
        if !cp.starts_with(&cr) {
            return Ok(None);
        }
    }

    if !path.exists() || !path.is_file() {
        return Ok(None);
    }

    match std::fs::read_to_string(path) {
        Ok(content) => {
            let tokens = content.len().div_ceil(4);
            let max = max_tokens.unwrap_or(100_000);
            let truncated = tokens > max;
            let final_content = if truncated {
                content[..max * 4].to_string()
            } else {
                content
            };

            Ok(Some(serde_json::json!({
                "path": absolute_path,
                "content": final_content,
                "exists": true,
                "tokens": tokens,
                "truncated": truncated,
            })))
        }
        Err(_) => Ok(None),
    }
}
