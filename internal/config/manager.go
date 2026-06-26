// Package config — manager ports src-tauri/src/config/manager/ to Go.
// ConfigState owns AppConfig behind a sync.Mutex with lazy disk loading.
// Persistence uses atomic write: temp file → os.Rename (never truncate-in-place).
package config

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
)

// ─── ConfigState ─────────────────────────────────────────────────────────────

// ConfigState mirrors Rust's ConfigState. The mutex guards all mutable access.
type ConfigState struct {
	mu         sync.Mutex
	config     AppConfig
	configPath string
	loaded     bool
}

// resolveConfigPath mirrors merge_helpers::resolve_config_path.
func resolveConfigPath() string {
	home, err := os.UserHomeDir()
	if err != nil {
		home = "/tmp"
	}
	return filepath.Join(home, ".claude", "claude-devtools-config.json")
}

// nowMillis mirrors merge_helpers::now_millis — ms since Unix epoch as float64.
func nowMillis() float64 {
	return float64(time.Now().UnixNano()) / 1e6
}

// loadConfigFromDisk mirrors merge_helpers::load_config_from_disk.
func loadConfigFromDisk(path string) AppConfig {
	data, err := os.ReadFile(path)
	if err != nil {
		return DefaultAppConfig()
	}
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(data, &raw); err != nil {
		return DefaultAppConfig()
	}
	return mergeConfigWithDefaults(raw)
}

// ensureLoaded lazily loads config from disk on first use.
// Caller must hold cs.mu.
func (cs *ConfigState) ensureLoaded() {
	if cs.loaded {
		return
	}
	if cs.configPath == "" {
		cs.configPath = resolveConfigPath()
	}
	cs.config = loadConfigFromDisk(cs.configPath)
	cs.loaded = true
}

// saveConfig writes config atomically: serialise → temp file → os.Rename.
// Caller must hold cs.mu.
func (cs *ConfigState) saveConfig() error {
	data, err := json.MarshalIndent(cs.config, "", "  ")
	if err != nil {
		return fmt.Errorf("config: marshal failed: %w", err)
	}

	dir := filepath.Dir(cs.configPath)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return fmt.Errorf("config: mkdir failed: %w", err)
	}

	tmpPath := cs.configPath + ".tmp"
	if err := os.WriteFile(tmpPath, data, 0o644); err != nil {
		return fmt.Errorf("config: write temp failed: %w", err)
	}
	if err := os.Rename(tmpPath, cs.configPath); err != nil {
		// Best-effort cleanup; original file is still intact.
		_ = os.Remove(tmpPath)
		return fmt.Errorf("config: rename failed: %w", err)
	}
	return nil
}

// autoExpireSnooze clears snoozedUntil if it's in the past.
// Caller must hold cs.mu.
func (cs *ConfigState) autoExpireSnooze() {
	if cs.config.Notifications.SnoozedUntil == nil {
		return
	}
	if nowMillis() >= *cs.config.Notifications.SnoozedUntil {
		cs.config.Notifications.SnoozedUntil = nil
		_ = cs.saveConfig()
	}
}

// ─── Config Access ────────────────────────────────────────────────────────────

// GetConfig mirrors ConfigState::get_config — clones with snooze expiry check.
func (cs *ConfigState) GetConfig() AppConfig {
	cs.mu.Lock()
	defer cs.mu.Unlock()
	cs.ensureLoaded()
	cs.autoExpireSnooze()
	return cs.config
}

// GetConfigPath returns the path to the config file.
func (cs *ConfigState) GetConfigPath() string {
	cs.mu.Lock()
	defer cs.mu.Unlock()
	cs.ensureLoaded()
	return cs.configPath
}

// ─── Claude Root Info ─────────────────────────────────────────────────────────

// GetClaudeRootInfo mirrors ConfigState::get_claude_root_info.
func (cs *ConfigState) GetClaudeRootInfo() ClaudeRootInfo {
	cs.mu.Lock()
	defer cs.mu.Unlock()
	cs.ensureLoaded()

	home, _ := os.UserHomeDir()
	defaultPath := filepath.Join(home, ".claude")

	configured := cs.config.General.ClaudeRootPath
	effectivePath := defaultPath
	if configured != nil {
		effectivePath = *configured
	}

	return ClaudeRootInfo{
		DefaultPath:    defaultPath,
		ConfiguredPath: configured,
		EffectivePath:  effectivePath,
	}
}

// ─── Section Update ───────────────────────────────────────────────────────────

// UpdateConfig mirrors ConfigState::update_config.
func (cs *ConfigState) UpdateConfig(section string, data json.RawMessage) (AppConfig, error) {
	_, validated, err := ValidateConfigUpdate(section, data)
	if err != nil {
		return AppConfig{}, err
	}

	cs.mu.Lock()
	defer cs.mu.Unlock()
	cs.ensureLoaded()

	var obj map[string]json.RawMessage
	_ = json.Unmarshal(validated, &obj) // safe: dispatcher already validated

	switch section {
	case "notifications":
		mergeJSONIntoNotifications(&cs.config.Notifications, obj)
	case "general":
		mergeJSONIntoGeneral(&cs.config.General, obj)
	case "display":
		mergeJSONIntoDisplay(&cs.config.Display, obj)
	case "httpServer":
		mergeJSONIntoHTTPServer(&cs.config.HTTPServer, obj)
	case "ssh":
		mergeJSONIntoSSH(&cs.config.SSH, obj)
	case "dashboard":
		applyDashboard(&cs.config, obj)
	case "shortcuts":
		applyShortcuts(&cs.config, obj)
	case "themes":
		applyThemes(&cs.config, obj)
	case "plugins":
		applyPlugins(&cs.config, obj)
	case "notificationRules":
		applyNotificationRules(&cs.config, validated)
	case "webhookEndpoints":
		applyWebhookEndpoints(&cs.config, validated)
	case "onboarding":
		applyOnboarding(&cs.config, obj)
	}

	if err := cs.saveConfig(); err != nil {
		return AppConfig{}, err
	}
	cs.autoExpireSnooze()
	return cs.config, nil
}

// ─── merge helpers (mirrors merge_helpers.rs) ─────────────────────────────────

func mergeJSONIntoNotifications(n *NotificationConfig, obj map[string]json.RawMessage) {
	if v, ok := obj["enabled"]; ok {
		_ = json.Unmarshal(v, &n.Enabled)
	}
	if v, ok := obj["soundEnabled"]; ok {
		_ = json.Unmarshal(v, &n.SoundEnabled)
	}
	if v, ok := obj["includeSubagentErrors"]; ok {
		_ = json.Unmarshal(v, &n.IncludeSubagentErrors)
	}
	if v, ok := obj["ignoredRegex"]; ok {
		var arr []string
		if json.Unmarshal(v, &arr) == nil {
			n.IgnoredRegex = arr
		}
	}
	if v, ok := obj["ignoredRepositories"]; ok {
		var arr []string
		if json.Unmarshal(v, &arr) == nil {
			n.IgnoredRepositories = arr
		}
	}
	if v, ok := obj["snoozedUntil"]; ok {
		if string(v) == "null" {
			n.SnoozedUntil = nil
		} else {
			var f float64
			if json.Unmarshal(v, &f) == nil {
				n.SnoozedUntil = &f
			}
		}
	}
	if v, ok := obj["snoozeMinutes"]; ok {
		var u uint32
		if json.Unmarshal(v, &u) == nil {
			n.SnoozeMinutes = u
		}
	}
	if v, ok := obj["triggers"]; ok {
		var triggers []NotificationTrigger
		if json.Unmarshal(v, &triggers) == nil {
			n.Triggers = triggers
		}
	}
}

func mergeJSONIntoGeneral(g *GeneralConfig, obj map[string]json.RawMessage) {
	if v, ok := obj["launchAtLogin"]; ok {
		_ = json.Unmarshal(v, &g.LaunchAtLogin)
	}
	if v, ok := obj["showDockIcon"]; ok {
		_ = json.Unmarshal(v, &g.ShowDockIcon)
	}
	if v, ok := obj["theme"]; ok {
		_ = json.Unmarshal(v, &g.Theme)
	}
	if v, ok := obj["defaultTab"]; ok {
		_ = json.Unmarshal(v, &g.DefaultTab)
	}
	if v, ok := obj["claudeRootPath"]; ok {
		if string(v) == "null" {
			g.ClaudeRootPath = nil
		} else {
			var s string
			if json.Unmarshal(v, &s) == nil {
				g.ClaudeRootPath = &s
			}
		}
	}
	if v, ok := obj["autoExpandAIGroups"]; ok {
		_ = json.Unmarshal(v, &g.AutoExpandAIGroups)
	}
	if v, ok := obj["useNativeTitleBar"]; ok {
		_ = json.Unmarshal(v, &g.UseNativeTitleBar)
	}
}

func mergeJSONIntoDisplay(d *DisplayConfig, obj map[string]json.RawMessage) {
	if v, ok := obj["showTimestamps"]; ok {
		_ = json.Unmarshal(v, &d.ShowTimestamps)
	}
	if v, ok := obj["compactMode"]; ok {
		_ = json.Unmarshal(v, &d.CompactMode)
	}
	if v, ok := obj["syntaxHighlighting"]; ok {
		_ = json.Unmarshal(v, &d.SyntaxHighlighting)
	}
}

func mergeJSONIntoHTTPServer(h *HttpServerConfig, obj map[string]json.RawMessage) {
	if v, ok := obj["enabled"]; ok {
		_ = json.Unmarshal(v, &h.Enabled)
	}
	if v, ok := obj["port"]; ok {
		_ = json.Unmarshal(v, &h.Port)
	}
}

func mergeJSONIntoSSH(s *SshPersistConfig, obj map[string]json.RawMessage) {
	if v, ok := obj["autoReconnect"]; ok {
		_ = json.Unmarshal(v, &s.AutoReconnect)
	}
	if v, ok := obj["lastActiveContextId"]; ok {
		_ = json.Unmarshal(v, &s.LastActiveContextID)
	}
	if v, ok := obj["lastConnection"]; ok {
		if string(v) == "null" {
			s.LastConnection = nil
		} else {
			var conn SshLastConnection
			if json.Unmarshal(v, &conn) == nil {
				s.LastConnection = &conn
			}
		}
	}
	if v, ok := obj["profiles"]; ok {
		var profiles []SshConnectionProfile
		if json.Unmarshal(v, &profiles) == nil {
			s.Profiles = profiles
		}
	}
}

func applyDashboard(cfg *AppConfig, obj map[string]json.RawMessage) {
	if v, ok := obj["widgetOrder"]; ok {
		var arr []string
		if json.Unmarshal(v, &arr) == nil {
			cfg.Dashboard.WidgetOrder = arr
		}
	}
	if v, ok := obj["hiddenWidgets"]; ok {
		var arr []string
		if json.Unmarshal(v, &arr) == nil {
			cfg.Dashboard.HiddenWidgets = arr
		}
	}
}

func applyShortcuts(cfg *AppConfig, obj map[string]json.RawMessage) {
	if v, ok := obj["overrides"]; ok {
		var m map[string]string
		if json.Unmarshal(v, &m) == nil {
			cfg.Shortcuts.Overrides = m
		}
	}
}

func applyThemes(cfg *AppConfig, obj map[string]json.RawMessage) {
	if v, ok := obj["activeId"]; ok {
		if string(v) == "null" {
			cfg.Themes.ActiveID = nil
		} else {
			var s string
			if json.Unmarshal(v, &s) == nil {
				cfg.Themes.ActiveID = &s
			}
		}
	}
	if v, ok := obj["custom"]; ok {
		var themes []CustomTheme
		if json.Unmarshal(v, &themes) == nil {
			cfg.Themes.Custom = themes
		}
	}
}

func applyPlugins(cfg *AppConfig, obj map[string]json.RawMessage) {
	if v, ok := obj["enabled"]; ok {
		var arr []string
		if json.Unmarshal(v, &arr) == nil {
			cfg.Plugins.Enabled = arr
		}
	}
}

func applyNotificationRules(cfg *AppConfig, data json.RawMessage) {
	var rules []NotificationRule
	if json.Unmarshal(data, &rules) == nil {
		cfg.NotificationRules = rules
	}
}

func applyWebhookEndpoints(cfg *AppConfig, data json.RawMessage) {
	var eps []WebhookEndpoint
	if json.Unmarshal(data, &eps) == nil {
		cfg.WebhookEndpoints = eps
	}
}

func applyOnboarding(cfg *AppConfig, obj map[string]json.RawMessage) {
	if v, ok := obj["completed"]; ok {
		_ = json.Unmarshal(v, &cfg.OnboardingCompleted)
	}
}

// ─── merge with defaults (mirrors types/merge.rs) ────────────────────────────

// mergeConfigWithDefaults mirrors merge_config_with_defaults.
func mergeConfigWithDefaults(raw map[string]json.RawMessage) AppConfig {
	defaults := DefaultAppConfig()

	unmarshalOr := func(key string, dst interface{}, fallback interface{}) {
		v, ok := raw[key]
		if !ok {
			return
		}
		if json.Unmarshal(v, dst) != nil {
			// Reset to fallback on parse failure.
			b, _ := json.Marshal(fallback)
			_ = json.Unmarshal(b, dst)
		}
	}

	cfg := DefaultAppConfig()

	// notifications: unmarshal then merge triggers
	if v, ok := raw["notifications"]; ok {
		var n NotificationConfig
		if json.Unmarshal(v, &n) == nil {
			n.Triggers = MergeTriggers(n.Triggers, defaults.Notifications.Triggers)
			if n.IgnoredRegex == nil {
				n.IgnoredRegex = []string{}
			}
			if n.IgnoredRepositories == nil {
				n.IgnoredRepositories = []string{}
			}
			cfg.Notifications = n
		}
	}

	unmarshalOr("general", &cfg.General, defaults.General)
	cfg.General.ClaudeRootPath = normalizeClaudeRootPath(cfg.General.ClaudeRootPath)

	unmarshalOr("display", &cfg.Display, defaults.Display)
	unmarshalOr("sessions", &cfg.Sessions, defaults.Sessions)

	// Ensure nil slices become empty slices after unmarshal.
	if cfg.Sessions.PinnedSessions == nil {
		cfg.Sessions.PinnedSessions = map[string][]PinnedSession{}
	}
	if cfg.Sessions.HiddenSessions == nil {
		cfg.Sessions.HiddenSessions = map[string][]HiddenSession{}
	}
	if cfg.Sessions.Bookmarks == nil {
		cfg.Sessions.Bookmarks = []BookmarkEntry{}
	}
	if cfg.Sessions.SessionTags == nil {
		cfg.Sessions.SessionTags = map[string][]string{}
	}
	if cfg.Sessions.Annotations == nil {
		cfg.Sessions.Annotations = []AnnotationEntry{}
	}
	if cfg.Sessions.SessionGroups == nil {
		cfg.Sessions.SessionGroups = map[string][]string{}
	}
	if cfg.Sessions.FilterPresets == nil {
		cfg.Sessions.FilterPresets = []FilterPreset{}
	}

	unmarshalOr("ssh", &cfg.SSH, defaults.SSH)
	if cfg.SSH.Profiles == nil {
		cfg.SSH.Profiles = []SshConnectionProfile{}
	}

	unmarshalOr("httpServer", &cfg.HTTPServer, defaults.HTTPServer)
	unmarshalOr("dashboard", &cfg.Dashboard, defaults.Dashboard)
	if cfg.Dashboard.WidgetOrder == nil {
		cfg.Dashboard.WidgetOrder = []string{}
	}
	if cfg.Dashboard.HiddenWidgets == nil {
		cfg.Dashboard.HiddenWidgets = []string{}
	}

	unmarshalOr("shortcuts", &cfg.Shortcuts, defaults.Shortcuts)
	if cfg.Shortcuts.Overrides == nil {
		cfg.Shortcuts.Overrides = map[string]string{}
	}

	unmarshalOr("themes", &cfg.Themes, defaults.Themes)
	if cfg.Themes.Custom == nil {
		cfg.Themes.Custom = []CustomTheme{}
	}

	unmarshalOr("plugins", &cfg.Plugins, defaults.Plugins)
	if cfg.Plugins.Enabled == nil {
		cfg.Plugins.Enabled = []string{}
	}

	if v, ok := raw["notificationRules"]; ok {
		var rules []NotificationRule
		if json.Unmarshal(v, &rules) == nil && rules != nil {
			cfg.NotificationRules = rules
		}
	}

	if v, ok := raw["webhookEndpoints"]; ok {
		var eps []WebhookEndpoint
		if json.Unmarshal(v, &eps) == nil && eps != nil {
			cfg.WebhookEndpoints = eps
		}
	}


	if v, ok := raw["onboardingCompleted"]; ok {
		_ = json.Unmarshal(v, &cfg.OnboardingCompleted)
	}

	return cfg
}

// normalizeClaudeRootPath mirrors types/merge.rs normalize_claude_root_path.
func normalizeClaudeRootPath(p *string) *string {
	if p == nil {
		return nil
	}
	trimmed := strings.TrimSpace(*p)
	if trimmed == "" {
		return nil
	}
	if !filepath.IsAbs(trimmed) {
		return nil
	}
	// Strip trailing slashes, but preserve root "/" itself.
	normalized := strings.TrimRight(trimmed, "/\\")
	if normalized == "" {
		normalized = "/"
	}
	return &normalized
}

// ─── Ignore Regex ─────────────────────────────────────────────────────────────

// AddIgnoreRegex mirrors ConfigState::add_ignore_regex.
func (cs *ConfigState) AddIgnoreRegex(pattern string) (AppConfig, error) {
	trimmed := strings.TrimSpace(pattern)
	if trimmed == "" {
		return cs.GetConfig(), nil
	}
	if err := ValidateRegexPattern(trimmed); err != "" {
		return AppConfig{}, fmt.Errorf("%s", err)
	}

	cs.mu.Lock()
	defer cs.mu.Unlock()
	cs.ensureLoaded()

	for _, p := range cs.config.Notifications.IgnoredRegex {
		if p == trimmed {
			cs.autoExpireSnooze()
			return cs.config, nil
		}
	}
	cs.config.Notifications.IgnoredRegex = append(cs.config.Notifications.IgnoredRegex, trimmed)
	_ = cs.saveConfig()
	cs.autoExpireSnooze()
	return cs.config, nil
}

// RemoveIgnoreRegex mirrors ConfigState::remove_ignore_regex.
func (cs *ConfigState) RemoveIgnoreRegex(pattern string) AppConfig {
	cs.mu.Lock()
	defer cs.mu.Unlock()
	cs.ensureLoaded()

	filtered := cs.config.Notifications.IgnoredRegex[:0]
	for _, p := range cs.config.Notifications.IgnoredRegex {
		if p != pattern {
			filtered = append(filtered, p)
		}
	}
	cs.config.Notifications.IgnoredRegex = filtered
	_ = cs.saveConfig()
	cs.autoExpireSnooze()
	return cs.config
}

// ─── Ignore Repository ────────────────────────────────────────────────────────

// AddIgnoreRepository mirrors ConfigState::add_ignore_repository.
func (cs *ConfigState) AddIgnoreRepository(repositoryID string) (AppConfig, error) {
	trimmed := strings.TrimSpace(repositoryID)
	if trimmed == "" {
		return cs.GetConfig(), nil
	}

	cs.mu.Lock()
	defer cs.mu.Unlock()
	cs.ensureLoaded()

	for _, r := range cs.config.Notifications.IgnoredRepositories {
		if r == trimmed {
			cs.autoExpireSnooze()
			return cs.config, nil
		}
	}
	cs.config.Notifications.IgnoredRepositories = append(cs.config.Notifications.IgnoredRepositories, trimmed)
	_ = cs.saveConfig()
	cs.autoExpireSnooze()
	return cs.config, nil
}

// RemoveIgnoreRepository mirrors ConfigState::remove_ignore_repository.
func (cs *ConfigState) RemoveIgnoreRepository(repositoryID string) AppConfig {
	cs.mu.Lock()
	defer cs.mu.Unlock()
	cs.ensureLoaded()

	filtered := cs.config.Notifications.IgnoredRepositories[:0]
	for _, r := range cs.config.Notifications.IgnoredRepositories {
		if r != repositoryID {
			filtered = append(filtered, r)
		}
	}
	cs.config.Notifications.IgnoredRepositories = filtered
	_ = cs.saveConfig()
	cs.autoExpireSnooze()
	return cs.config
}

// ─── Snooze ───────────────────────────────────────────────────────────────────

// Snooze mirrors ConfigState::snooze.
func (cs *ConfigState) Snooze(minutes *uint32) AppConfig {
	cs.mu.Lock()
	defer cs.mu.Unlock()
	cs.ensureLoaded()

	snoozeMin := cs.config.Notifications.SnoozeMinutes
	if minutes != nil {
		snoozeMin = *minutes
	}
	until := nowMillis() + float64(snoozeMin)*60_000
	cs.config.Notifications.SnoozedUntil = &until
	_ = cs.saveConfig()
	return cs.config
}

// ClearSnooze mirrors ConfigState::clear_snooze.
func (cs *ConfigState) ClearSnooze() AppConfig {
	cs.mu.Lock()
	defer cs.mu.Unlock()
	cs.ensureLoaded()

	cs.config.Notifications.SnoozedUntil = nil
	_ = cs.saveConfig()
	return cs.config
}

// ─── Triggers ─────────────────────────────────────────────────────────────────

// AddTrigger mirrors ConfigState::add_trigger.
func (cs *ConfigState) AddTrigger(trigger NotificationTrigger) (AppConfig, error) {
	if errs := ValidateTrigger(&trigger); len(errs) > 0 {
		return AppConfig{}, fmt.Errorf("%s", strings.Join(errs, ", "))
	}

	cs.mu.Lock()
	defer cs.mu.Unlock()
	cs.ensureLoaded()

	for _, t := range cs.config.Notifications.Triggers {
		if t.ID == trigger.ID {
			return AppConfig{}, fmt.Errorf("Trigger with ID %q already exists", trigger.ID)
		}
	}
	cs.config.Notifications.Triggers = append(cs.config.Notifications.Triggers, trigger)
	_ = cs.saveConfig()
	cs.autoExpireSnooze()
	return cs.config, nil
}

// UpdateTrigger mirrors ConfigState::update_trigger.
func (cs *ConfigState) UpdateTrigger(triggerID string, updates json.RawMessage) (AppConfig, error) {
	cs.mu.Lock()
	defer cs.mu.Unlock()
	cs.ensureLoaded()

	idx := -1
	for i, t := range cs.config.Notifications.Triggers {
		if t.ID == triggerID {
			idx = i
			break
		}
	}
	if idx < 0 {
		return AppConfig{}, fmt.Errorf("Trigger with ID %q not found", triggerID)
	}

	updated := cs.config.Notifications.Triggers[idx]
	mergeTriggerUpdates(&updated, updates)
	if updated.Mode == "" {
		updated.Mode = InferMode(&updated)
	}

	if errs := ValidateTrigger(&updated); len(errs) > 0 {
		return AppConfig{}, fmt.Errorf("%s", strings.Join(errs, ", "))
	}

	cs.config.Notifications.Triggers[idx] = updated
	_ = cs.saveConfig()
	cs.autoExpireSnooze()
	return cs.config, nil
}

// RemoveTrigger mirrors ConfigState::remove_trigger.
func (cs *ConfigState) RemoveTrigger(triggerID string) (AppConfig, error) {
	cs.mu.Lock()
	defer cs.mu.Unlock()
	cs.ensureLoaded()

	var found *NotificationTrigger
	for i := range cs.config.Notifications.Triggers {
		if cs.config.Notifications.Triggers[i].ID == triggerID {
			found = &cs.config.Notifications.Triggers[i]
			break
		}
	}
	if found == nil {
		return AppConfig{}, fmt.Errorf("Trigger with ID %q not found", triggerID)
	}
	if isBuiltinTrigger(found) {
		return AppConfig{}, fmt.Errorf("Cannot remove built-in triggers. Disable them instead.")
	}

	triggers := cs.config.Notifications.Triggers[:0]
	for _, t := range cs.config.Notifications.Triggers {
		if t.ID != triggerID {
			triggers = append(triggers, t)
		}
	}
	cs.config.Notifications.Triggers = triggers
	_ = cs.saveConfig()
	cs.autoExpireSnooze()
	return cs.config, nil
}

// GetTriggers mirrors ConfigState::get_triggers.
func (cs *ConfigState) GetTriggers() []NotificationTrigger {
	cs.mu.Lock()
	defer cs.mu.Unlock()
	cs.ensureLoaded()
	return append([]NotificationTrigger{}, cs.config.Notifications.Triggers...)
}

// mergeTriggerUpdates mirrors merge_helpers::merge_trigger_updates.
func mergeTriggerUpdates(t *NotificationTrigger, data json.RawMessage) {
	var obj map[string]json.RawMessage
	if json.Unmarshal(data, &obj) != nil {
		return
	}
	strField := func(key string, dst *string) {
		if v, ok := obj[key]; ok {
			_ = json.Unmarshal(v, dst)
		}
	}
	optStr := func(key string, dst **string) {
		if v, ok := obj[key]; ok {
			if string(v) == "null" {
				*dst = nil
			} else {
				var s string
				if json.Unmarshal(v, &s) == nil {
					*dst = &s
				}
			}
		}
	}
	optBool := func(key string, dst **bool) {
		if v, ok := obj[key]; ok {
			if string(v) == "null" {
				*dst = nil
			} else {
				var b bool
				if json.Unmarshal(v, &b) == nil {
					*dst = &b
				}
			}
		}
	}
	optFloat64 := func(key string, dst **float64) {
		if v, ok := obj[key]; ok {
			if string(v) == "null" {
				*dst = nil
			} else {
				var f float64
				if json.Unmarshal(v, &f) == nil {
					*dst = &f
				}
			}
		}
	}

	strField("name", &t.Name)
	if v, ok := obj["enabled"]; ok {
		_ = json.Unmarshal(v, &t.Enabled)
	}
	strField("contentType", &t.ContentType)
	strField("mode", &t.Mode)
	optStr("toolName", &t.ToolName)
	optBool("requireError", &t.RequireError)
	optStr("matchField", &t.MatchField)
	optStr("matchPattern", &t.MatchPattern)
	optFloat64("tokenThreshold", &t.TokenThreshold)
	optStr("tokenType", &t.TokenType)
	optStr("color", &t.Color)
	if v, ok := obj["ignorePatterns"]; ok {
		var arr []string
		if json.Unmarshal(v, &arr) == nil {
			t.IgnorePatterns = &arr
		}
	}
	if v, ok := obj["repositoryIds"]; ok {
		var arr []string
		if json.Unmarshal(v, &arr) == nil {
			t.RepositoryIDs = &arr
		}
	}
}

// ─── Session Pinning ──────────────────────────────────────────────────────────

// PinSession mirrors ConfigState::pin_session.
func (cs *ConfigState) PinSession(projectID, sessionID string) {
	cs.mu.Lock()
	defer cs.mu.Unlock()
	cs.ensureLoaded()

	pins := cs.config.Sessions.PinnedSessions[projectID]
	for _, p := range pins {
		if p.SessionID == sessionID {
			return
		}
	}
	// Prepend (matching Rust's insert(0, ...)).
	cs.config.Sessions.PinnedSessions[projectID] = append(
		[]PinnedSession{{SessionID: sessionID, PinnedAt: nowMillis()}},
		pins...,
	)
	_ = cs.saveConfig()
}

// UnpinSession mirrors ConfigState::unpin_session.
func (cs *ConfigState) UnpinSession(projectID, sessionID string) {
	cs.mu.Lock()
	defer cs.mu.Unlock()
	cs.ensureLoaded()

	pins, ok := cs.config.Sessions.PinnedSessions[projectID]
	if !ok {
		return
	}
	next := pins[:0]
	for _, p := range pins {
		if p.SessionID != sessionID {
			next = append(next, p)
		}
	}
	if len(next) == 0 {
		delete(cs.config.Sessions.PinnedSessions, projectID)
	} else {
		cs.config.Sessions.PinnedSessions[projectID] = next
	}
	_ = cs.saveConfig()
}

// ─── Session Hiding ───────────────────────────────────────────────────────────

// HideSession mirrors ConfigState::hide_session.
func (cs *ConfigState) HideSession(projectID, sessionID string) {
	cs.mu.Lock()
	defer cs.mu.Unlock()
	cs.ensureLoaded()

	hidden := cs.config.Sessions.HiddenSessions[projectID]
	for _, h := range hidden {
		if h.SessionID == sessionID {
			return
		}
	}
	cs.config.Sessions.HiddenSessions[projectID] = append(
		[]HiddenSession{{SessionID: sessionID, HiddenAt: nowMillis()}},
		hidden...,
	)
	_ = cs.saveConfig()
}

// UnhideSession mirrors ConfigState::unhide_session.
func (cs *ConfigState) UnhideSession(projectID, sessionID string) {
	cs.mu.Lock()
	defer cs.mu.Unlock()
	cs.ensureLoaded()

	hidden, ok := cs.config.Sessions.HiddenSessions[projectID]
	if !ok {
		return
	}
	next := hidden[:0]
	for _, h := range hidden {
		if h.SessionID != sessionID {
			next = append(next, h)
		}
	}
	if len(next) == 0 {
		delete(cs.config.Sessions.HiddenSessions, projectID)
	} else {
		cs.config.Sessions.HiddenSessions[projectID] = next
	}
	_ = cs.saveConfig()
}

// HideSessions mirrors ConfigState::hide_sessions (bulk).
func (cs *ConfigState) HideSessions(projectID string, sessionIDs []string) {
	cs.mu.Lock()
	defer cs.mu.Unlock()
	cs.ensureLoaded()

	hidden := cs.config.Sessions.HiddenSessions[projectID]
	existing := make(map[string]bool, len(hidden))
	for _, h := range hidden {
		existing[h.SessionID] = true
	}

	now := nowMillis()
	var newEntries []HiddenSession
	for _, id := range sessionIDs {
		if !existing[id] {
			newEntries = append(newEntries, HiddenSession{SessionID: id, HiddenAt: now})
		}
	}
	if len(newEntries) == 0 {
		return
	}
	cs.config.Sessions.HiddenSessions[projectID] = append(newEntries, hidden...)
	_ = cs.saveConfig()
}

// UnhideSessions mirrors ConfigState::unhide_sessions (bulk).
func (cs *ConfigState) UnhideSessions(projectID string, sessionIDs []string) {
	cs.mu.Lock()
	defer cs.mu.Unlock()
	cs.ensureLoaded()

	hidden, ok := cs.config.Sessions.HiddenSessions[projectID]
	if !ok {
		return
	}
	toRemove := make(map[string]bool, len(sessionIDs))
	for _, id := range sessionIDs {
		toRemove[id] = true
	}
	next := hidden[:0]
	for _, h := range hidden {
		if !toRemove[h.SessionID] {
			next = append(next, h)
		}
	}
	if len(next) == 0 {
		delete(cs.config.Sessions.HiddenSessions, projectID)
	} else {
		cs.config.Sessions.HiddenSessions[projectID] = next
	}
	_ = cs.saveConfig()
}

// ─── SSH Last Connection ──────────────────────────────────────────────────────

// UpdateSSHLastConnection mirrors ConfigState::update_ssh_last_connection.
func (cs *ConfigState) UpdateSSHLastConnection(last *SshLastConnection) {
	cs.mu.Lock()
	defer cs.mu.Unlock()
	cs.ensureLoaded()
	cs.config.SSH.LastConnection = last
	_ = cs.saveConfig()
}

// ─── Bookmarks ────────────────────────────────────────────────────────────────

// AddBookmark mirrors ConfigState::add_bookmark.
func (cs *ConfigState) AddBookmark(entry BookmarkEntry) {
	cs.mu.Lock()
	defer cs.mu.Unlock()
	cs.ensureLoaded()
	cs.config.Sessions.Bookmarks = append(cs.config.Sessions.Bookmarks, entry)
	_ = cs.saveConfig()
}

// RemoveBookmark mirrors ConfigState::remove_bookmark.
func (cs *ConfigState) RemoveBookmark(bookmarkID string) {
	cs.mu.Lock()
	defer cs.mu.Unlock()
	cs.ensureLoaded()

	next := cs.config.Sessions.Bookmarks[:0]
	for _, b := range cs.config.Sessions.Bookmarks {
		if b.ID != bookmarkID {
			next = append(next, b)
		}
	}
	cs.config.Sessions.Bookmarks = next
	_ = cs.saveConfig()
}

// GetBookmarks mirrors ConfigState::get_bookmarks.
func (cs *ConfigState) GetBookmarks() []BookmarkEntry {
	cs.mu.Lock()
	defer cs.mu.Unlock()
	cs.ensureLoaded()
	return append([]BookmarkEntry{}, cs.config.Sessions.Bookmarks...)
}

// ─── Annotations ─────────────────────────────────────────────────────────────

// AddAnnotation mirrors ConfigState::add_annotation.
func (cs *ConfigState) AddAnnotation(entry AnnotationEntry) {
	cs.mu.Lock()
	defer cs.mu.Unlock()
	cs.ensureLoaded()
	cs.config.Sessions.Annotations = append(cs.config.Sessions.Annotations, entry)
	_ = cs.saveConfig()
}

// UpdateAnnotation mirrors ConfigState::update_annotation.
// Returns true if the annotation was found and updated.
func (cs *ConfigState) UpdateAnnotation(annotationID string, text, color *string, updatedAt float64) bool {
	cs.mu.Lock()
	defer cs.mu.Unlock()
	cs.ensureLoaded()

	for i := range cs.config.Sessions.Annotations {
		a := &cs.config.Sessions.Annotations[i]
		if a.ID == annotationID {
			if text != nil {
				a.Text = *text
			}
			if color != nil {
				a.Color = *color
			}
			a.UpdatedAt = updatedAt
			_ = cs.saveConfig()
			return true
		}
	}
	return false
}

// RemoveAnnotation mirrors ConfigState::remove_annotation.
func (cs *ConfigState) RemoveAnnotation(annotationID string) {
	cs.mu.Lock()
	defer cs.mu.Unlock()
	cs.ensureLoaded()

	next := cs.config.Sessions.Annotations[:0]
	for _, a := range cs.config.Sessions.Annotations {
		if a.ID != annotationID {
			next = append(next, a)
		}
	}
	cs.config.Sessions.Annotations = next
	_ = cs.saveConfig()
}

// GetAnnotations mirrors ConfigState::get_annotations.
func (cs *ConfigState) GetAnnotations() []AnnotationEntry {
	cs.mu.Lock()
	defer cs.mu.Unlock()
	cs.ensureLoaded()
	return append([]AnnotationEntry{}, cs.config.Sessions.Annotations...)
}

// ─── Session Tags ─────────────────────────────────────────────────────────────

// SetSessionTags mirrors ConfigState::set_session_tags.
func (cs *ConfigState) SetSessionTags(sessionID string, tags []string) {
	cs.mu.Lock()
	defer cs.mu.Unlock()
	cs.ensureLoaded()

	if len(tags) == 0 {
		delete(cs.config.Sessions.SessionTags, sessionID)
	} else {
		cs.config.Sessions.SessionTags[sessionID] = tags
	}
	_ = cs.saveConfig()
}

// GetSessionTags mirrors ConfigState::get_session_tags.
func (cs *ConfigState) GetSessionTags(sessionID string) []string {
	cs.mu.Lock()
	defer cs.mu.Unlock()
	cs.ensureLoaded()

	tags := cs.config.Sessions.SessionTags[sessionID]
	if tags == nil {
		return []string{}
	}
	return append([]string{}, tags...)
}

// ─── Session Groups ───────────────────────────────────────────────────────────

// CreateSessionGroup mirrors ConfigState::create_session_group.
func (cs *ConfigState) CreateSessionGroup(name string) bool {
	cs.mu.Lock()
	defer cs.mu.Unlock()
	cs.ensureLoaded()

	if _, exists := cs.config.Sessions.SessionGroups[name]; exists {
		return false
	}
	cs.config.Sessions.SessionGroups[name] = []string{}
	_ = cs.saveConfig()
	return true
}

// DeleteSessionGroup mirrors ConfigState::delete_session_group.
func (cs *ConfigState) DeleteSessionGroup(name string) {
	cs.mu.Lock()
	defer cs.mu.Unlock()
	cs.ensureLoaded()
	delete(cs.config.Sessions.SessionGroups, name)
	_ = cs.saveConfig()
}

// AddToSessionGroup mirrors ConfigState::add_to_session_group.
func (cs *ConfigState) AddToSessionGroup(name, sessionID string) {
	cs.mu.Lock()
	defer cs.mu.Unlock()
	cs.ensureLoaded()

	group := cs.config.Sessions.SessionGroups[name]
	for _, s := range group {
		if s == sessionID {
			return
		}
	}
	cs.config.Sessions.SessionGroups[name] = append(group, sessionID)
	_ = cs.saveConfig()
}

// RemoveFromSessionGroup mirrors ConfigState::remove_from_session_group.
func (cs *ConfigState) RemoveFromSessionGroup(name, sessionID string) {
	cs.mu.Lock()
	defer cs.mu.Unlock()
	cs.ensureLoaded()

	group, ok := cs.config.Sessions.SessionGroups[name]
	if !ok {
		return
	}
	next := group[:0]
	for _, s := range group {
		if s != sessionID {
			next = append(next, s)
		}
	}
	cs.config.Sessions.SessionGroups[name] = next
	_ = cs.saveConfig()
}

// GetSessionGroups mirrors ConfigState::get_session_groups.
func (cs *ConfigState) GetSessionGroups() map[string][]string {
	cs.mu.Lock()
	defer cs.mu.Unlock()
	cs.ensureLoaded()

	result := make(map[string][]string, len(cs.config.Sessions.SessionGroups))
	for k, v := range cs.config.Sessions.SessionGroups {
		result[k] = append([]string{}, v...)
	}
	return result
}

// ─── Filter Presets ───────────────────────────────────────────────────────────

// AddFilterPreset mirrors ConfigState::add_filter_preset.
func (cs *ConfigState) AddFilterPreset(preset FilterPreset) {
	cs.mu.Lock()
	defer cs.mu.Unlock()
	cs.ensureLoaded()
	cs.config.Sessions.FilterPresets = append(cs.config.Sessions.FilterPresets, preset)
	_ = cs.saveConfig()
}

// RemoveFilterPreset mirrors ConfigState::remove_filter_preset.
func (cs *ConfigState) RemoveFilterPreset(presetID string) {
	cs.mu.Lock()
	defer cs.mu.Unlock()
	cs.ensureLoaded()

	next := cs.config.Sessions.FilterPresets[:0]
	for _, p := range cs.config.Sessions.FilterPresets {
		if p.ID != presetID {
			next = append(next, p)
		}
	}
	cs.config.Sessions.FilterPresets = next
	if cs.config.Sessions.DefaultFilterPresetID != nil && *cs.config.Sessions.DefaultFilterPresetID == presetID {
		cs.config.Sessions.DefaultFilterPresetID = nil
	}
	_ = cs.saveConfig()
}

// RenameFilterPreset mirrors ConfigState::rename_filter_preset.
func (cs *ConfigState) RenameFilterPreset(presetID, name string) bool {
	cs.mu.Lock()
	defer cs.mu.Unlock()
	cs.ensureLoaded()

	for i := range cs.config.Sessions.FilterPresets {
		if cs.config.Sessions.FilterPresets[i].ID == presetID {
			cs.config.Sessions.FilterPresets[i].Name = name
			_ = cs.saveConfig()
			return true
		}
	}
	return false
}

// SetDefaultFilterPreset mirrors ConfigState::set_default_filter_preset.
func (cs *ConfigState) SetDefaultFilterPreset(presetID *string) {
	cs.mu.Lock()
	defer cs.mu.Unlock()
	cs.ensureLoaded()

	if presetID != nil {
		found := false
		for _, p := range cs.config.Sessions.FilterPresets {
			if p.ID == *presetID {
				found = true
				break
			}
		}
		if !found {
			return
		}
	}
	cs.config.Sessions.DefaultFilterPresetID = presetID
	_ = cs.saveConfig()
}

// ─── Annotation/Bookmark Export/Import ───────────────────────────────────────

// ExportAnnotationsBundle mirrors ConfigState::export_annotations_bundle.
func (cs *ConfigState) ExportAnnotationsBundle(sessionIDs []string) AnnotationExportBundle {
	cs.mu.Lock()
	defer cs.mu.Unlock()
	cs.ensureLoaded()

	wantAll := len(sessionIDs) == 0
	sessionSet := make(map[string]bool, len(sessionIDs))
	for _, id := range sessionIDs {
		sessionSet[id] = true
	}

	var annotations []AnnotationEntry
	for _, a := range cs.config.Sessions.Annotations {
		if wantAll || sessionSet[a.SessionID] {
			annotations = append(annotations, a)
		}
	}
	if annotations == nil {
		annotations = []AnnotationEntry{}
	}

	var bookmarks []BookmarkEntry
	for _, b := range cs.config.Sessions.Bookmarks {
		if wantAll || sessionSet[b.SessionID] {
			bookmarks = append(bookmarks, b)
		}
	}
	if bookmarks == nil {
		bookmarks = []BookmarkEntry{}
	}

	return AnnotationExportBundle{
		Version:     1,
		ExportedAt:  nowMillis(),
		Annotations: annotations,
		Bookmarks:   bookmarks,
	}
}

// ImportAnnotationsBundle mirrors ConfigState::import_annotations_bundle.
func (cs *ConfigState) ImportAnnotationsBundle(bundle AnnotationExportBundle) ImportReport {
	cs.mu.Lock()
	defer cs.mu.Unlock()
	cs.ensureLoaded()

	var report ImportReport

	for _, incoming := range bundle.Annotations {
		foundIdx := -1
		for i, a := range cs.config.Sessions.Annotations {
			if a.SessionID == incoming.SessionID && a.TargetID == incoming.TargetID {
				foundIdx = i
				break
			}
		}
		if foundIdx >= 0 {
			existing := cs.config.Sessions.Annotations[foundIdx]
			if incoming.UpdatedAt > existing.UpdatedAt {
				cs.config.Sessions.Annotations[foundIdx] = incoming
				report.AnnotationsUpdated++
			} else {
				report.AnnotationsSkipped++
			}
		} else {
			cs.config.Sessions.Annotations = append(cs.config.Sessions.Annotations, incoming)
			report.AnnotationsAdded++
		}
	}

	for _, incoming := range bundle.Bookmarks {
		exists := false
		for _, b := range cs.config.Sessions.Bookmarks {
			if b.SessionID == incoming.SessionID && b.GroupID == incoming.GroupID {
				exists = true
				break
			}
		}
		if exists {
			report.BookmarksSkipped++
		} else {
			cs.config.Sessions.Bookmarks = append(cs.config.Sessions.Bookmarks, incoming)
			report.BookmarksAdded++
		}
	}

	_ = cs.saveConfig()
	return report
}

// ─── UUID helper ──────────────────────────────────────────────────────────────

// NewUUID returns a new random UUID string (mirrors uuid::Uuid::new_v4).
func NewUUID() string {
	return uuid.New().String()
}
