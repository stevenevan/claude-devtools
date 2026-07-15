// Package config ports src-tauri/src/config/types/ to Go.
// Every struct uses explicit json tags to match serde rename_all="camelCase" exactly.
// Option<T> with skip_serializing_if="Option::is_none" → *T + omitempty.
// Option<T> without skip_serializing_if                → *T (no omitempty).
// Vec<T>                                               → []T initialised to []T{} (never nil).
package config

import "encoding/json"

// ── General ──────────────────────────────────────────────────────────────────

// GeneralConfig mirrors src-tauri/src/config/types/general.rs GeneralConfig.
type GeneralConfig struct {
	LaunchAtLogin      bool    `json:"launchAtLogin"`
	Theme              string  `json:"theme"`
	DefaultTab         string  `json:"defaultTab"`
	ClaudeRootPath     *string `json:"claudeRootPath"`
	AutoExpandAIGroups bool    `json:"autoExpandAIGroups"`
	UseNativeTitleBar  bool    `json:"useNativeTitleBar"`
}

func defaultGeneralConfig() GeneralConfig {
	return GeneralConfig{
		LaunchAtLogin:      false,
		Theme:              "dark",
		DefaultTab:         "dashboard",
		ClaudeRootPath:     nil,
		AutoExpandAIGroups: false,
		UseNativeTitleBar:  false,
	}
}

// DisplayConfig mirrors src-tauri/src/config/types/general.rs DisplayConfig.
// code_block_theme defaults to "default"; show_line_numbers defaults to true.
type DisplayConfig struct {
	CodeBlockTheme  string `json:"codeBlockTheme"`
	ShowLineNumbers bool   `json:"showLineNumbers"`
	WordWrap        bool   `json:"wordWrap"`
}

func defaultDisplayConfig() DisplayConfig {
	return DisplayConfig{
		CodeBlockTheme:  "default",
		ShowLineNumbers: true,
		WordWrap:        false,
	}
}

// ── Notifications ─────────────────────────────────────────────────────────────

// NotificationTrigger mirrors src-tauri/src/config/types/notifications.rs.
// All optional fields use omitempty to match skip_serializing_if="Option::is_none".
type NotificationTrigger struct {
	ID             string    `json:"id"`
	Name           string    `json:"name"`
	Enabled        bool      `json:"enabled"`
	ContentType    string    `json:"contentType"`
	Mode           string    `json:"mode"`
	ToolName       *string   `json:"toolName,omitempty"`
	IsBuiltin      *bool     `json:"isBuiltin,omitempty"`
	IgnorePatterns *[]string `json:"ignorePatterns,omitempty"`
	RequireError   *bool     `json:"requireError,omitempty"`
	MatchField     *string   `json:"matchField,omitempty"`
	MatchPattern   *string   `json:"matchPattern,omitempty"`
	TokenThreshold *float64  `json:"tokenThreshold,omitempty"`
	TokenType      *string   `json:"tokenType,omitempty"`
	RepositoryIDs  *[]string `json:"repositoryIds,omitempty"`
	Color          *string   `json:"color,omitempty"`
}

// NotificationConfig mirrors src-tauri/src/config/types/notifications.rs.
// snoozed_until has no skip_serializing_if → *float64 without omitempty.
type NotificationConfig struct {
	Enabled               bool                  `json:"enabled"`
	SoundEnabled          bool                  `json:"soundEnabled"`
	IgnoredRegex          []string              `json:"ignoredRegex"`
	IgnoredRepositories   []string              `json:"ignoredRepositories"`
	SnoozedUntil          *float64              `json:"snoozedUntil"`
	SnoozeMinutes         uint32                `json:"snoozeMinutes"`
	IncludeSubagentErrors bool                  `json:"includeSubagentErrors"`
	Triggers              []NotificationTrigger `json:"triggers"`
	// RetentionDays / MaxCount bound the app's own notification store (W13
	// auto-prune). 0 = unbounded for that dimension.
	RetentionDays int `json:"retentionDays"`
	MaxCount      int `json:"maxCount"`
}

func defaultNotificationConfig() NotificationConfig {
	return NotificationConfig{
		Enabled:               true,
		SoundEnabled:          true,
		IgnoredRegex:          []string{`The user doesn't want to proceed with this tool use\.`},
		IgnoredRepositories:   []string{},
		SnoozedUntil:          nil,
		SnoozeMinutes:         30,
		IncludeSubagentErrors: true,
		Triggers:              DefaultTriggers(),
		RetentionDays:         30,
		MaxCount:              200,
	}
}

// ── Sessions ──────────────────────────────────────────────────────────────────

// PinnedSession mirrors src-tauri/src/config/types/sessions.rs.
type PinnedSession struct {
	SessionID string  `json:"sessionId"`
	PinnedAt  float64 `json:"pinnedAt"`
}

// HiddenSession mirrors src-tauri/src/config/types/sessions.rs.
type HiddenSession struct {
	SessionID string  `json:"sessionId"`
	HiddenAt  float64 `json:"hiddenAt"`
}

// BookmarkEntry mirrors src-tauri/src/config/types/sessions.rs.
// note is Option with skip_serializing_if → omitempty.
type BookmarkEntry struct {
	ID        string  `json:"id"`
	SessionID string  `json:"sessionId"`
	ProjectID string  `json:"projectId"`
	GroupID   string  `json:"groupId"`
	Note      *string `json:"note,omitempty"`
	CreatedAt float64 `json:"createdAt"`
}

// AnnotationEntry mirrors src-tauri/src/config/types/sessions.rs.
type AnnotationEntry struct {
	ID        string  `json:"id"`
	SessionID string  `json:"sessionId"`
	ProjectID string  `json:"projectId"`
	TargetID  string  `json:"targetId"`
	Text      string  `json:"text"`
	Color     string  `json:"color"`
	CreatedAt float64 `json:"createdAt"`
	UpdatedAt float64 `json:"updatedAt"`
}

// FilterPreset mirrors src-tauri/src/config/types/sessions.rs.
// filter is stored as raw JSON (serde_json::Value) → json.RawMessage.
type FilterPreset struct {
	ID        string          `json:"id"`
	Name      string          `json:"name"`
	Filter    json.RawMessage `json:"filter"`
	CreatedAt float64         `json:"createdAt"`
}

// AnnotationExportBundle mirrors src-tauri/src/config/types/sessions.rs.
type AnnotationExportBundle struct {
	Version     uint32            `json:"version"`
	ExportedAt  float64           `json:"exportedAt"`
	Annotations []AnnotationEntry `json:"annotations"`
	Bookmarks   []BookmarkEntry   `json:"bookmarks"`
}

// ImportReport mirrors src-tauri/src/config/types/sessions.rs.
type ImportReport struct {
	AnnotationsAdded   uint32 `json:"annotationsAdded"`
	AnnotationsUpdated uint32 `json:"annotationsUpdated"`
	AnnotationsSkipped uint32 `json:"annotationsSkipped"`
	BookmarksAdded     uint32 `json:"bookmarksAdded"`
	BookmarksSkipped   uint32 `json:"bookmarksSkipped"`
}

// SessionsConfig mirrors src-tauri/src/config/types/sessions.rs.
// default_filter_preset_id is Option + skip_serializing_if → omitempty.
type SessionsConfig struct {
	PinnedSessions        map[string][]PinnedSession `json:"pinnedSessions"`
	HiddenSessions        map[string][]HiddenSession `json:"hiddenSessions"`
	Bookmarks             []BookmarkEntry            `json:"bookmarks"`
	SessionTags           map[string][]string        `json:"sessionTags"`
	Annotations           []AnnotationEntry          `json:"annotations"`
	SessionGroups         map[string][]string        `json:"sessionGroups"`
	FilterPresets         []FilterPreset             `json:"filterPresets"`
	DefaultFilterPresetID *string                    `json:"defaultFilterPresetId,omitempty"`
}

func defaultSessionsConfig() SessionsConfig {
	return SessionsConfig{
		PinnedSessions: map[string][]PinnedSession{},
		HiddenSessions: map[string][]HiddenSession{},
		Bookmarks:      []BookmarkEntry{},
		SessionTags:    map[string][]string{},
		Annotations:    []AnnotationEntry{},
		SessionGroups:  map[string][]string{},
		FilterPresets:  []FilterPreset{},
	}
}

// ── SSH ───────────────────────────────────────────────────────────────────────

// SshLastConnection mirrors src-tauri/src/config/types/ssh.rs.
type SshLastConnection struct {
	Host           string  `json:"host"`
	Port           uint16  `json:"port"`
	Username       string  `json:"username"`
	AuthMethod     string  `json:"authMethod"`
	PrivateKeyPath *string `json:"privateKeyPath,omitempty"`
}

// SshConnectionProfile mirrors src-tauri/src/config/types/ssh.rs.
type SshConnectionProfile struct {
	ID             string  `json:"id"`
	Name           string  `json:"name"`
	Host           string  `json:"host"`
	Port           uint16  `json:"port"`
	Username       string  `json:"username"`
	AuthMethod     string  `json:"authMethod"`
	PrivateKeyPath *string `json:"privateKeyPath,omitempty"`
}

// SshPersistConfig mirrors src-tauri/src/config/types/ssh.rs.
// last_connection is Option<T> without skip_serializing_if → *T no omitempty.
type SshPersistConfig struct {
	LastConnection      *SshLastConnection     `json:"lastConnection"`
	AutoReconnect       bool                   `json:"autoReconnect"`
	Profiles            []SshConnectionProfile `json:"profiles"`
	LastActiveContextID string                 `json:"lastActiveContextId"`
}

func defaultSshPersistConfig() SshPersistConfig {
	return SshPersistConfig{
		LastConnection:      nil,
		AutoReconnect:       false,
		Profiles:            []SshConnectionProfile{},
		LastActiveContextID: "local",
	}
}

// ── HTTP ──────────────────────────────────────────────────────────────────────

// HttpServerConfig mirrors src-tauri/src/config/types/http.rs.
type HttpServerConfig struct {
	Enabled bool   `json:"enabled"`
	Port    uint16 `json:"port"`
}

func defaultHttpServerConfig() HttpServerConfig {
	return HttpServerConfig{Enabled: false, Port: 3456}
}

// ClaudeRootInfo mirrors src-tauri/src/config/types/http.rs.
// configured_path is Option<T> without skip → *string no omitempty.
type ClaudeRootInfo struct {
	DefaultPath    string  `json:"defaultPath"`
	ConfiguredPath *string `json:"configuredPath"`
	EffectivePath  string  `json:"effectivePath"`
}

// ── Dashboard ─────────────────────────────────────────────────────────────────

// DashboardConfig mirrors src-tauri/src/config/types/dashboard.rs.
type DashboardConfig struct {
	WidgetOrder   []string `json:"widgetOrder"`
	HiddenWidgets []string `json:"hiddenWidgets"`
}

func defaultDashboardConfig() DashboardConfig {
	return DashboardConfig{WidgetOrder: []string{}, HiddenWidgets: []string{}}
}

// ── App (themes, shortcuts, plugins) ─────────────────────────────────────────

// CustomTheme mirrors src-tauri/src/config/types/app.rs.
type CustomTheme struct {
	ID        string            `json:"id"`
	Name      string            `json:"name"`
	BasedOn   string            `json:"basedOn"`
	Overrides map[string]string `json:"overrides"`
}

// ThemesConfig mirrors src-tauri/src/config/types/app.rs.
// active_id is Option + skip_serializing_if → omitempty.
type ThemesConfig struct {
	ActiveID *string       `json:"activeId,omitempty"`
	Custom   []CustomTheme `json:"custom"`
}

func defaultThemesConfig() ThemesConfig {
	return ThemesConfig{Custom: []CustomTheme{}}
}

// ShortcutsConfig mirrors src-tauri/src/config/types/app.rs.
type ShortcutsConfig struct {
	Overrides map[string]string `json:"overrides"`
}

func defaultShortcutsConfig() ShortcutsConfig {
	return ShortcutsConfig{Overrides: map[string]string{}}
}

// PluginsConfig mirrors src-tauri/src/config/types/app.rs.
type PluginsConfig struct {
	Enabled []string `json:"enabled"`
}

func defaultPluginsConfig() PluginsConfig {
	return PluginsConfig{Enabled: []string{}}
}

// ── Notification rules + webhooks (opaque payloads) ──────────────────────────

// NotificationRule is stored opaquely — the Go port doesn't need to evaluate
// rules in W4; it just persists them faithfully as raw JSON matching the Rust shape.
// Rust uses serde tag="kind" + rename_all="camelCase" throughout.
type NotificationRule = json.RawMessage

// WebhookEndpoint mirrors src-tauri/src/notifications/webhook.rs.
type WebhookEndpoint struct {
	ID       string `json:"id"`
	Label    string `json:"label"`
	URL      string `json:"url"`
	Template string `json:"template"`
}

// ── Retention (W31) ───────────────────────────────────────────────────────────

// trashGovernedPolicyIDs are the 15 registerMatcher category ids whose cleanup
// routes through the reversible trash engine, PLUS "history" (a special-cased
// non-matcher path). The 3 plain-delete ids {logs, logs-daemon, caches} are
// intentionally excluded — trashing a regenerable log/cache would wrongly
// extend its retention (see internal/maintenance/plaindelete.go), so the policy
// never governs them (Architect HIGH-1). Enumerated here because the maintenance
// package exposes no accessor to list registered ids.
var trashGovernedPolicyIDs = []string{
	"backup-binaries", "file-history", "junk-dsstore", "junk-tmp",
	"junk-emptydirs", "plans", "plugins", "projects", "runtime-tasks",
	"runtime-tasks-empty", "runtime-jobs", "runtime-sessions",
	"runtime-session-env", "runtime-shell-snapshots", "transcripts",
	"history",
}

// RetentionCategory is one category's toggle in the W31 retention policy. The
// age cutoff is NOT stored here — it lives in the single MaintenanceCutoffs
// store (read via GetMaintenanceCutoff/CutoffDefault) so preview and execution
// always agree (Architect HIGH-2).
type RetentionCategory struct {
	Enabled      bool `json:"enabled"`
	AutoApproved bool `json:"autoApproved"`
}

// RetentionPolicy composes the per-category cleanups into one Clean-now policy
// plus a trash auto-expiry window (days). Categories is keyed by leaf category
// id (the 15 trash-governed matchers + "history").
type RetentionPolicy struct {
	Categories      map[string]RetentionCategory `json:"categories"`
	TrashExpiryDays int                          `json:"trashExpiryDays"`
	// ScheduleInterval drives the W32 in-app scheduler: "off" (default),
	// "weekly" (7d), or "monthly" (30d). The last-run anchor is LastCleanupMs.
	// Only AutoApproved categories run unattended; the rest raise a pending
	// notification.
	ScheduleInterval string `json:"scheduleInterval"`
}

func defaultRetentionPolicy() RetentionPolicy {
	cats := make(map[string]RetentionCategory, len(trashGovernedPolicyIDs))
	for _, id := range trashGovernedPolicyIDs {
		cats[id] = RetentionCategory{Enabled: true, AutoApproved: false}
	}
	return RetentionPolicy{Categories: cats, TrashExpiryDays: 30, ScheduleInterval: "off"}
}

// ── AppConfig (top-level) ─────────────────────────────────────────────────────

// AppConfig mirrors src-tauri/src/config/types/app.rs AppConfig.
// onboarding_completed defaults false.
type AppConfig struct {
	Notifications       NotificationConfig `json:"notifications"`
	General             GeneralConfig      `json:"general"`
	Display             DisplayConfig      `json:"display"`
	Sessions            SessionsConfig     `json:"sessions"`
	SSH                 SshPersistConfig   `json:"ssh"`
	HTTPServer          HttpServerConfig   `json:"httpServer"`
	Dashboard           DashboardConfig    `json:"dashboard"`
	Shortcuts           ShortcutsConfig    `json:"shortcuts"`
	Themes              ThemesConfig       `json:"themes"`
	Plugins             PluginsConfig      `json:"plugins"`
	NotificationRules   []NotificationRule `json:"notificationRules"`
	WebhookEndpoints    []WebhookEndpoint  `json:"webhookEndpoints"`
	OnboardingCompleted bool               `json:"onboardingCompleted"`
	// MaintenanceCutoffs holds per-category age cutoffs (days) for the storage
	// cleanup panels, keyed by leaf category id (e.g. "transcripts",
	// "runtime-tasks"). Absent key = the category's built-in default.
	MaintenanceCutoffs map[string]int `json:"maintenanceCutoffs"`
	// DismissedSuggestions holds permission-rule suggestion strings (W30) the
	// user has dismissed. A dismissed rule stays hidden across restarts.
	DismissedSuggestions []string `json:"dismissedSuggestions"`
	// Retention is the W31 composed cleanup policy (per-category enable +
	// auto-approve + trash-expiry window). Cutoffs stay in MaintenanceCutoffs.
	Retention RetentionPolicy `json:"retention"`
	// LastCleanupMs is the app's OWN record of its last policy Clean-now run
	// (ms since epoch). The CLI-owned .last-cleanup file is never written.
	LastCleanupMs float64 `json:"lastCleanupMs"`
}

// DefaultAppConfig returns an AppConfig equivalent to Rust's AppConfig::default().
func DefaultAppConfig() AppConfig {
	return AppConfig{
		Notifications:        defaultNotificationConfig(),
		General:              defaultGeneralConfig(),
		Display:              defaultDisplayConfig(),
		Sessions:             defaultSessionsConfig(),
		SSH:                  defaultSshPersistConfig(),
		HTTPServer:           defaultHttpServerConfig(),
		Dashboard:            defaultDashboardConfig(),
		Shortcuts:            defaultShortcutsConfig(),
		Themes:               defaultThemesConfig(),
		Plugins:              defaultPluginsConfig(),
		NotificationRules:    []NotificationRule{},
		WebhookEndpoints:     []WebhookEndpoint{},
		OnboardingCompleted:  false,
		MaintenanceCutoffs:   map[string]int{},
		DismissedSuggestions: []string{},
		Retention:            defaultRetentionPolicy(),
		LastCleanupMs:        0,
	}
}
