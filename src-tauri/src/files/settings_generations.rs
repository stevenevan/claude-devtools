//! Ports `internal/files/settings_generations.go` — allowlisted settings.json
//! "generations" the diff/restore panel may read. Every entry point gates on the
//! FIXED `SETTINGS_GENERATIONS` allowlist; an arbitrary path is never accepted.

use std::fs;
use std::io;

use super::settings_write::replace_settings_json;
use crate::config::root::claude_dir;

/// The FIXED allowlist of settings.json generations the diff/restore panel may
/// read — never an arbitrary path. Mirrors `settingsGenerations`.
const SETTINGS_GENERATIONS: [&str; 3] = [
    "settings.json",
    "settings.json.bak",
    "settings.json.pre-ponytail",
];

fn is_settings_generation(name: &str) -> bool {
    SETTINGS_GENERATIONS.contains(&name)
}

/// Returns the allowlisted generations that exist on disk. Mirrors
/// `ListSettingsGenerations`.
pub fn list_settings_generations() -> Result<Vec<String>, String> {
    let cd = claude_dir()?;
    let mut out = Vec::new();
    for g in SETTINGS_GENERATIONS {
        if let Ok(info) = fs::symlink_metadata(cd.join(g)) {
            if !info.is_dir() {
                out.push(g.to_string());
            }
        }
    }
    Ok(out)
}

/// Returns an allowlisted generation's raw JSON text (or "" if absent). Refuses
/// any name outside the allowlist. Mirrors `ReadSettingsGeneration`.
pub fn read_settings_generation(name: &str) -> Result<String, String> {
    if !is_settings_generation(name) {
        return Err(format!("files: {name:?} is not a settings generation"));
    }
    let cd = claude_dir()?;
    match fs::read(cd.join(name)) {
        Ok(data) => Ok(String::from_utf8_lossy(&data).into_owned()),
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(String::new()),
        Err(e) => Err(e.to_string()),
    }
}

/// Overwrites settings.json with the chosen generation through
/// `replace_settings_json` (current → .bak as-is, new parse-validated, atomic).
/// Mirrors `RestoreSettingsGeneration`.
pub fn restore_settings_generation(name: &str) -> Result<(), String> {
    if !is_settings_generation(name) {
        return Err(format!("files: {name:?} is not a settings generation"));
    }
    if name == "settings.json" {
        return Err("files: cannot restore settings.json onto itself".to_string());
    }
    let cd = claude_dir()?;
    let data = fs::read(cd.join(name)).map_err(|e| format!("files: read generation {name:?}: {e}"))?;
    replace_settings_json(&data)
}

#[cfg(test)]
#[path = "settings_generations_tests.rs"]
mod settings_generations_tests;
