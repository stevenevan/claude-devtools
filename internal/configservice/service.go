// Package configservice wires all 40 config_* commands as Wails v3 service methods.
// ConfigService owns a ConfigState lazily initialised on first use (zero-value safe).
// No constructor required — main.go registers &ConfigService{} unchanged.
package configservice

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"os/exec"
	"runtime"
	"time"

	autostart "github.com/spiretechnology/go-autostart/v2"
	"github.com/wailsapp/wails/v3/pkg/application"

	"claude-devtools/internal/config"
)

// ConfigService is the Wails v3 service exposing all config commands.
// The embedded ConfigState is lazily initialised; callers only need &ConfigService{}.
type ConfigService struct {
	state config.ConfigState
}

// Ready satisfies the Wails service interface.
func (s *ConfigService) Ready() (bool, error) { return true, nil }

// ServiceStartup implements the Wails v3 Service lifecycle hook.
// Reads the persisted config and synchronises the OS autostart registration
// so the LaunchAtLogin setting takes effect immediately on app start.
func (s *ConfigService) ServiceStartup(_ context.Context, _ application.ServiceOptions) error {
	cfg := s.state.GetConfig() // triggers lazy load from disk
	if err := syncAutostart(cfg.General.LaunchAtLogin); err != nil {
		slog.Warn("autostart sync on startup failed", "err", err)
	}
	return nil
}

// ServiceShutdown satisfies the Wails v3 Service lifecycle hook.
func (s *ConfigService) ServiceShutdown() error { return nil }

// syncAutostart enables or disables the OS launch-at-login entry.
// Uses ModeUser (LaunchAgents on macOS). Errors are non-fatal — the caller
// logs and continues so a missing HOME or sandboxed env doesn't block startup.
func syncAutostart(enable bool) error {
	a := autostart.New(autostart.Options{
		Label:  "com.claude-devtools",
		Vendor: "claude-devtools",
		Name:   "claude-devtools",
		Mode:   autostart.ModeUser,
	})
	if enable {
		return a.Enable()
	}
	return a.Disable()
}

// ─── nowMS mirrors the Rust now_ms() helper in commands.rs ───────────────────

func nowMS() float64 {
	return float64(time.Now().UnixNano()) / 1e6
}

// ─── config_get ───────────────────────────────────────────────────────────────

// ConfigGet returns the full AppConfig (with snooze auto-expiry).
func (s *ConfigService) ConfigGet() (config.AppConfig, error) {
	return s.state.GetConfig(), nil
}

// ─── config_update ────────────────────────────────────────────────────────────

// ConfigUpdate validates and merges a partial section update, then persists.
// section: one of notifications, general, display, httpServer, ssh, dashboard,
//
//	shortcuts, themes, plugins, notificationRules, webhookEndpoints, onboarding.
//
// data: JSON object (or array for notificationRules/webhookEndpoints).
// When section is "general" and launchAtLogin changed, syncs the OS autostart
// registration so the UI toggle takes effect immediately.
func (s *ConfigService) ConfigUpdate(section string, data json.RawMessage) (config.AppConfig, error) {
	result, err := s.state.UpdateConfig(section, data)
	if err != nil {
		return config.AppConfig{}, err
	}
	if section == "general" {
		if syncErr := syncAutostart(result.General.LaunchAtLogin); syncErr != nil {
			slog.Warn("autostart sync on config update failed", "err", syncErr)
		}
	}
	return result, nil
}

// ─── config_add_ignore_regex ─────────────────────────────────────────────────

func (s *ConfigService) ConfigAddIgnoreRegex(pattern string) (config.AppConfig, error) {
	return s.state.AddIgnoreRegex(pattern)
}

// ─── config_remove_ignore_regex ───────────────────────────────────────────────

func (s *ConfigService) ConfigRemoveIgnoreRegex(pattern string) (config.AppConfig, error) {
	return s.state.RemoveIgnoreRegex(pattern), nil
}

// ─── config_add_ignore_repository ────────────────────────────────────────────

func (s *ConfigService) ConfigAddIgnoreRepository(repositoryID string) (config.AppConfig, error) {
	return s.state.AddIgnoreRepository(repositoryID)
}

// ─── config_remove_ignore_repository ─────────────────────────────────────────

func (s *ConfigService) ConfigRemoveIgnoreRepository(repositoryID string) (config.AppConfig, error) {
	return s.state.RemoveIgnoreRepository(repositoryID), nil
}

// ─── config_snooze ───────────────────────────────────────────────────────────

// ConfigSnooze sets snoozedUntil. minutes=nil uses the stored snoozeMinutes value.
func (s *ConfigService) ConfigSnooze(minutes *uint32) (config.AppConfig, error) {
	return s.state.Snooze(minutes), nil
}

// ─── config_clear_snooze ─────────────────────────────────────────────────────

func (s *ConfigService) ConfigClearSnooze() (config.AppConfig, error) {
	return s.state.ClearSnooze(), nil
}

// ─── config_add_trigger ───────────────────────────────────────────────────────

func (s *ConfigService) ConfigAddTrigger(trigger config.NotificationTrigger) (config.AppConfig, error) {
	return s.state.AddTrigger(trigger)
}

// ─── config_update_trigger ───────────────────────────────────────────────────

func (s *ConfigService) ConfigUpdateTrigger(triggerID string, updates json.RawMessage) (config.AppConfig, error) {
	return s.state.UpdateTrigger(triggerID, updates)
}

// ─── config_remove_trigger ───────────────────────────────────────────────────

func (s *ConfigService) ConfigRemoveTrigger(triggerID string) (config.AppConfig, error) {
	return s.state.RemoveTrigger(triggerID)
}

// ─── config_get_triggers ─────────────────────────────────────────────────────

func (s *ConfigService) ConfigGetTriggers() ([]config.NotificationTrigger, error) {
	return s.state.GetTriggers(), nil
}

// ─── config_pin_session ───────────────────────────────────────────────────────

func (s *ConfigService) ConfigPinSession(projectID, sessionID string) error {
	s.state.PinSession(projectID, sessionID)
	return nil
}

// ─── config_unpin_session ────────────────────────────────────────────────────

func (s *ConfigService) ConfigUnpinSession(projectID, sessionID string) error {
	s.state.UnpinSession(projectID, sessionID)
	return nil
}

// ─── config_hide_session ─────────────────────────────────────────────────────

func (s *ConfigService) ConfigHideSession(projectID, sessionID string) error {
	s.state.HideSession(projectID, sessionID)
	return nil
}

// ─── config_unhide_session ───────────────────────────────────────────────────

func (s *ConfigService) ConfigUnhideSession(projectID, sessionID string) error {
	s.state.UnhideSession(projectID, sessionID)
	return nil
}

// ─── config_hide_sessions ────────────────────────────────────────────────────

func (s *ConfigService) ConfigHideSessions(projectID string, sessionIDs []string) error {
	s.state.HideSessions(projectID, sessionIDs)
	return nil
}

// ─── config_unhide_sessions ──────────────────────────────────────────────────

func (s *ConfigService) ConfigUnhideSessions(projectID string, sessionIDs []string) error {
	s.state.UnhideSessions(projectID, sessionIDs)
	return nil
}

// ─── config_get_claude_root_info ─────────────────────────────────────────────

func (s *ConfigService) ConfigGetClaudeRootInfo() (config.ClaudeRootInfo, error) {
	return s.state.GetClaudeRootInfo(), nil
}

// ─── config_open_in_editor ───────────────────────────────────────────────────

// ConfigOpenInEditor opens the FIXED config file path in the OS default editor.
// No path argument accepted — the path is determined internally to prevent injection.
// macOS: open, Linux: xdg-open, Windows: explorer.
func (s *ConfigService) ConfigOpenInEditor() error {
	path := s.state.GetConfigPath()
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "darwin":
		cmd = exec.Command("open", path)
	case "windows":
		cmd = exec.Command("explorer", path)
	default:
		cmd = exec.Command("xdg-open", path)
	}
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("Failed to open config file: %w", err)
	}
	return nil
}

// ─── config_add_bookmark ─────────────────────────────────────────────────────

func (s *ConfigService) ConfigAddBookmark(sessionID, projectID, groupID string, note *string) error {
	s.state.AddBookmark(config.BookmarkEntry{
		ID:        config.NewUUID(),
		SessionID: sessionID,
		ProjectID: projectID,
		GroupID:   groupID,
		Note:      note,
		CreatedAt: nowMS(),
	})
	return nil
}

// ─── config_remove_bookmark ──────────────────────────────────────────────────

func (s *ConfigService) ConfigRemoveBookmark(bookmarkID string) error {
	s.state.RemoveBookmark(bookmarkID)
	return nil
}

// ─── config_get_bookmarks ────────────────────────────────────────────────────

func (s *ConfigService) ConfigGetBookmarks() ([]config.BookmarkEntry, error) {
	return s.state.GetBookmarks(), nil
}

// ─── config_add_annotation ───────────────────────────────────────────────────

func (s *ConfigService) ConfigAddAnnotation(
	sessionID, projectID, targetID, text, color string,
) (config.AnnotationEntry, error) {
	now := nowMS()
	entry := config.AnnotationEntry{
		ID:        config.NewUUID(),
		SessionID: sessionID,
		ProjectID: projectID,
		TargetID:  targetID,
		Text:      text,
		Color:     color,
		CreatedAt: now,
		UpdatedAt: now,
	}
	s.state.AddAnnotation(entry)
	return entry, nil
}

// ─── config_update_annotation ────────────────────────────────────────────────

func (s *ConfigService) ConfigUpdateAnnotation(annotationID string, text, color *string) (bool, error) {
	return s.state.UpdateAnnotation(annotationID, text, color, nowMS()), nil
}

// ─── config_remove_annotation ────────────────────────────────────────────────

func (s *ConfigService) ConfigRemoveAnnotation(annotationID string) error {
	s.state.RemoveAnnotation(annotationID)
	return nil
}

// ─── config_get_annotations ──────────────────────────────────────────────────

func (s *ConfigService) ConfigGetAnnotations() ([]config.AnnotationEntry, error) {
	return s.state.GetAnnotations(), nil
}

// ─── config_set_session_tags ─────────────────────────────────────────────────

func (s *ConfigService) ConfigSetSessionTags(sessionID string, tags []string) error {
	s.state.SetSessionTags(sessionID, tags)
	return nil
}

// ─── config_get_session_tags ─────────────────────────────────────────────────

func (s *ConfigService) ConfigGetSessionTags(sessionID string) ([]string, error) {
	return s.state.GetSessionTags(sessionID), nil
}

// ─── config_create_group ─────────────────────────────────────────────────────

func (s *ConfigService) ConfigCreateGroup(name string) (bool, error) {
	return s.state.CreateSessionGroup(name), nil
}

// ─── config_delete_group ─────────────────────────────────────────────────────

func (s *ConfigService) ConfigDeleteGroup(name string) error {
	s.state.DeleteSessionGroup(name)
	return nil
}

// ─── config_add_to_group ─────────────────────────────────────────────────────

func (s *ConfigService) ConfigAddToGroup(name, sessionID string) error {
	s.state.AddToSessionGroup(name, sessionID)
	return nil
}

// ─── config_remove_from_group ────────────────────────────────────────────────

func (s *ConfigService) ConfigRemoveFromGroup(name, sessionID string) error {
	s.state.RemoveFromSessionGroup(name, sessionID)
	return nil
}

// ─── config_get_groups ───────────────────────────────────────────────────────

func (s *ConfigService) ConfigGetGroups() (map[string][]string, error) {
	return s.state.GetSessionGroups(), nil
}

// ─── config_add_filter_preset ────────────────────────────────────────────────

func (s *ConfigService) ConfigAddFilterPreset(name string, filter json.RawMessage) (config.FilterPreset, error) {
	preset := config.FilterPreset{
		ID:        config.NewUUID(),
		Name:      name,
		Filter:    filter,
		CreatedAt: nowMS(),
	}
	s.state.AddFilterPreset(preset)
	return preset, nil
}

// ─── config_remove_filter_preset ─────────────────────────────────────────────

func (s *ConfigService) ConfigRemoveFilterPreset(presetID string) error {
	s.state.RemoveFilterPreset(presetID)
	return nil
}

// ─── config_rename_filter_preset ─────────────────────────────────────────────

func (s *ConfigService) ConfigRenameFilterPreset(presetID, name string) (bool, error) {
	return s.state.RenameFilterPreset(presetID, name), nil
}

// ─── config_set_default_filter_preset ────────────────────────────────────────

func (s *ConfigService) ConfigSetDefaultFilterPreset(presetID *string) error {
	s.state.SetDefaultFilterPreset(presetID)
	return nil
}

// ─── config_export_annotations ───────────────────────────────────────────────

// ConfigExportAnnotations returns the bundle as a pretty-printed JSON string,
// byte-identical in schema to the Rust export.
func (s *ConfigService) ConfigExportAnnotations(sessionIDs []string) (string, error) {
	bundle := s.state.ExportAnnotationsBundle(sessionIDs)
	b, err := json.MarshalIndent(bundle, "", "  ")
	if err != nil {
		return "", err
	}
	return string(b), nil
}

// ─── config_import_annotations ───────────────────────────────────────────────

func (s *ConfigService) ConfigImportAnnotations(jsonStr string) (config.ImportReport, error) {
	var bundle config.AnnotationExportBundle
	if err := json.Unmarshal([]byte(jsonStr), &bundle); err != nil {
		return config.ImportReport{}, fmt.Errorf("Invalid bundle JSON: %w", err)
	}
	return s.state.ImportAnnotationsBundle(bundle), nil
}

// ─── permission suggestion dismissals (W30) ──────────────────────────────────

// GetDismissedSuggestions returns the persisted set of dismissed permission-rule
// suggestions.
func (s *ConfigService) GetDismissedSuggestions() ([]string, error) {
	return s.state.GetDismissedSuggestions(), nil
}

// DismissSuggestion persists rule into the dismissed-suggestions set (idempotent).
func (s *ConfigService) DismissSuggestion(rule string) error {
	return s.state.DismissSuggestion(rule)
}
