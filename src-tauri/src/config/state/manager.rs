//! `ConfigState`: the config manager ported from `internal/config/manager.go`.
//! Owns `AppConfig` behind an interior `Mutex` with lazy disk loading and atomic
//! (temp-file → rename) persistence. Every getter/setter locks per operation.
//!
//! Serde parity with the Go oracle: load merges a raw object over defaults so an
//! absent section keeps its default (Go pre-populates the dst struct before
//! `json.Unmarshal`), while `notifications`/`retention` overlay over a ZERO value
//! (Go uses a fresh `var`), so an absent bool loads as `false`, not the default
//! `true`. Numbers use `serde_json`'s int/float distinction, matching Go's
//! `json.Number`.

use std::collections::BTreeMap;
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::de::DeserializeOwned;
use serde::Serialize;
use serde_json::{Map, Value};

use super::triggers::{
    infer_mode, is_builtin_trigger, merge_triggers, validate_regex_pattern, validate_trigger,
};
use super::types::{
    AnnotationEntry, AnnotationExportBundle, AppConfig, BookmarkEntry, CustomTheme, FilterPreset,
    HiddenSession, ImportReport, NotificationConfig, NotificationTrigger, PinnedSession,
    RetentionCategory, RetentionPolicy, SshLastConnection, UiMode, WebhookEndpoint,
};
use super::validation::validate_config_update;
use crate::config::root::{claude_dir, get_claude_root_info, normalize_claude_root_path, ClaudeRootInfo};

// ─── clamp / normalize (shared with validation.rs) ────────────────────────────

const CUTOFF_DAYS_MIN: i64 = 1;
const CUTOFF_DAYS_MAX: i64 = 36500;

/// Mirrors `manager.go:clampCutoffDays`.
pub(super) fn clamp_cutoff_days(days: i64) -> i64 {
    days.clamp(CUTOFF_DAYS_MIN, CUTOFF_DAYS_MAX)
}

/// Mirrors `manager.go:normalizeScheduleInterval` — any unrecognized/empty value
/// maps to "off" so the scheduler never fires on a hand-edited/legacy config.
pub(super) fn normalize_schedule_interval(s: &str) -> String {
    match s {
        "weekly" | "monthly" => s.to_string(),
        _ => "off".to_string(),
    }
}

// ─── helpers ─────────────────────────────────────────────────────────────────

/// Mirrors `manager.go:nowMillis` — ms since Unix epoch as f64.
fn now_millis() -> f64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos() as f64 / 1e6)
        .unwrap_or(0.0)
}

/// Mirrors `manager.go:resolveConfigPath`.
fn resolve_config_path() -> PathBuf {
    claude_dir()
        .unwrap_or_else(|_| PathBuf::from("/tmp").join(".claude"))
        .join("claude-devtools-config.json")
}

/// Mirrors `manager.go:NewUUID`.
pub fn new_uuid() -> String {
    uuid::Uuid::new_v4().to_string()
}

/// Mirrors `manager.go:saveConfig`: serialise → temp file → rename (never
/// truncate-in-place).
fn save_config(config: &AppConfig, path: &Path) -> Result<(), String> {
    let data = serde_json::to_string_pretty(config)
        .map_err(|e| format!("config: marshal failed: {e}"))?;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| format!("config: mkdir failed: {e}"))?;
    }
    let mut tmp = path.as_os_str().to_owned();
    tmp.push(".tmp");
    let tmp = PathBuf::from(tmp);
    std::fs::write(&tmp, data.as_bytes()).map_err(|e| format!("config: write temp failed: {e}"))?;
    if let Err(e) = std::fs::rename(&tmp, path) {
        let _ = std::fs::remove_file(&tmp);
        return Err(format!("config: rename failed: {e}"));
    }
    Ok(())
}

/// Overlays `raw` (a JSON object) over `base`'s serialised form and deserialises,
/// mirroring Go's `json.Unmarshal(raw, &dst)` where `dst` is pre-populated: keys
/// present in `raw` win, absent keys keep `base`'s value. Returns `None` when
/// `raw` isn't an object or the merged shape fails to deserialise (Go treats a
/// failed unmarshal as "keep the fallback").
fn overlay_deserialize<T: Serialize + DeserializeOwned>(base: &T, raw: &Value) -> Option<T> {
    let mut base_val = serde_json::to_value(base).ok()?;
    let over = raw.as_object()?;
    if let Value::Object(bm) = &mut base_val {
        for (k, v) in over {
            bm.insert(k.clone(), v.clone());
        }
    }
    serde_json::from_value(base_val).ok()
}

// ─── load / merge ─────────────────────────────────────────────────────────────

/// Mirrors `manager.go:loadConfigFromDisk`.
pub(super) fn load_config_from_disk(path: &Path) -> AppConfig {
    let data = match std::fs::read(path) {
        Ok(d) => d,
        Err(_) => return AppConfig::default(),
    };
    let raw: Map<String, Value> = match serde_json::from_slice(&data) {
        Ok(m) => m,
        Err(_) => return AppConfig::default(),
    };
    merge_config_with_defaults(raw)
}

/// Mirrors `manager.go:mergeRetentionWithDefaults`.
pub(super) fn merge_retention_with_defaults(
    mut p: RetentionPolicy,
    defaults: RetentionPolicy,
) -> RetentionPolicy {
    for (id, def) in &defaults.categories {
        p.categories.entry(id.clone()).or_insert(*def);
    }
    if p.trash_expiry_days == 0 {
        p.trash_expiry_days = defaults.trash_expiry_days;
    } else {
        p.trash_expiry_days = clamp_cutoff_days(p.trash_expiry_days);
    }
    p.schedule_interval = normalize_schedule_interval(&p.schedule_interval);
    p
}

/// Mirrors `manager.go:mergeConfigWithDefaults`.
fn merge_config_with_defaults(raw: Map<String, Value>) -> AppConfig {
    let defaults = AppConfig::default();
    let mut cfg = AppConfig::default();

    // notifications: unmarshal into a ZERO value, then post-process + merge triggers.
    if let Some(v) = raw.get("notifications") {
        let zero = NotificationConfig {
            enabled: false,
            sound_enabled: false,
            ignored_regex: vec![],
            ignored_repositories: vec![],
            snoozed_until: None,
            snooze_minutes: 0,
            include_subagent_errors: false,
            triggers: vec![],
            retention_days: 0,
            max_count: 0,
        };
        if let Some(mut n) = overlay_deserialize(&zero, v) {
            n.triggers = merge_triggers(n.triggers, &defaults.notifications.triggers);
            if n.retention_days == 0 {
                n.retention_days = defaults.notifications.retention_days;
            }
            if n.max_count == 0 {
                n.max_count = defaults.notifications.max_count;
            }
            cfg.notifications = n;
        }
    }

    if let Some(v) = raw.get("general") {
        if let Some(mut parsed) = overlay_deserialize(&defaults.general, v) {
            if v.as_object()
                .is_some_and(|general| !general.contains_key("uiMode"))
            {
                parsed.ui_mode = UiMode::Nerd;
            }
            cfg.general = parsed;
        }
    }
    cfg.general.claude_root_path =
        normalize_claude_root_path(cfg.general.claude_root_path.as_deref());

    if let Some(v) = raw.get("display") {
        if let Some(parsed) = overlay_deserialize(&defaults.display, v) {
            cfg.display = parsed;
        }
    }

    if let Some(v) = raw.get("sessions") {
        if let Some(parsed) = overlay_deserialize(&defaults.sessions, v) {
            cfg.sessions = parsed;
        }
    }

    if let Some(v) = raw.get("ssh") {
        if let Some(parsed) = overlay_deserialize(&defaults.ssh, v) {
            cfg.ssh = parsed;
        }
    }

    if let Some(v) = raw.get("httpServer") {
        if let Some(parsed) = overlay_deserialize(&defaults.http_server, v) {
            cfg.http_server = parsed;
        }
    }

    if let Some(v) = raw.get("dashboard") {
        if let Some(parsed) = overlay_deserialize(&defaults.dashboard, v) {
            cfg.dashboard = parsed;
        }
    }

    if let Some(v) = raw.get("shortcuts") {
        if let Some(parsed) = overlay_deserialize(&defaults.shortcuts, v) {
            cfg.shortcuts = parsed;
        }
    }

    if let Some(v) = raw.get("themes") {
        if let Some(parsed) = overlay_deserialize(&defaults.themes, v) {
            cfg.themes = parsed;
        }
    }

    if let Some(v) = raw.get("plugins") {
        if let Some(parsed) = overlay_deserialize(&defaults.plugins, v) {
            cfg.plugins = parsed;
        }
    }

    if let Some(v) = raw.get("notificationRules") {
        if let Ok(rules) = serde_json::from_value::<Vec<Value>>(v.clone()) {
            cfg.notification_rules = rules;
        }
    }

    if let Some(v) = raw.get("webhookEndpoints") {
        if let Ok(eps) = serde_json::from_value::<Vec<WebhookEndpoint>>(v.clone()) {
            cfg.webhook_endpoints = eps;
        }
    }

    if let Some(v) = raw.get("onboardingCompleted") {
        if let Some(b) = v.as_bool() {
            cfg.onboarding_completed = b;
        }
    }

    if let Some(v) = raw.get("maintenanceCutoffs") {
        if let Ok(cutoffs) = serde_json::from_value::<BTreeMap<String, i64>>(v.clone()) {
            cfg.maintenance_cutoffs = cutoffs
                .into_iter()
                .map(|(id, days)| (id, clamp_cutoff_days(days)))
                .collect();
        }
    }

    if let Some(v) = raw.get("dismissedSuggestions") {
        if let Ok(dismissed) = serde_json::from_value::<Vec<String>>(v.clone()) {
            cfg.dismissed_suggestions = dismissed;
        }
    }

    if let Some(v) = raw.get("retention") {
        let zero = RetentionPolicy {
            categories: BTreeMap::new(),
            trash_expiry_days: 0,
            schedule_interval: String::new(),
        };
        if let Some(p) = overlay_deserialize(&zero, v) {
            cfg.retention = merge_retention_with_defaults(p, defaults.retention.clone());
        }
    }

    if let Some(v) = raw.get("lastCleanupMs") {
        if let Some(f) = v.as_f64() {
            cfg.last_cleanup_ms = f;
        }
    }

    cfg
}

// ─── ConfigState ──────────────────────────────────────────────────────────────

struct Inner {
    config: AppConfig,
    config_path: PathBuf,
    loaded: bool,
}

impl Inner {
    /// Mirrors `manager.go:ensureLoaded` — lazy first-use load. Caller holds the lock.
    fn ensure_loaded(&mut self) {
        if self.loaded {
            return;
        }
        if self.config_path.as_os_str().is_empty() {
            self.config_path = resolve_config_path();
        }
        self.config = load_config_from_disk(&self.config_path);
        self.loaded = true;
    }

    fn save(&self) -> Result<(), String> {
        save_config(&self.config, &self.config_path)
    }

    /// Mirrors `manager.go:autoExpireSnooze`.
    fn auto_expire_snooze(&mut self) {
        if let Some(until) = self.config.notifications.snoozed_until {
            if now_millis() >= until {
                self.config.notifications.snoozed_until = None;
                let _ = self.save();
            }
        }
    }
}

/// Mirrors Go `config.ConfigState`. Zero-cost to construct; loads lazily.
pub struct ConfigState {
    inner: Mutex<Inner>,
}

impl Default for ConfigState {
    fn default() -> Self {
        Self::new()
    }
}

impl ConfigState {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(Inner {
                config: AppConfig::default(),
                config_path: PathBuf::new(),
                loaded: false,
            }),
        }
    }

    /// Poison-free lock (Go mutexes don't poison; no invariants held across a panic).
    fn lock(&self) -> MutexGuard<'_, Inner> {
        self.inner.lock().unwrap_or_else(|e| e.into_inner())
    }

    // ─── config access ────────────────────────────────────────────────────────

    pub fn get_config(&self) -> AppConfig {
        let mut inner = self.lock();
        inner.ensure_loaded();
        inner.auto_expire_snooze();
        inner.config.clone()
    }

    pub fn get_config_path(&self) -> String {
        let mut inner = self.lock();
        inner.ensure_loaded();
        inner.config_path.to_string_lossy().into_owned()
    }

    pub fn get_claude_root_info(&self) -> ClaudeRootInfo {
        let mut inner = self.lock();
        inner.ensure_loaded();
        let configured = inner.config.general.claude_root_path.clone();
        get_claude_root_info(configured).unwrap_or(ClaudeRootInfo {
            default_path: String::new(),
            configured_path: None,
            effective_path: String::new(),
        })
    }

    // ─── section update ─────────────────────────────────────────────────────────

    pub fn update_config(&self, section: &str, data: Value) -> Result<AppConfig, String> {
        let validated = validate_config_update(section, &data)?;

        let mut inner = self.lock();
        inner.ensure_loaded();

        let obj = validated.as_object().cloned().unwrap_or_default();
        match section {
            "notifications" => merge_into_notifications(&mut inner.config.notifications, &obj),
            "general" => merge_into_general(&mut inner.config.general, &obj),
            "display" => {}
            "httpServer" => merge_into_http_server(&mut inner.config.http_server, &obj),
            "ssh" => merge_into_ssh(&mut inner.config.ssh, &obj),
            "dashboard" => apply_dashboard(&mut inner.config, &obj),
            "shortcuts" => apply_shortcuts(&mut inner.config, &obj),
            "themes" => apply_themes(&mut inner.config, &obj),
            "plugins" => apply_plugins(&mut inner.config, &obj),
            "notificationRules" => apply_notification_rules(&mut inner.config, &validated),
            "webhookEndpoints" => apply_webhook_endpoints(&mut inner.config, &validated),
            "onboarding" => apply_onboarding(&mut inner.config, &obj),
            "retention" => apply_retention(&mut inner.config, &obj),
            _ => {}
        }

        inner.save()?;
        inner.auto_expire_snooze();
        Ok(inner.config.clone())
    }

    // ─── ignore regex ───────────────────────────────────────────────────────────

    pub fn add_ignore_regex(&self, pattern: &str) -> Result<AppConfig, String> {
        let trimmed = pattern.trim();
        if trimmed.is_empty() {
            return Ok(self.get_config());
        }
        let err = validate_regex_pattern(trimmed);
        if !err.is_empty() {
            return Err(err);
        }

        let mut inner = self.lock();
        inner.ensure_loaded();
        if inner
            .config
            .notifications
            .ignored_regex
            .iter()
            .any(|p| p == trimmed)
        {
            inner.auto_expire_snooze();
            return Ok(inner.config.clone());
        }
        inner
            .config
            .notifications
            .ignored_regex
            .push(trimmed.to_string());
        let _ = inner.save();
        inner.auto_expire_snooze();
        Ok(inner.config.clone())
    }

    pub fn remove_ignore_regex(&self, pattern: &str) -> AppConfig {
        let mut inner = self.lock();
        inner.ensure_loaded();
        inner
            .config
            .notifications
            .ignored_regex
            .retain(|p| p != pattern);
        let _ = inner.save();
        inner.auto_expire_snooze();
        inner.config.clone()
    }

    // ─── ignore repository ──────────────────────────────────────────────────────

    pub fn add_ignore_repository(&self, repository_id: &str) -> Result<AppConfig, String> {
        let trimmed = repository_id.trim();
        if trimmed.is_empty() {
            return Ok(self.get_config());
        }

        let mut inner = self.lock();
        inner.ensure_loaded();
        if inner
            .config
            .notifications
            .ignored_repositories
            .iter()
            .any(|r| r == trimmed)
        {
            inner.auto_expire_snooze();
            return Ok(inner.config.clone());
        }
        inner
            .config
            .notifications
            .ignored_repositories
            .push(trimmed.to_string());
        let _ = inner.save();
        inner.auto_expire_snooze();
        Ok(inner.config.clone())
    }

    pub fn remove_ignore_repository(&self, repository_id: &str) -> AppConfig {
        let mut inner = self.lock();
        inner.ensure_loaded();
        inner
            .config
            .notifications
            .ignored_repositories
            .retain(|r| r != repository_id);
        let _ = inner.save();
        inner.auto_expire_snooze();
        inner.config.clone()
    }

    // ─── snooze ─────────────────────────────────────────────────────────────────

    pub fn snooze(&self, minutes: Option<u32>) -> AppConfig {
        let mut inner = self.lock();
        inner.ensure_loaded();
        let snooze_min = minutes.unwrap_or(inner.config.notifications.snooze_minutes);
        let until = now_millis() + f64::from(snooze_min) * 60_000.0;
        inner.config.notifications.snoozed_until = Some(until);
        let _ = inner.save();
        inner.config.clone()
    }

    pub fn clear_snooze(&self) -> AppConfig {
        let mut inner = self.lock();
        inner.ensure_loaded();
        inner.config.notifications.snoozed_until = None;
        let _ = inner.save();
        inner.config.clone()
    }

    // ─── triggers ───────────────────────────────────────────────────────────────

    pub fn add_trigger(&self, trigger: NotificationTrigger) -> Result<AppConfig, String> {
        let errs = validate_trigger(&trigger);
        if !errs.is_empty() {
            return Err(errs.join(", "));
        }

        let mut inner = self.lock();
        inner.ensure_loaded();
        if inner
            .config
            .notifications
            .triggers
            .iter()
            .any(|t| t.id == trigger.id)
        {
            return Err(format!("Trigger with ID {:?} already exists", trigger.id));
        }
        inner.config.notifications.triggers.push(trigger);
        let _ = inner.save();
        inner.auto_expire_snooze();
        Ok(inner.config.clone())
    }

    pub fn update_trigger(&self, trigger_id: &str, updates: Value) -> Result<AppConfig, String> {
        let mut inner = self.lock();
        inner.ensure_loaded();

        let idx = inner
            .config
            .notifications
            .triggers
            .iter()
            .position(|t| t.id == trigger_id);
        let Some(idx) = idx else {
            return Err(format!("Trigger with ID {trigger_id:?} not found"));
        };

        let mut updated = inner.config.notifications.triggers[idx].clone();
        merge_trigger_updates(&mut updated, &updates);
        if updated.mode.is_empty() {
            updated.mode = infer_mode(&updated);
        }
        let errs = validate_trigger(&updated);
        if !errs.is_empty() {
            return Err(errs.join(", "));
        }

        inner.config.notifications.triggers[idx] = updated;
        let _ = inner.save();
        inner.auto_expire_snooze();
        Ok(inner.config.clone())
    }

    pub fn remove_trigger(&self, trigger_id: &str) -> Result<AppConfig, String> {
        let mut inner = self.lock();
        inner.ensure_loaded();

        let is_builtin = match inner
            .config
            .notifications
            .triggers
            .iter()
            .find(|t| t.id == trigger_id)
        {
            None => return Err(format!("Trigger with ID {trigger_id:?} not found")),
            Some(t) => is_builtin_trigger(t),
        };
        if is_builtin {
            return Err("Cannot remove built-in triggers. Disable them instead.".to_string());
        }

        inner
            .config
            .notifications
            .triggers
            .retain(|t| t.id != trigger_id);
        let _ = inner.save();
        inner.auto_expire_snooze();
        Ok(inner.config.clone())
    }

    pub fn get_triggers(&self) -> Vec<NotificationTrigger> {
        let mut inner = self.lock();
        inner.ensure_loaded();
        inner.config.notifications.triggers.clone()
    }

    // ─── session pinning ────────────────────────────────────────────────────────

    pub fn pin_session(&self, project_id: &str, session_id: &str) {
        let mut inner = self.lock();
        inner.ensure_loaded();
        {
            let pins = inner
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
        }
        let _ = inner.save();
    }

    pub fn unpin_session(&self, project_id: &str, session_id: &str) {
        let mut inner = self.lock();
        inner.ensure_loaded();
        let empty = {
            let Some(pins) = inner.config.sessions.pinned_sessions.get_mut(project_id) else {
                return;
            };
            pins.retain(|p| p.session_id != session_id);
            pins.is_empty()
        };
        if empty {
            inner.config.sessions.pinned_sessions.remove(project_id);
        }
        let _ = inner.save();
    }

    // ─── session hiding ─────────────────────────────────────────────────────────

    pub fn hide_session(&self, project_id: &str, session_id: &str) {
        let mut inner = self.lock();
        inner.ensure_loaded();
        {
            let hidden = inner
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
        }
        let _ = inner.save();
    }

    pub fn unhide_session(&self, project_id: &str, session_id: &str) {
        let mut inner = self.lock();
        inner.ensure_loaded();
        let empty = {
            let Some(hidden) = inner.config.sessions.hidden_sessions.get_mut(project_id) else {
                return;
            };
            hidden.retain(|h| h.session_id != session_id);
            hidden.is_empty()
        };
        if empty {
            inner.config.sessions.hidden_sessions.remove(project_id);
        }
        let _ = inner.save();
    }

    pub fn hide_sessions(&self, project_id: &str, session_ids: &[String]) {
        let mut inner = self.lock();
        inner.ensure_loaded();

        let now = now_millis();
        let existing: HashSet<String> = inner
            .config
            .sessions
            .hidden_sessions
            .get(project_id)
            .map(|h| h.iter().map(|x| x.session_id.clone()).collect())
            .unwrap_or_default();

        let mut new_entries: Vec<HiddenSession> = session_ids
            .iter()
            .filter(|id| !existing.contains(*id))
            .map(|id| HiddenSession {
                session_id: id.clone(),
                hidden_at: now,
            })
            .collect();
        if new_entries.is_empty() {
            return;
        }
        let entry = inner
            .config
            .sessions
            .hidden_sessions
            .entry(project_id.to_string())
            .or_default();
        new_entries.append(entry); // new_entries = [new..., existing...]
        *entry = new_entries;
        let _ = inner.save();
    }

    pub fn unhide_sessions(&self, project_id: &str, session_ids: &[String]) {
        let mut inner = self.lock();
        inner.ensure_loaded();

        let to_remove: HashSet<String> = session_ids.iter().cloned().collect();
        let empty = {
            let Some(hidden) = inner.config.sessions.hidden_sessions.get_mut(project_id) else {
                return;
            };
            hidden.retain(|h| !to_remove.contains(&h.session_id));
            hidden.is_empty()
        };
        if empty {
            inner.config.sessions.hidden_sessions.remove(project_id);
        }
        let _ = inner.save();
    }

    // ─── ssh last connection ────────────────────────────────────────────────────

    pub fn update_ssh_last_connection(&self, last: Option<SshLastConnection>) {
        let mut inner = self.lock();
        inner.ensure_loaded();
        inner.config.ssh.last_connection = last;
        let _ = inner.save();
    }

    // ─── bookmarks ──────────────────────────────────────────────────────────────

    pub fn add_bookmark(&self, entry: BookmarkEntry) {
        let mut inner = self.lock();
        inner.ensure_loaded();
        inner.config.sessions.bookmarks.push(entry);
        let _ = inner.save();
    }

    pub fn remove_bookmark(&self, bookmark_id: &str) {
        let mut inner = self.lock();
        inner.ensure_loaded();
        inner.config.sessions.bookmarks.retain(|b| b.id != bookmark_id);
        let _ = inner.save();
    }

    pub fn get_bookmarks(&self) -> Vec<BookmarkEntry> {
        let mut inner = self.lock();
        inner.ensure_loaded();
        inner.config.sessions.bookmarks.clone()
    }

    // ─── annotations ────────────────────────────────────────────────────────────

    pub fn add_annotation(&self, entry: AnnotationEntry) {
        let mut inner = self.lock();
        inner.ensure_loaded();
        inner.config.sessions.annotations.push(entry);
        let _ = inner.save();
    }

    pub fn update_annotation(
        &self,
        annotation_id: &str,
        text: Option<&str>,
        color: Option<&str>,
        updated_at: f64,
    ) -> bool {
        let mut inner = self.lock();
        inner.ensure_loaded();

        let mut found = false;
        for a in inner.config.sessions.annotations.iter_mut() {
            if a.id == annotation_id {
                if let Some(t) = text {
                    a.text = t.to_string();
                }
                if let Some(c) = color {
                    a.color = c.to_string();
                }
                a.updated_at = updated_at;
                found = true;
                break;
            }
        }
        if found {
            let _ = inner.save();
        }
        found
    }

    pub fn remove_annotation(&self, annotation_id: &str) -> Result<(), String> {
        let mut inner = self.lock();
        inner.ensure_loaded();
        let mut updated_config = inner.config.clone();
        updated_config
            .sessions
            .annotations
            .retain(|a| a.id != annotation_id);
        save_config(&updated_config, &inner.config_path)?;
        inner.config = updated_config;
        Ok(())
    }

    pub fn get_annotations(&self) -> Vec<AnnotationEntry> {
        let mut inner = self.lock();
        inner.ensure_loaded();
        inner.config.sessions.annotations.clone()
    }

    // ─── session tags ───────────────────────────────────────────────────────────

    pub fn set_session_tags(&self, session_id: &str, tags: Vec<String>) {
        let mut inner = self.lock();
        inner.ensure_loaded();
        if tags.is_empty() {
            inner.config.sessions.session_tags.remove(session_id);
        } else {
            inner
                .config
                .sessions
                .session_tags
                .insert(session_id.to_string(), tags);
        }
        let _ = inner.save();
    }

    pub fn get_session_tags(&self, session_id: &str) -> Vec<String> {
        let mut inner = self.lock();
        inner.ensure_loaded();
        inner
            .config
            .sessions
            .session_tags
            .get(session_id)
            .cloned()
            .unwrap_or_default()
    }

    // ─── session groups ─────────────────────────────────────────────────────────

    pub fn create_session_group(&self, name: &str) -> bool {
        let mut inner = self.lock();
        inner.ensure_loaded();
        if inner.config.sessions.session_groups.contains_key(name) {
            return false;
        }
        inner
            .config
            .sessions
            .session_groups
            .insert(name.to_string(), vec![]);
        let _ = inner.save();
        true
    }

    pub fn delete_session_group(&self, name: &str) {
        let mut inner = self.lock();
        inner.ensure_loaded();
        inner.config.sessions.session_groups.remove(name);
        let _ = inner.save();
    }

    pub fn add_to_session_group(&self, name: &str, session_id: &str) {
        let mut inner = self.lock();
        inner.ensure_loaded();
        {
            let group = inner
                .config
                .sessions
                .session_groups
                .entry(name.to_string())
                .or_default();
            if group.iter().any(|s| s == session_id) {
                return;
            }
            group.push(session_id.to_string());
        }
        let _ = inner.save();
    }

    pub fn remove_from_session_group(&self, name: &str, session_id: &str) {
        let mut inner = self.lock();
        inner.ensure_loaded();
        let Some(group) = inner.config.sessions.session_groups.get_mut(name) else {
            return;
        };
        group.retain(|s| s != session_id);
        let _ = inner.save();
    }

    pub fn get_session_groups(&self) -> BTreeMap<String, Vec<String>> {
        let mut inner = self.lock();
        inner.ensure_loaded();
        inner.config.sessions.session_groups.clone()
    }

    // ─── filter presets ─────────────────────────────────────────────────────────

    pub fn add_filter_preset(&self, preset: FilterPreset) {
        let mut inner = self.lock();
        inner.ensure_loaded();
        inner.config.sessions.filter_presets.push(preset);
        let _ = inner.save();
    }

    pub fn remove_filter_preset(&self, preset_id: &str) {
        let mut inner = self.lock();
        inner.ensure_loaded();
        inner
            .config
            .sessions
            .filter_presets
            .retain(|p| p.id != preset_id);
        if inner.config.sessions.default_filter_preset_id.as_deref() == Some(preset_id) {
            inner.config.sessions.default_filter_preset_id = None;
        }
        let _ = inner.save();
    }

    pub fn rename_filter_preset(&self, preset_id: &str, name: &str) -> bool {
        let mut inner = self.lock();
        inner.ensure_loaded();
        for p in inner.config.sessions.filter_presets.iter_mut() {
            if p.id == preset_id {
                p.name = name.to_string();
                let _ = inner.save();
                return true;
            }
        }
        false
    }

    pub fn set_default_filter_preset(&self, preset_id: Option<String>) {
        let mut inner = self.lock();
        inner.ensure_loaded();
        if let Some(id) = &preset_id {
            let found = inner.config.sessions.filter_presets.iter().any(|p| &p.id == id);
            if !found {
                return;
            }
        }
        inner.config.sessions.default_filter_preset_id = preset_id;
        let _ = inner.save();
    }

    // ─── annotation/bookmark export/import ──────────────────────────────────────

    pub fn export_annotations_bundle(&self, session_ids: &[String]) -> AnnotationExportBundle {
        let mut inner = self.lock();
        inner.ensure_loaded();

        let want_all = session_ids.is_empty();
        let set: HashSet<&str> = session_ids.iter().map(String::as_str).collect();

        let annotations: Vec<AnnotationEntry> = inner
            .config
            .sessions
            .annotations
            .iter()
            .filter(|a| want_all || set.contains(a.session_id.as_str()))
            .cloned()
            .collect();
        let bookmarks: Vec<BookmarkEntry> = inner
            .config
            .sessions
            .bookmarks
            .iter()
            .filter(|b| want_all || set.contains(b.session_id.as_str()))
            .cloned()
            .collect();

        AnnotationExportBundle {
            version: 1,
            exported_at: now_millis(),
            annotations,
            bookmarks,
        }
    }

    pub fn import_annotations_bundle(&self, bundle: AnnotationExportBundle) -> ImportReport {
        let mut inner = self.lock();
        inner.ensure_loaded();

        let mut report = ImportReport::default();

        for incoming in bundle.annotations {
            let found_idx = inner
                .config
                .sessions
                .annotations
                .iter()
                .position(|a| a.session_id == incoming.session_id && a.target_id == incoming.target_id);
            match found_idx {
                Some(i) => {
                    if incoming.updated_at > inner.config.sessions.annotations[i].updated_at {
                        inner.config.sessions.annotations[i] = incoming;
                        report.annotations_updated += 1;
                    } else {
                        report.annotations_skipped += 1;
                    }
                }
                None => {
                    inner.config.sessions.annotations.push(incoming);
                    report.annotations_added += 1;
                }
            }
        }

        for incoming in bundle.bookmarks {
            let exists = inner
                .config
                .sessions
                .bookmarks
                .iter()
                .any(|b| b.session_id == incoming.session_id && b.group_id == incoming.group_id);
            if exists {
                report.bookmarks_skipped += 1;
            } else {
                inner.config.sessions.bookmarks.push(incoming);
                report.bookmarks_added += 1;
            }
        }

        let _ = inner.save();
        report
    }

    // ─── permission suggestion dismissals (W30) ─────────────────────────────────

    pub fn get_dismissed_suggestions(&self) -> Vec<String> {
        let mut inner = self.lock();
        inner.ensure_loaded();
        inner.config.dismissed_suggestions.clone()
    }

    pub fn dismiss_suggestion(&self, rule: &str) -> Result<(), String> {
        let mut inner = self.lock();
        inner.ensure_loaded();
        if inner.config.dismissed_suggestions.iter().any(|r| r == rule) {
            return Ok(());
        }
        inner.config.dismissed_suggestions.push(rule.to_string());
        inner.save()
    }

    // ─── notification auto-prune policy (W13) ───────────────────────────────────

    pub fn set_notification_policy(
        &self,
        retention_days: i64,
        max_count: i64,
    ) -> Result<(i64, i64), String> {
        let retention_days = retention_days.max(1);
        let max_count = max_count.max(1);
        let mut inner = self.lock();
        inner.ensure_loaded();
        inner.config.notifications.retention_days = retention_days;
        inner.config.notifications.max_count = max_count;
        inner.save()?;
        Ok((retention_days, max_count))
    }

    // ─── maintenance cutoffs ────────────────────────────────────────────────────

    pub fn get_maintenance_cutoff(&self, id: &str) -> Option<i64> {
        let mut inner = self.lock();
        inner.ensure_loaded();
        inner
            .config
            .maintenance_cutoffs
            .get(id)
            .map(|&d| clamp_cutoff_days(d))
    }

    pub fn set_maintenance_cutoff(&self, id: &str, days: i64) -> Result<(), String> {
        let mut inner = self.lock();
        inner.ensure_loaded();
        inner
            .config
            .maintenance_cutoffs
            .insert(id.to_string(), clamp_cutoff_days(days));
        inner.save()
    }

    // ─── retention policy (W31) ─────────────────────────────────────────────────

    pub fn get_retention_policy(&self) -> RetentionPolicy {
        let mut inner = self.lock();
        inner.ensure_loaded();
        inner.config.retention.clone()
    }

    pub fn set_retention_policy(&self, policy: RetentionPolicy) -> Result<(), String> {
        let mut inner = self.lock();
        inner.ensure_loaded();
        let mut stored = policy;
        stored.trash_expiry_days = clamp_cutoff_days(stored.trash_expiry_days);
        stored.schedule_interval = normalize_schedule_interval(&stored.schedule_interval);
        inner.config.retention = stored;
        inner.save()
    }

    // ─── last cleanup timestamp (W31/W32) ───────────────────────────────────────

    pub fn get_last_cleanup_ms(&self) -> f64 {
        let mut inner = self.lock();
        inner.ensure_loaded();
        inner.config.last_cleanup_ms
    }

    pub fn set_last_cleanup_ms(&self, ms: f64) -> Result<(), String> {
        let mut inner = self.lock();
        inner.ensure_loaded();
        inner.config.last_cleanup_ms = ms;
        inner.save()
    }

    // ─── test-only injection seam ───────────────────────────────────────────────

    #[cfg(test)]
    pub(crate) fn with_path_for_test(path: PathBuf, config: AppConfig, loaded: bool) -> Self {
        Self {
            inner: Mutex::new(Inner {
                config,
                config_path: path,
                loaded,
            }),
        }
    }
}

// ─── merge helpers (mirrors manager.go merge/apply functions) ─────────────────

fn merge_into_notifications(n: &mut NotificationConfig, obj: &Map<String, Value>) {
    if let Some(b) = obj.get("enabled").and_then(Value::as_bool) {
        n.enabled = b;
    }
    if let Some(b) = obj.get("soundEnabled").and_then(Value::as_bool) {
        n.sound_enabled = b;
    }
    if let Some(b) = obj.get("includeSubagentErrors").and_then(Value::as_bool) {
        n.include_subagent_errors = b;
    }
    if let Some(v) = obj.get("ignoredRegex") {
        if let Ok(arr) = serde_json::from_value::<Vec<String>>(v.clone()) {
            n.ignored_regex = arr;
        }
    }
    if let Some(v) = obj.get("ignoredRepositories") {
        if let Ok(arr) = serde_json::from_value::<Vec<String>>(v.clone()) {
            n.ignored_repositories = arr;
        }
    }
    if let Some(v) = obj.get("snoozedUntil") {
        if v.is_null() {
            n.snoozed_until = None;
        } else if let Some(f) = v.as_f64() {
            n.snoozed_until = Some(f);
        }
    }
    if let Some(u) = obj.get("snoozeMinutes").and_then(Value::as_u64) {
        n.snooze_minutes = u as u32;
    }
    if let Some(v) = obj.get("triggers") {
        if let Ok(t) = serde_json::from_value::<Vec<NotificationTrigger>>(v.clone()) {
            n.triggers = t;
        }
    }
}

fn merge_into_general(g: &mut super::types::GeneralConfig, obj: &Map<String, Value>) {
    if let Some(b) = obj.get("launchAtLogin").and_then(Value::as_bool) {
        g.launch_at_login = b;
    }
    if let Some(v) = obj.get("uiMode") {
        if let Ok(mode) = serde_json::from_value::<UiMode>(v.clone()) {
            g.ui_mode = mode;
        }
    }
    if let Some(s) = obj.get("theme").and_then(Value::as_str) {
        g.theme = s.to_string();
    }
    if let Some(s) = obj.get("defaultTab").and_then(Value::as_str) {
        g.default_tab = s.to_string();
    }
    if let Some(v) = obj.get("claudeRootPath") {
        if v.is_null() {
            g.claude_root_path = None;
        } else if let Some(s) = v.as_str() {
            g.claude_root_path = Some(s.to_string());
        }
    }
    if let Some(b) = obj.get("autoExpandAIGroups").and_then(Value::as_bool) {
        g.auto_expand_ai_groups = b;
    }
    if let Some(b) = obj.get("useNativeTitleBar").and_then(Value::as_bool) {
        g.use_native_title_bar = b;
    }
}

fn merge_into_http_server(h: &mut super::types::HttpServerConfig, obj: &Map<String, Value>) {
    if let Some(b) = obj.get("enabled").and_then(Value::as_bool) {
        h.enabled = b;
    }
    if let Some(p) = obj.get("port").and_then(Value::as_u64) {
        h.port = p as u16;
    }
}

fn merge_into_ssh(s: &mut super::types::SshPersistConfig, obj: &Map<String, Value>) {
    if let Some(b) = obj.get("autoReconnect").and_then(Value::as_bool) {
        s.auto_reconnect = b;
    }
    if let Some(v) = obj.get("lastActiveContextId").and_then(Value::as_str) {
        s.last_active_context_id = v.to_string();
    }
    if let Some(v) = obj.get("lastConnection") {
        if v.is_null() {
            s.last_connection = None;
        } else if let Ok(conn) = serde_json::from_value::<SshLastConnection>(v.clone()) {
            s.last_connection = Some(conn);
        }
    }
    if let Some(v) = obj.get("profiles") {
        if let Ok(profiles) =
            serde_json::from_value::<Vec<super::types::SshConnectionProfile>>(v.clone())
        {
            s.profiles = profiles;
        }
    }
}

fn apply_dashboard(cfg: &mut AppConfig, obj: &Map<String, Value>) {
    if let Some(v) = obj.get("widgetOrder") {
        if let Ok(arr) = serde_json::from_value::<Vec<String>>(v.clone()) {
            cfg.dashboard.widget_order = arr;
        }
    }
    if let Some(v) = obj.get("hiddenWidgets") {
        if let Ok(arr) = serde_json::from_value::<Vec<String>>(v.clone()) {
            cfg.dashboard.hidden_widgets = arr;
        }
    }
    if let Some(v) = obj.get("monthlyBudgetCents") {
        cfg.dashboard.monthly_budget_cents = if v.is_null() { None } else { v.as_u64() };
    }
}

fn apply_shortcuts(cfg: &mut AppConfig, obj: &Map<String, Value>) {
    if let Some(v) = obj.get("overrides") {
        if let Ok(m) = serde_json::from_value::<BTreeMap<String, String>>(v.clone()) {
            cfg.shortcuts.overrides = m;
        }
    }
}

fn apply_themes(cfg: &mut AppConfig, obj: &Map<String, Value>) {
    if let Some(v) = obj.get("activeId") {
        if v.is_null() {
            cfg.themes.active_id = None;
        } else if let Some(s) = v.as_str() {
            cfg.themes.active_id = Some(s.to_string());
        }
    }
    if let Some(v) = obj.get("custom") {
        if let Ok(themes) = serde_json::from_value::<Vec<CustomTheme>>(v.clone()) {
            cfg.themes.custom = themes;
        }
    }
}

fn apply_plugins(cfg: &mut AppConfig, obj: &Map<String, Value>) {
    if let Some(v) = obj.get("enabled") {
        if let Ok(arr) = serde_json::from_value::<Vec<String>>(v.clone()) {
            cfg.plugins.enabled = arr;
        }
    }
}

fn apply_notification_rules(cfg: &mut AppConfig, data: &Value) {
    if let Ok(rules) = serde_json::from_value::<Vec<Value>>(data.clone()) {
        cfg.notification_rules = rules;
    }
}

fn apply_webhook_endpoints(cfg: &mut AppConfig, data: &Value) {
    if let Ok(eps) = serde_json::from_value::<Vec<WebhookEndpoint>>(data.clone()) {
        cfg.webhook_endpoints = eps;
    }
}

fn apply_onboarding(cfg: &mut AppConfig, obj: &Map<String, Value>) {
    if let Some(b) = obj.get("completed").and_then(Value::as_bool) {
        cfg.onboarding_completed = b;
    }
}

fn apply_retention(cfg: &mut AppConfig, obj: &Map<String, Value>) {
    if let Some(v) = obj.get("categories") {
        if let Ok(cats) = serde_json::from_value::<BTreeMap<String, RetentionCategory>>(v.clone()) {
            cfg.retention.categories = cats;
        }
    }
    if let Some(d) = obj.get("trashExpiryDays").and_then(Value::as_i64) {
        cfg.retention.trash_expiry_days = clamp_cutoff_days(d);
    }
    if let Some(s) = obj.get("scheduleInterval").and_then(Value::as_str) {
        cfg.retention.schedule_interval = normalize_schedule_interval(s);
    }
}

/// Mirrors `manager.go:mergeTriggerUpdates`.
fn merge_trigger_updates(t: &mut NotificationTrigger, data: &Value) {
    let Some(obj) = data.as_object() else {
        return;
    };
    if let Some(s) = obj.get("name").and_then(Value::as_str) {
        t.name = s.to_string();
    }
    if let Some(b) = obj.get("enabled").and_then(Value::as_bool) {
        t.enabled = b;
    }
    if let Some(s) = obj.get("contentType").and_then(Value::as_str) {
        t.content_type = s.to_string();
    }
    if let Some(s) = obj.get("mode").and_then(Value::as_str) {
        t.mode = s.to_string();
    }
    opt_str(obj, "toolName", &mut t.tool_name);
    opt_bool(obj, "requireError", &mut t.require_error);
    opt_str(obj, "matchField", &mut t.match_field);
    opt_str(obj, "matchPattern", &mut t.match_pattern);
    opt_f64(obj, "tokenThreshold", &mut t.token_threshold);
    opt_str(obj, "tokenType", &mut t.token_type);
    opt_str(obj, "color", &mut t.color);
    if let Some(v) = obj.get("ignorePatterns") {
        if let Ok(arr) = serde_json::from_value::<Vec<String>>(v.clone()) {
            t.ignore_patterns = Some(arr);
        }
    }
    if let Some(v) = obj.get("repositoryIds") {
        if let Ok(arr) = serde_json::from_value::<Vec<String>>(v.clone()) {
            t.repository_ids = Some(arr);
        }
    }
}

fn opt_str(obj: &Map<String, Value>, key: &str, dst: &mut Option<String>) {
    if let Some(v) = obj.get(key) {
        if v.is_null() {
            *dst = None;
        } else if let Some(s) = v.as_str() {
            *dst = Some(s.to_string());
        }
    }
}

fn opt_bool(obj: &Map<String, Value>, key: &str, dst: &mut Option<bool>) {
    if let Some(v) = obj.get(key) {
        if v.is_null() {
            *dst = None;
        } else if let Some(b) = v.as_bool() {
            *dst = Some(b);
        }
    }
}

fn opt_f64(obj: &Map<String, Value>, key: &str, dst: &mut Option<f64>) {
    if let Some(v) = obj.get(key) {
        if v.is_null() {
            *dst = None;
        } else if let Some(f) = v.as_f64() {
            *dst = Some(f);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::state::types::{AnnotationEntry, FilterPreset, NotificationTrigger};

    fn unique_temp_dir() -> PathBuf {
        let dir = std::env::temp_dir().join(format!("config-state-test-{}", new_uuid()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn temp_config() -> (ConfigState, PathBuf) {
        let path = unique_temp_dir().join("config.json");
        let cs = ConfigState::with_path_for_test(path.clone(), AppConfig::default(), true);
        (cs, path)
    }

    #[test]
    fn missing_ui_mode_migrates_to_nerd() {
        let raw = serde_json::json!({
            "general": {
                "theme": "light"
            }
        })
        .as_object()
        .cloned()
        .unwrap();

        let config = merge_config_with_defaults(raw);

        assert_eq!(config.general.ui_mode, UiMode::Nerd);
        assert_eq!(config.general.theme, "light");
    }

    #[test]
    fn explicit_ui_modes_survive_config_merge() {
        for (raw_mode, expected) in [("simple", UiMode::Simple), ("nerd", UiMode::Nerd)] {
            let raw = serde_json::json!({
                "general": {
                    "uiMode": raw_mode
                }
            })
            .as_object()
            .cloned()
            .unwrap();

            let config = merge_config_with_defaults(raw);

            assert_eq!(config.general.ui_mode, expected);
        }
    }

    #[test]
    fn general_section_update_persists_ui_mode() {
        let (config_state, path) = temp_config();

        let updated = config_state
            .update_config("general", serde_json::json!({"uiMode": "simple"}))
            .unwrap();
        assert_eq!(updated.general.ui_mode, UiMode::Simple);
        assert!(!updated.general.launch_at_login);

        let reloaded = ConfigState::with_path_for_test(path, AppConfig::default(), false);
        assert_eq!(reloaded.get_config().general.ui_mode, UiMode::Simple);

        let updated = reloaded
            .update_config("general", serde_json::json!({"uiMode": "nerd"}))
            .unwrap();
        assert_eq!(updated.general.ui_mode, UiMode::Nerd);
    }

    #[test]
    fn dashboard_budget_merges_independently_and_clears() {
        let (config_state, _path) = temp_config();
        let initial = config_state
            .update_config(
                "dashboard",
                serde_json::json!({
                    "widgetOrder": ["cost"],
                    "hiddenWidgets": ["tokens"]
                }),
            )
            .unwrap();
        assert_eq!(initial.dashboard.monthly_budget_cents, None);

        let with_budget = config_state
            .update_config("dashboard", serde_json::json!({"monthlyBudgetCents": 2500}))
            .unwrap();
        assert_eq!(with_budget.dashboard.monthly_budget_cents, Some(2500));
        assert_eq!(with_budget.dashboard.widget_order, vec!["cost"]);
        assert_eq!(with_budget.dashboard.hidden_widgets, vec!["tokens"]);

        let with_new_widgets = config_state
            .update_config("dashboard", serde_json::json!({"widgetOrder": ["budget"]}))
            .unwrap();
        assert_eq!(with_new_widgets.dashboard.monthly_budget_cents, Some(2500));
        assert_eq!(with_new_widgets.dashboard.widget_order, vec!["budget"]);

        let cleared = config_state
            .update_config("dashboard", serde_json::json!({"monthlyBudgetCents": null}))
            .unwrap();
        assert_eq!(cleared.dashboard.monthly_budget_cents, None);
        assert_eq!(cleared.dashboard.widget_order, vec!["budget"]);
    }

    #[test]
    fn annotation_crud_roundtrip() {
        let (cs, path) = temp_config();
        assert_eq!(cs.get_annotations().len(), 0);

        cs.add_annotation(AnnotationEntry {
            id: "a1".into(),
            session_id: "s1".into(),
            project_id: "p1".into(),
            target_id: "t1".into(),
            text: "first".into(),
            color: "blue".into(),
            created_at: 1.0,
            updated_at: 1.0,
        });
        let anns = cs.get_annotations();
        assert_eq!(anns.len(), 1);
        assert_eq!(anns[0].text, "first");

        assert!(cs.update_annotation("a1", Some("second"), Some("red"), 2.0));
        let anns = cs.get_annotations();
        assert_eq!(anns[0].text, "second");
        assert_eq!(anns[0].color, "red");
        assert_eq!(anns[0].updated_at, 2.0);

        assert!(!cs.update_annotation("missing", Some("x"), None, 3.0));

        cs.remove_annotation("a1").unwrap();
        assert_eq!(cs.get_annotations().len(), 0);

        let reloaded = ConfigState::with_path_for_test(path, AppConfig::default(), false);
        assert_eq!(reloaded.get_annotations().len(), 0);
    }

    #[test]
    fn annotation_remove_preserves_state_when_save_fails() {
        let path = unique_temp_dir();
        let mut config = AppConfig::default();
        config.sessions.annotations.push(AnnotationEntry {
            id: "a1".into(),
            session_id: "s1".into(),
            project_id: "p1".into(),
            target_id: "t1".into(),
            text: "first".into(),
            color: "blue".into(),
            created_at: 1.0,
            updated_at: 1.0,
        });
        let cs = ConfigState::with_path_for_test(path, config, true);

        let error = cs.remove_annotation("a1").expect_err("save should fail");

        assert!(error.contains("config: rename failed"));
        assert_eq!(
            cs.get_annotations()
                .iter()
                .map(|a| a.id.as_str())
                .collect::<Vec<_>>(),
            ["a1"]
        );
    }

    #[test]
    fn import_annotations_resolves_conflict_by_newer_timestamp() {
        let (cs, _p) = temp_config();
        cs.add_annotation(AnnotationEntry {
            id: "existing".into(),
            session_id: "s1".into(),
            project_id: "p1".into(),
            target_id: "t1".into(),
            text: "old".into(),
            color: "blue".into(),
            created_at: 1.0,
            updated_at: 10.0,
        });
        cs.add_bookmark(BookmarkEntry {
            id: "bk1".into(),
            session_id: "s1".into(),
            project_id: "p1".into(),
            group_id: "g1".into(),
            note: None,
            created_at: 1.0,
        });

        let bundle = AnnotationExportBundle {
            version: 1,
            exported_at: 100.0,
            annotations: vec![
                AnnotationEntry {
                    id: "incoming-newer".into(),
                    session_id: "s1".into(),
                    project_id: "p1".into(),
                    target_id: "t1".into(),
                    text: "new".into(),
                    color: "green".into(),
                    created_at: 5.0,
                    updated_at: 20.0,
                },
                AnnotationEntry {
                    id: "another-target".into(),
                    session_id: "s1".into(),
                    project_id: "p1".into(),
                    target_id: "t2".into(),
                    text: "fresh".into(),
                    color: "red".into(),
                    created_at: 50.0,
                    updated_at: 50.0,
                },
            ],
            bookmarks: vec![
                BookmarkEntry {
                    id: "bk-dup".into(),
                    session_id: "s1".into(),
                    project_id: "p1".into(),
                    group_id: "g1".into(),
                    note: None,
                    created_at: 99.0,
                },
                BookmarkEntry {
                    id: "bk-new".into(),
                    session_id: "s2".into(),
                    project_id: "p1".into(),
                    group_id: "gX".into(),
                    note: Some("note".into()),
                    created_at: 99.0,
                },
            ],
        };

        let report = cs.import_annotations_bundle(bundle);
        assert_eq!(report.annotations_updated, 1);
        assert_eq!(report.annotations_added, 1);
        assert_eq!(report.annotations_skipped, 0);
        assert_eq!(report.bookmarks_added, 1);
        assert_eq!(report.bookmarks_skipped, 1);

        let merged = cs.get_annotations();
        let t1 = merged.iter().find(|a| a.target_id == "t1").unwrap();
        assert_eq!(t1.text, "new");
        assert_eq!(t1.updated_at, 20.0);
    }

    #[test]
    fn atomic_persistence_never_truncates_on_failure() {
        let path = unique_temp_dir().join("config.json");

        let mut cfg = AppConfig::default();
        cfg.general.theme = "light".into();
        save_config(&cfg, &path).unwrap();

        let data = std::fs::read(&path).unwrap();
        let _: Map<String, Value> = serde_json::from_slice(&data).unwrap();

        let mut tmp = path.clone().into_os_string();
        tmp.push(".tmp");
        std::fs::write(&tmp, b"GARBAGE").unwrap();

        let original = std::fs::read(&path).unwrap();
        assert!(!original.is_empty(), "original config was truncated");
        let _: Map<String, Value> = serde_json::from_slice(&original).unwrap();
        let _ = std::fs::remove_file(&tmp);

        cfg.general.theme = "dark".into();
        save_config(&cfg, &path).unwrap();
        let data2 = std::fs::read(&path).unwrap();
        let _: Map<String, Value> = serde_json::from_slice(&data2).unwrap();
    }

    #[test]
    fn pin_unpin_session() {
        let (cs, _p) = temp_config();
        cs.pin_session("proj1", "sess1");
        let pins = cs.get_config().sessions.pinned_sessions;
        assert_eq!(pins["proj1"].len(), 1);
        assert_eq!(pins["proj1"][0].session_id, "sess1");

        cs.pin_session("proj1", "sess1"); // idempotent
        assert_eq!(cs.get_config().sessions.pinned_sessions["proj1"].len(), 1);

        cs.unpin_session("proj1", "sess1");
        assert!(!cs
            .get_config()
            .sessions
            .pinned_sessions
            .contains_key("proj1"));
    }

    #[test]
    fn hide_unhide_sessions() {
        let (cs, _p) = temp_config();
        cs.hide_sessions("proj1", &["s1".into(), "s2".into()]);
        assert_eq!(cs.get_config().sessions.hidden_sessions["proj1"].len(), 2);

        cs.unhide_sessions("proj1", &["s1".into(), "s2".into()]);
        assert!(!cs
            .get_config()
            .sessions
            .hidden_sessions
            .contains_key("proj1"));
    }

    #[test]
    fn session_groups() {
        let (cs, _p) = temp_config();
        assert!(cs.create_session_group("g1"));
        assert!(!cs.create_session_group("g1"));

        cs.add_to_session_group("g1", "sess1");
        cs.add_to_session_group("g1", "sess1"); // idempotent
        assert_eq!(cs.get_session_groups()["g1"].len(), 1);

        cs.remove_from_session_group("g1", "sess1");
        assert_eq!(cs.get_session_groups()["g1"].len(), 0);

        cs.delete_session_group("g1");
        assert!(!cs.get_session_groups().contains_key("g1"));
    }

    #[test]
    fn filter_presets() {
        let (cs, _p) = temp_config();
        cs.add_filter_preset(FilterPreset {
            id: "p1".into(),
            name: "Open".into(),
            filter: serde_json::json!({"status": "open"}),
            created_at: 1.0,
        });
        assert_eq!(cs.get_config().sessions.filter_presets.len(), 1);

        assert!(cs.rename_filter_preset("p1", "Open Issues"));
        assert!(!cs.rename_filter_preset("missing", "x"));

        cs.set_default_filter_preset(Some("p1".into()));
        assert!(cs.get_config().sessions.default_filter_preset_id.is_some());

        cs.remove_filter_preset("p1");
        assert_eq!(cs.get_config().sessions.filter_presets.len(), 0);
        assert!(cs.get_config().sessions.default_filter_preset_id.is_none());
    }

    fn custom_trigger() -> NotificationTrigger {
        NotificationTrigger {
            id: "my-trigger".into(),
            name: "My Trigger".into(),
            enabled: true,
            content_type: "tool_use".into(),
            mode: "error_status".into(),
            tool_name: None,
            is_builtin: None,
            ignore_patterns: None,
            require_error: None,
            match_field: None,
            match_pattern: None,
            token_threshold: None,
            token_type: None,
            repository_ids: None,
            color: None,
        }
    }

    #[test]
    fn add_remove_trigger() {
        let (cs, _p) = temp_config();
        let cfg = cs.add_trigger(custom_trigger()).unwrap();
        assert!(cfg.notifications.triggers.iter().any(|t| t.id == "my-trigger"));

        assert!(cs.add_trigger(custom_trigger()).is_err()); // duplicate
        assert!(cs.remove_trigger("builtin-bash-command").is_err()); // builtin
        assert!(cs.remove_trigger("my-trigger").is_ok());
    }

    #[test]
    fn snooze_and_clear() {
        let (cs, _p) = temp_config();
        let cfg = cs.snooze(Some(15));
        assert!(cfg.notifications.snoozed_until.is_some());
        let cfg = cs.clear_snooze();
        assert!(cfg.notifications.snoozed_until.is_none());
    }

    #[test]
    fn add_remove_ignore_regex() {
        let (cs, _p) = temp_config();
        let cfg = cs.add_ignore_regex(r"\.secret").unwrap();
        assert!(cfg.notifications.ignored_regex.iter().any(|p| p == r"\.secret"));

        let cfg = cs.add_ignore_regex(r"\.secret").unwrap(); // idempotent
        assert_eq!(
            cfg.notifications
                .ignored_regex
                .iter()
                .filter(|p| p.as_str() == r"\.secret")
                .count(),
            1
        );

        assert!(cs.add_ignore_regex("(unclosed").is_err());

        let cfg = cs.remove_ignore_regex(r"\.secret");
        assert!(!cfg.notifications.ignored_regex.iter().any(|p| p == r"\.secret"));
    }

    #[test]
    fn export_import_annotations_bundle() {
        let (cs, _p) = temp_config();
        cs.add_annotation(AnnotationEntry {
            id: "a1".into(),
            session_id: "s1".into(),
            project_id: "p1".into(),
            target_id: "t1".into(),
            text: "hello".into(),
            color: "green".into(),
            created_at: 1.0,
            updated_at: 1.0,
        });

        let bundle = cs.export_annotations_bundle(&[]);
        assert_eq!(bundle.version, 1);
        assert_eq!(bundle.annotations.len(), 1);

        assert_eq!(cs.export_annotations_bundle(&["s1".into()]).annotations.len(), 1);
        assert_eq!(cs.export_annotations_bundle(&["other".into()]).annotations.len(), 0);
    }

    #[test]
    fn dismissed_suggestions_round_trip() {
        let (cs, path) = temp_config();
        assert_eq!(cs.get_dismissed_suggestions().len(), 0);

        cs.dismiss_suggestion("Bash(git status:*)").unwrap();
        cs.dismiss_suggestion("Bash(git status:*)").unwrap(); // idempotent
        cs.dismiss_suggestion("Bash(make build)").unwrap();

        // Fresh, unloaded state reads the persisted file.
        let reloaded = ConfigState::with_path_for_test(path, AppConfig::default(), false);
        let got = reloaded.get_dismissed_suggestions();
        assert_eq!(got.len(), 2);
        assert!(got.contains(&"Bash(git status:*)".to_string()));
        assert!(got.contains(&"Bash(make build)".to_string()));
    }

    #[test]
    fn normalize_claude_root_path_matches_go() {
        use crate::config::root::normalize_claude_root_path;
        assert_eq!(normalize_claude_root_path(None), None);
        assert_eq!(normalize_claude_root_path(Some("")), None);
        assert_eq!(normalize_claude_root_path(Some("   ")), None);
        assert_eq!(normalize_claude_root_path(Some("relative/path")), None);
        assert_eq!(
            normalize_claude_root_path(Some("/Users/foo/")),
            Some("/Users/foo".to_string())
        );
    }

    // ─── retention (retention_test.go) ────────────────────────────────────────

    #[test]
    fn default_retention_seeded() {
        let p = AppConfig::default().retention;
        assert_eq!(p.trash_expiry_days, 30);
        assert_eq!(p.categories.len(), 16);
        for id in ["transcripts", "plans", "history", "runtime-tasks"] {
            let c = p.categories.get(id).unwrap();
            assert!(c.enabled && !c.auto_approved, "{id}");
        }
        for id in ["logs", "logs-daemon", "caches"] {
            assert!(!p.categories.contains_key(id), "{id}");
        }
    }

    #[test]
    fn retention_policy_round_trip() {
        let (cs, _p) = temp_config();
        let mut cats = BTreeMap::new();
        cats.insert(
            "transcripts".to_string(),
            RetentionCategory { enabled: false, auto_approved: true },
        );
        cats.insert(
            "plans".to_string(),
            RetentionCategory { enabled: true, auto_approved: false },
        );
        cs.set_retention_policy(RetentionPolicy {
            categories: cats,
            trash_expiry_days: 45,
            schedule_interval: String::new(),
        })
        .unwrap();

        let got = cs.get_retention_policy();
        assert_eq!(got.trash_expiry_days, 45);
        assert_eq!(
            got.categories["transcripts"],
            RetentionCategory { enabled: false, auto_approved: true }
        );
        assert_eq!(
            got.categories["plans"],
            RetentionCategory { enabled: true, auto_approved: false }
        );
    }

    #[test]
    fn set_retention_policy_clamps_expiry() {
        let (cs, _p) = temp_config();
        for days in [0i64, -5, -100000] {
            cs.set_retention_policy(RetentionPolicy {
                categories: BTreeMap::new(),
                trash_expiry_days: days,
                schedule_interval: String::new(),
            })
            .unwrap();
            assert!(cs.get_retention_policy().trash_expiry_days >= 1, "{days}");
        }
        cs.set_retention_policy(RetentionPolicy {
            categories: BTreeMap::new(),
            trash_expiry_days: 999_999,
            schedule_interval: String::new(),
        })
        .unwrap();
        assert_eq!(cs.get_retention_policy().trash_expiry_days, 36500);
    }

    #[test]
    fn get_retention_policy_is_copy() {
        let (cs, _p) = temp_config();
        let mut got = cs.get_retention_policy();
        got.categories.insert(
            "transcripts".to_string(),
            RetentionCategory { enabled: false, auto_approved: false },
        );
        assert!(cs.get_retention_policy().categories["transcripts"].enabled);
    }

    #[test]
    fn last_cleanup_ms_round_trip() {
        let (cs, _p) = temp_config();
        assert_eq!(cs.get_last_cleanup_ms(), 0.0);
        cs.set_last_cleanup_ms(1234.5).unwrap();
        assert_eq!(cs.get_last_cleanup_ms(), 1234.5);
    }

    #[test]
    fn retention_merge_on_load() {
        let path = unique_temp_dir().join("config.json");
        let raw = r#"{"retention":{"trashExpiryDays":-10,"categories":{"transcripts":{"enabled":false,"autoApproved":true}}}}"#;
        std::fs::write(&path, raw).unwrap();
        let cfg = load_config_from_disk(&path);

        assert_eq!(cfg.retention.trash_expiry_days, 1);
        let c = &cfg.retention.categories["transcripts"];
        assert!(!c.enabled && c.auto_approved);
        assert!(cfg.retention.categories["plans"].enabled);
        assert_eq!(cfg.retention.categories.len(), 16);
        assert!(!cfg.retention.categories.contains_key("logs"));

        let raw0 = r#"{"retention":{"trashExpiryDays":0}}"#;
        std::fs::write(&path, raw0).unwrap();
        assert_eq!(load_config_from_disk(&path).retention.trash_expiry_days, 30);
    }

    #[test]
    fn update_config_retention_section() {
        let (cs, _p) = temp_config();
        let body = serde_json::json!({
            "trashExpiryDays": 0,
            "categories": {"plans": {"enabled": false, "autoApproved": false}}
        });
        cs.update_config("retention", body).unwrap();
        let got = cs.get_retention_policy();
        assert_eq!(got.trash_expiry_days, 1);
        assert!(!got.categories["plans"].enabled);
    }
}
