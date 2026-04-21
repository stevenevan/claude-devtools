/// ConfigState — manages app configuration with load/save/CRUD operations.

use std::collections::HashSet;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use serde_json::Value;

use super::triggers;
use super::types::{
    merge_config_with_defaults, AppConfig, ClaudeRootInfo, HiddenSession, NotificationTrigger,
    PinnedSession,
};
use super::validation;

// ConfigState

pub struct ConfigState {
    config: AppConfig,
    config_path: PathBuf,
}

impl ConfigState {
    /// Create a new ConfigState, loading from disk or using defaults.
    pub fn new() -> Self {
        let config_path = resolve_config_path();
        let config = load_config_from_disk(&config_path);
        Self {
            config,
            config_path,
        }
    }

    #[cfg(test)]
    pub fn new_with_path(config_path: PathBuf) -> Self {
        let config = load_config_from_disk(&config_path);
        Self {
            config,
            config_path,
        }
    }

    // =========================================================================
    // Config Access
    // =========================================================================

    /// Get a clone of the full config (with snooze auto-expiry check).
    pub fn get_config(&mut self) -> AppConfig {
        self.auto_expire_snooze();
        self.config.clone()
    }

    /// Get the config file path.
    pub fn get_config_path(&self) -> &std::path::Path {
        &self.config_path
    }

    // =========================================================================
    // Section Update
    // =========================================================================

    /// Update a config section with validated partial data.
    pub fn update_config(&mut self, section: &str, data: &Value) -> Result<AppConfig, String> {
        let (section, validated) = validation::validate_config_update(section, data)?;

        match section.as_str() {
            "notifications" => {
                let obj = validated.as_object().unwrap();
                merge_json_into_notifications(&mut self.config.notifications, obj);
            }
            "general" => {
                let obj = validated.as_object().unwrap();
                merge_json_into_general(&mut self.config.general, obj);
            }
            "display" => {
                let obj = validated.as_object().unwrap();
                merge_json_into_display(&mut self.config.display, obj);
            }
            "httpServer" => {
                let obj = validated.as_object().unwrap();
                merge_json_into_http_server(&mut self.config.http_server, obj);
            }
            "ssh" => {
                let obj = validated.as_object().unwrap();
                merge_json_into_ssh(&mut self.config.ssh, obj);
            }
            _ => {}
        }

        self.save_config();
        Ok(self.get_config())
    }

    // =========================================================================
    // Ignore Regex
    // =========================================================================

    pub fn add_ignore_regex(&mut self, pattern: &str) -> Result<AppConfig, String> {
        let trimmed = pattern.trim();
        if trimmed.is_empty() {
            return Ok(self.get_config());
        }

        triggers::validate_regex_pattern(trimmed)?;

        if self
            .config
            .notifications
            .ignored_regex
            .contains(&trimmed.to_string())
        {
            return Ok(self.get_config());
        }

        self.config
            .notifications
            .ignored_regex
            .push(trimmed.to_string());
        self.save_config();
        Ok(self.get_config())
    }

    pub fn remove_ignore_regex(&mut self, pattern: &str) -> AppConfig {
        self.config
            .notifications
            .ignored_regex
            .retain(|p| p != pattern);
        self.save_config();
        self.get_config()
    }

    // =========================================================================
    // Ignore Repository
    // =========================================================================

    pub fn add_ignore_repository(&mut self, repository_id: &str) -> Result<AppConfig, String> {
        let trimmed = repository_id.trim();
        if trimmed.is_empty() {
            return Ok(self.get_config());
        }

        if self
            .config
            .notifications
            .ignored_repositories
            .contains(&trimmed.to_string())
        {
            return Ok(self.get_config());
        }

        self.config
            .notifications
            .ignored_repositories
            .push(trimmed.to_string());
        self.save_config();
        Ok(self.get_config())
    }

    pub fn remove_ignore_repository(&mut self, repository_id: &str) -> AppConfig {
        self.config
            .notifications
            .ignored_repositories
            .retain(|r| r != repository_id);
        self.save_config();
        self.get_config()
    }

    // =========================================================================
    // Snooze
    // =========================================================================

    pub fn snooze(&mut self, minutes: Option<u32>) -> AppConfig {
        let snooze_minutes = minutes.unwrap_or(self.config.notifications.snooze_minutes);
        let now_ms = now_millis();
        let until = now_ms + (snooze_minutes as f64) * 60_000.0;
        self.config.notifications.snoozed_until = Some(until);
        self.save_config();
        self.get_config()
    }

    pub fn clear_snooze(&mut self) -> AppConfig {
        self.config.notifications.snoozed_until = None;
        self.save_config();
        self.get_config()
    }

    // =========================================================================
    // Triggers
    // =========================================================================

    pub fn add_trigger(&mut self, trigger: NotificationTrigger) -> Result<AppConfig, String> {
        if self
            .config
            .notifications
            .triggers
            .iter()
            .any(|t| t.id == trigger.id)
        {
            return Err(format!("Trigger with ID \"{}\" already exists", trigger.id));
        }

        triggers::validate_trigger(&trigger).map_err(|errs| errs.join(", "))?;

        self.config.notifications.triggers.push(trigger);
        self.save_config();
        Ok(self.get_config())
    }

    pub fn update_trigger(
        &mut self,
        trigger_id: &str,
        updates: &Value,
    ) -> Result<AppConfig, String> {
        let idx = self
            .config
            .notifications
            .triggers
            .iter()
            .position(|t| t.id == trigger_id)
            .ok_or_else(|| format!("Trigger with ID \"{trigger_id}\" not found"))?;

        // Clone, merge updates (excluding isBuiltin)
        let mut updated = self.config.notifications.triggers[idx].clone();
        if let Some(obj) = updates.as_object() {
            merge_trigger_updates(&mut updated, obj);
        }

        // Ensure mode is set
        if updated.mode.is_empty() {
            updated.mode = triggers::infer_mode(&updated);
        }

        triggers::validate_trigger(&updated).map_err(|errs| errs.join(", "))?;

        self.config.notifications.triggers[idx] = updated;
        self.save_config();
        Ok(self.get_config())
    }

    pub fn remove_trigger(&mut self, trigger_id: &str) -> Result<AppConfig, String> {
        let trigger = self
            .config
            .notifications
            .triggers
            .iter()
            .find(|t| t.id == trigger_id)
            .ok_or_else(|| format!("Trigger with ID \"{trigger_id}\" not found"))?;

        if trigger.is_builtin == Some(true) {
            return Err("Cannot remove built-in triggers. Disable them instead.".to_string());
        }

        self.config
            .notifications
            .triggers
            .retain(|t| t.id != trigger_id);
        self.save_config();
        Ok(self.get_config())
    }

    pub fn get_triggers(&self) -> Vec<NotificationTrigger> {
        self.config.notifications.triggers.clone()
    }

    // =========================================================================
    // Session Pinning
    // =========================================================================

    pub fn pin_session(&mut self, project_id: &str, session_id: &str) {
        let pins = self
            .config
            .sessions
            .pinned_sessions
            .entry(project_id.to_string())
            .or_default();

        if pins.iter().any(|p| p.session_id == session_id) {
            return;
        }

        pins.insert(
            0,
            PinnedSession {
                session_id: session_id.to_string(),
                pinned_at: now_millis(),
            },
        );
        self.save_config();
    }

    pub fn unpin_session(&mut self, project_id: &str, session_id: &str) {
        if let Some(pins) = self.config.sessions.pinned_sessions.get_mut(project_id) {
            pins.retain(|p| p.session_id != session_id);
            if pins.is_empty() {
                self.config.sessions.pinned_sessions.remove(project_id);
            }
            self.save_config();
        }
    }

    // =========================================================================
    // Session Hiding
    // =========================================================================

    pub fn hide_session(&mut self, project_id: &str, session_id: &str) {
        let hidden = self
            .config
            .sessions
            .hidden_sessions
            .entry(project_id.to_string())
            .or_default();

        if hidden.iter().any(|h| h.session_id == session_id) {
            return;
        }

        hidden.insert(
            0,
            HiddenSession {
                session_id: session_id.to_string(),
                hidden_at: now_millis(),
            },
        );
        self.save_config();
    }

    pub fn unhide_session(&mut self, project_id: &str, session_id: &str) {
        if let Some(hidden) = self.config.sessions.hidden_sessions.get_mut(project_id) {
            hidden.retain(|h| h.session_id != session_id);
            if hidden.is_empty() {
                self.config.sessions.hidden_sessions.remove(project_id);
            }
            self.save_config();
        }
    }

    pub fn hide_sessions(&mut self, project_id: &str, session_ids: &[String]) {
        let hidden = self
            .config
            .sessions
            .hidden_sessions
            .entry(project_id.to_string())
            .or_default();

        let existing: HashSet<&str> = hidden.iter().map(|h| h.session_id.as_str()).collect();
        let now = now_millis();

        let mut new_entries: Vec<HiddenSession> = session_ids
            .iter()
            .filter(|id| !existing.contains(id.as_str()))
            .map(|id| HiddenSession {
                session_id: id.clone(),
                hidden_at: now,
            })
            .collect();

        if new_entries.is_empty() {
            return;
        }

        new_entries.append(hidden);
        *hidden = new_entries;
        self.save_config();
    }

    pub fn unhide_sessions(&mut self, project_id: &str, session_ids: &[String]) {
        if let Some(hidden) = self.config.sessions.hidden_sessions.get_mut(project_id) {
            let to_remove: HashSet<&str> = session_ids.iter().map(|s| s.as_str()).collect();
            hidden.retain(|h| !to_remove.contains(h.session_id.as_str()));
            if hidden.is_empty() {
                self.config.sessions.hidden_sessions.remove(project_id);
            }
            self.save_config();
        }
    }

    // =========================================================================
    // Claude Root Info
    // =========================================================================

    pub fn get_claude_root_info(&self) -> ClaudeRootInfo {
        let default_path = dirs::home_dir()
            .map(|h| h.join(".claude").to_string_lossy().to_string())
            .unwrap_or_else(|| "~/.claude".to_string());

        let configured = self.config.general.claude_root_path.clone();
        let effective = configured.clone().unwrap_or_else(|| default_path.clone());

        ClaudeRootInfo {
            default_path,
            configured_path: configured,
            effective_path: effective,
        }
    }

    // =========================================================================
    // SSH Last Connection
    // =========================================================================

    pub fn update_ssh_last_connection(
        &mut self,
        last_connection: Option<super::types::SshLastConnection>,
    ) {
        self.config.ssh.last_connection = last_connection;
        self.save_config();
    }

    // =========================================================================
    // Bookmarks
    // =========================================================================

    pub fn add_bookmark(&mut self, entry: super::types::BookmarkEntry) {
        self.config.sessions.bookmarks.push(entry);
        self.save_config();
    }

    pub fn remove_bookmark(&mut self, bookmark_id: &str) {
        self.config.sessions.bookmarks.retain(|b| b.id != bookmark_id);
        self.save_config();
    }

    pub fn get_bookmarks(&self) -> &[super::types::BookmarkEntry] {
        &self.config.sessions.bookmarks
    }

    // =========================================================================
    // Annotations
    // =========================================================================

    pub fn add_annotation(&mut self, entry: super::types::AnnotationEntry) {
        self.config.sessions.annotations.push(entry);
        self.save_config();
    }

    pub fn update_annotation(
        &mut self,
        annotation_id: &str,
        text: Option<String>,
        color: Option<String>,
        updated_at: f64,
    ) -> bool {
        let Some(entry) = self
            .config
            .sessions
            .annotations
            .iter_mut()
            .find(|a| a.id == annotation_id)
        else {
            return false;
        };
        if let Some(t) = text {
            entry.text = t;
        }
        if let Some(c) = color {
            entry.color = c;
        }
        entry.updated_at = updated_at;
        self.save_config();
        true
    }

    pub fn remove_annotation(&mut self, annotation_id: &str) {
        self.config
            .sessions
            .annotations
            .retain(|a| a.id != annotation_id);
        self.save_config();
    }

    pub fn get_annotations(&self) -> &[super::types::AnnotationEntry] {
        &self.config.sessions.annotations
    }

    // =========================================================================
    // Session Tags
    // =========================================================================

    pub fn set_session_tags(&mut self, session_id: &str, tags: Vec<String>) {
        if tags.is_empty() {
            self.config.sessions.session_tags.remove(session_id);
        } else {
            self.config.sessions.session_tags.insert(session_id.to_string(), tags);
        }
        self.save_config();
    }

    pub fn get_session_tags(&self, session_id: &str) -> Vec<String> {
        self.config.sessions.session_tags.get(session_id).cloned().unwrap_or_default()
    }

    // =========================================================================
    // Session Groups
    // =========================================================================

    pub fn create_session_group(&mut self, name: &str) -> bool {
        if self.config.sessions.session_groups.contains_key(name) {
            return false;
        }
        self.config
            .sessions
            .session_groups
            .insert(name.to_string(), vec![]);
        self.save_config();
        true
    }

    pub fn delete_session_group(&mut self, name: &str) {
        self.config.sessions.session_groups.remove(name);
        self.save_config();
    }

    pub fn add_to_session_group(&mut self, name: &str, session_id: &str) {
        let entry = self
            .config
            .sessions
            .session_groups
            .entry(name.to_string())
            .or_default();
        if !entry.iter().any(|s| s == session_id) {
            entry.push(session_id.to_string());
            self.save_config();
        }
    }

    pub fn remove_from_session_group(&mut self, name: &str, session_id: &str) {
        if let Some(entry) = self.config.sessions.session_groups.get_mut(name) {
            entry.retain(|s| s != session_id);
            self.save_config();
        }
    }

    pub fn get_session_groups(&self) -> &std::collections::HashMap<String, Vec<String>> {
        &self.config.sessions.session_groups
    }

    // =========================================================================
    // Internal
    // =========================================================================

    fn save_config(&self) {
        let config_dir = self.config_path.parent();
        if let Some(dir) = config_dir {
            if !dir.exists() {
                let _ = std::fs::create_dir_all(dir);
            }
        }

        match serde_json::to_string_pretty(&self.config) {
            Ok(content) => {
                // Atomic write: write to temp, then rename
                let tmp_path = self.config_path.with_extension("tmp");
                if std::fs::write(&tmp_path, &content).is_ok() {
                    let _ = std::fs::rename(&tmp_path, &self.config_path);
                } else {
                    // Fallback: direct write
                    let _ = std::fs::write(&self.config_path, &content);
                }
            }
            Err(e) => {
                eprintln!("[config] Error serializing config: {e}");
            }
        }
    }

    fn auto_expire_snooze(&mut self) {
        if let Some(until) = self.config.notifications.snoozed_until {
            if now_millis() >= until {
                self.config.notifications.snoozed_until = None;
                self.save_config();
            }
        }
    }
}

// Helpers

fn resolve_config_path() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("/tmp"))
        .join(".claude")
        .join("claude-devtools-config.json")
}

fn load_config_from_disk(path: &std::path::Path) -> AppConfig {
    match std::fs::read_to_string(path) {
        Ok(content) => match serde_json::from_str::<Value>(&content) {
            Ok(value) => merge_config_with_defaults(&value),
            Err(_) => AppConfig::default(),
        },
        Err(_) => AppConfig::default(),
    }
}

fn now_millis() -> f64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as f64
}

// JSON merge helpers for partial updates

fn merge_json_into_notifications(
    notif: &mut super::types::NotificationConfig,
    obj: &serde_json::Map<String, Value>,
) {
    if let Some(v) = obj.get("enabled").and_then(|v| v.as_bool()) {
        notif.enabled = v;
    }
    if let Some(v) = obj.get("soundEnabled").and_then(|v| v.as_bool()) {
        notif.sound_enabled = v;
    }
    if let Some(v) = obj.get("includeSubagentErrors").and_then(|v| v.as_bool()) {
        notif.include_subagent_errors = v;
    }
    if let Some(v) = obj.get("ignoredRegex") {
        if let Ok(arr) = serde_json::from_value::<Vec<String>>(v.clone()) {
            notif.ignored_regex = arr;
        }
    }
    if let Some(v) = obj.get("ignoredRepositories") {
        if let Ok(arr) = serde_json::from_value::<Vec<String>>(v.clone()) {
            notif.ignored_repositories = arr;
        }
    }
    if let Some(v) = obj.get("snoozedUntil") {
        notif.snoozed_until = v.as_f64();
    }
    if let Some(v) = obj.get("snoozeMinutes").and_then(|v| v.as_u64()) {
        notif.snooze_minutes = v as u32;
    }
    if let Some(v) = obj.get("triggers") {
        if let Ok(triggers) = serde_json::from_value::<Vec<NotificationTrigger>>(v.clone()) {
            notif.triggers = triggers;
        }
    }
}

fn merge_json_into_general(general: &mut super::types::GeneralConfig, obj: &serde_json::Map<String, Value>) {
    if let Some(v) = obj.get("launchAtLogin").and_then(|v| v.as_bool()) {
        general.launch_at_login = v;
    }
    if let Some(v) = obj.get("showDockIcon").and_then(|v| v.as_bool()) {
        general.show_dock_icon = v;
    }
    if let Some(v) = obj.get("theme").and_then(|v| v.as_str()) {
        general.theme = v.to_string();
    }
    if let Some(v) = obj.get("defaultTab").and_then(|v| v.as_str()) {
        general.default_tab = v.to_string();
    }
    if let Some(v) = obj.get("claudeRootPath") {
        general.claude_root_path = if v.is_null() {
            None
        } else {
            v.as_str().map(|s| s.to_string())
        };
    }
    if let Some(v) = obj.get("autoExpandAIGroups").and_then(|v| v.as_bool()) {
        general.auto_expand_ai_groups = v;
    }
    if let Some(v) = obj.get("useNativeTitleBar").and_then(|v| v.as_bool()) {
        general.use_native_title_bar = v;
    }
}

fn merge_json_into_display(display: &mut super::types::DisplayConfig, obj: &serde_json::Map<String, Value>) {
    if let Some(v) = obj.get("showTimestamps").and_then(|v| v.as_bool()) {
        display.show_timestamps = v;
    }
    if let Some(v) = obj.get("compactMode").and_then(|v| v.as_bool()) {
        display.compact_mode = v;
    }
    if let Some(v) = obj.get("syntaxHighlighting").and_then(|v| v.as_bool()) {
        display.syntax_highlighting = v;
    }
}

fn merge_json_into_http_server(
    http: &mut super::types::HttpServerConfig,
    obj: &serde_json::Map<String, Value>,
) {
    if let Some(v) = obj.get("enabled").and_then(|v| v.as_bool()) {
        http.enabled = v;
    }
    if let Some(v) = obj.get("port").and_then(|v| v.as_u64()) {
        http.port = v as u16;
    }
}

fn merge_json_into_ssh(ssh: &mut super::types::SshPersistConfig, obj: &serde_json::Map<String, Value>) {
    if let Some(v) = obj.get("autoReconnect").and_then(|v| v.as_bool()) {
        ssh.auto_reconnect = v;
    }
    if let Some(v) = obj.get("lastActiveContextId").and_then(|v| v.as_str()) {
        ssh.last_active_context_id = v.to_string();
    }
    if let Some(v) = obj.get("lastConnection") {
        if v.is_null() {
            ssh.last_connection = None;
        } else if let Ok(conn) = serde_json::from_value(v.clone()) {
            ssh.last_connection = Some(conn);
        }
    }
    if let Some(v) = obj.get("profiles") {
        if let Ok(profiles) = serde_json::from_value(v.clone()) {
            ssh.profiles = profiles;
        }
    }
}

fn merge_trigger_updates(trigger: &mut NotificationTrigger, obj: &serde_json::Map<String, Value>) {
    // Skip isBuiltin — cannot be changed
    if let Some(v) = obj.get("name").and_then(|v| v.as_str()) {
        trigger.name = v.to_string();
    }
    if let Some(v) = obj.get("enabled").and_then(|v| v.as_bool()) {
        trigger.enabled = v;
    }
    if let Some(v) = obj.get("contentType").and_then(|v| v.as_str()) {
        trigger.content_type = v.to_string();
    }
    if let Some(v) = obj.get("mode").and_then(|v| v.as_str()) {
        trigger.mode = v.to_string();
    }
    if let Some(v) = obj.get("toolName") {
        trigger.tool_name = v.as_str().map(|s| s.to_string());
    }
    if let Some(v) = obj.get("requireError") {
        trigger.require_error = v.as_bool();
    }
    if let Some(v) = obj.get("matchField") {
        trigger.match_field = v.as_str().map(|s| s.to_string());
    }
    if let Some(v) = obj.get("matchPattern") {
        trigger.match_pattern = v.as_str().map(|s| s.to_string());
    }
    if let Some(v) = obj.get("tokenThreshold") {
        trigger.token_threshold = v.as_f64();
    }
    if let Some(v) = obj.get("tokenType") {
        trigger.token_type = v.as_str().map(|s| s.to_string());
    }
    if let Some(v) = obj.get("ignorePatterns") {
        if let Ok(arr) = serde_json::from_value::<Vec<String>>(v.clone()) {
            trigger.ignore_patterns = Some(arr);
        }
    }
    if let Some(v) = obj.get("repositoryIds") {
        if let Ok(arr) = serde_json::from_value::<Vec<String>>(v.clone()) {
            trigger.repository_ids = Some(arr);
        }
    }
    if let Some(v) = obj.get("color") {
        trigger.color = v.as_str().map(|s| s.to_string());
    }
}

#[cfg(test)]
mod tests {
    use super::super::types::AnnotationEntry;
    use super::*;

    fn temp_config() -> ConfigState {
        let tmp = std::env::temp_dir()
            .join(format!("cd-cfg-{}-{}", std::process::id(), now_millis() as u64));
        std::fs::create_dir_all(&tmp).unwrap();
        ConfigState::new_with_path(tmp.join("config.json"))
    }

    #[test]
    fn annotation_crud_roundtrip() {
        let mut state = temp_config();
        assert!(state.get_annotations().is_empty());

        let entry = AnnotationEntry {
            id: "a1".to_string(),
            session_id: "s1".to_string(),
            project_id: "p1".to_string(),
            target_id: "t1".to_string(),
            text: "first".to_string(),
            color: "blue".to_string(),
            created_at: 1.0,
            updated_at: 1.0,
        };
        state.add_annotation(entry.clone());
        assert_eq!(state.get_annotations().len(), 1);
        assert_eq!(state.get_annotations()[0].text, "first");

        let updated =
            state.update_annotation("a1", Some("second".to_string()), Some("red".to_string()), 2.0);
        assert!(updated);
        assert_eq!(state.get_annotations()[0].text, "second");
        assert_eq!(state.get_annotations()[0].color, "red");
        assert_eq!(state.get_annotations()[0].updated_at, 2.0);

        assert!(!state.update_annotation("missing", Some("x".into()), None, 3.0));

        state.remove_annotation("a1");
        assert!(state.get_annotations().is_empty());
    }
}
