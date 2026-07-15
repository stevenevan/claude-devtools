// Package filesservice is a thin Wails service wrapper over internal/files.
// It exposes all 13 file-related commands.
// Layering: imports internal/files and internal/config (config imports
// neither files nor filesservice, so no cycle). No application import here
// — no events emitted by file commands.
package filesservice

import (
	"claude-devtools/internal/config"
	"claude-devtools/internal/files"
)

// FilesService exposes 22 commands: ValidatePath, ValidateMentions,
// ReadClaudeMdFiles, ReadDirectoryClaudeMd, ReadMentionedFile,
// ReadAgentConfigs, ReadGlobalAgents, ReadGlobalSkills, ReadGlobalPlugins,
// ReadGlobalSettings, UpdateGlobalSettings, ReadHooks, ToggleHook,
// SetPluginEnabled, DedupePlugin, DetectPluginDuplicates,
// EnumerateSettingsSources, ReadClaudeJSON, RevealClaudeJSONValue,
// ReadClaudeJSONMasked, ListClaudeJSONBackups, ReadClaudeJSONBackup.
type FilesService struct{}

func (s *FilesService) Ready() (bool, error) { return true, nil }

// ValidatePath checks whether relPath exists inside projectPath without
// allowing path traversal. Mirrors files.rs::validate_path.
func (s *FilesService) ValidatePath(relPath, projectPath string) (files.PathResult, error) {
	return files.ValidatePath(relPath, projectPath), nil
}

// ValidateMentions checks each mention's "value" field against projectPath.
// Mirrors files.rs::validate_mentions.
func (s *FilesService) ValidateMentions(
	mentions []map[string]any,
	projectPath string,
) (files.MentionValidation, error) {
	return files.ValidateMentions(mentions, projectPath), nil
}

// ReadClaudeMdFiles reads global + project CLAUDE.md + .claude/rules/*.md.
// Mirrors files.rs::read_claude_md_files.
func (s *FilesService) ReadClaudeMdFiles(projectRoot string) (map[string]files.ClaudeMdFile, error) {
	return files.ReadClaudeMdFiles(projectRoot), nil
}

// ReadDirectoryClaudeMd reads CLAUDE.md from a single directory.
// Mirrors files.rs::read_directory_claude_md.
func (s *FilesService) ReadDirectoryClaudeMd(dirPath string) (files.ClaudeMdFile, error) {
	return files.ReadDirectoryClaudeMd(dirPath), nil
}

// ReadMentionedFile reads a file, enforcing the project-root containment check.
// Returns nil result when the path escapes or the file doesn't exist.
// Mirrors files.rs::read_mentioned_file.
func (s *FilesService) ReadMentionedFile(
	absolutePath, projectRoot string,
	maxTokens *int,
) (*files.MentionedFileResult, error) {
	return files.ReadMentionedFile(absolutePath, projectRoot, maxTokens), nil
}

// ReadAgentConfigs reads .claude/agents/*.md in projectRoot.
// Mirrors configs.rs::read_agent_configs.
func (s *FilesService) ReadAgentConfigs(projectRoot string) (map[string]files.AgentConfig, error) {
	return files.ReadAgentConfigs(projectRoot), nil
}

// ReadGlobalAgents reads ~/.claude/agents/*.md.
// Mirrors configs.rs::read_global_agents.
func (s *FilesService) ReadGlobalAgents() ([]files.GlobalAgent, error) {
	return files.ReadGlobalAgents()
}

// ReadGlobalSkills reads ~/.claude/skills/.
// Mirrors configs.rs::read_global_skills.
func (s *FilesService) ReadGlobalSkills() ([]files.GlobalSkill, error) {
	return files.ReadGlobalSkills()
}

// ReadGlobalPlugins reads ~/.claude/plugins/installed_plugins.json.
// Mirrors configs.rs::read_global_plugins.
func (s *FilesService) ReadGlobalPlugins() ([]files.Plugin, error) {
	return files.ReadGlobalPlugins()
}

// ReadGlobalSettings reads ~/.claude/settings.json.
// Mirrors configs.rs::read_global_settings.
func (s *FilesService) ReadGlobalSettings() (any, error) {
	return files.ReadGlobalSettings()
}

// UpdateGlobalSettings merges a patch (env + permissions allow/deny/ask)
// into ~/.claude/settings.json, preserving every other key.
func (s *FilesService) UpdateGlobalSettings(patch files.SettingsPatch) error {
	return files.UpdateGlobalSettings(patch)
}

// ReadHooks builds the enabled/disabled hooks view: enabled entries come
// from ~/.claude/settings.json, disabled entries from the app-owned
// hooks-disabled.json under the claude-devtools app data dir.
func (s *FilesService) ReadHooks() (files.HookView, error) {
	appDataDir, err := config.AppDataDir()
	if err != nil {
		return files.HookView{}, err
	}
	return files.ReadHooks(appDataDir)
}

// ToggleHook enables or disables the hook matcher-group at (event,
// matcherIndex), verifying fingerprint still matches before moving it
// between settings.json and hooks-disabled.json.
func (s *FilesService) ToggleHook(event string, matcherIndex int, fingerprint string, enable bool) error {
	appDataDir, err := config.AppDataDir()
	if err != nil {
		return err
	}
	return files.ToggleHook(appDataDir, event, matcherIndex, fingerprint, enable)
}

// SetPluginEnabled adds or removes key in settings.json's "enabledPlugins"
// map. Never touches installed_plugins.json or any plugin cache.
func (s *FilesService) SetPluginEnabled(key string, enable bool) error {
	return files.SetPluginEnabled(key, enable)
}

// DedupePlugin removes every "enabledPlugins" key whose plugin-name part
// equals name, except keepKey.
func (s *FilesService) DedupePlugin(name, keepKey string) error {
	return files.DedupePlugin(name, keepKey)
}

// DetectPluginDuplicates reads the current installed plugins and returns
// the groups enabled under 2+ distinct marketplaces at once, so the
// frontend gets duplicates without a second read.
func (s *FilesService) DetectPluginDuplicates() ([]files.DuplicateGroup, error) {
	plugins, err := files.ReadGlobalPlugins()
	if err != nil {
		return nil, err
	}
	return files.DetectPluginDuplicates(plugins), nil
}

// EnumerateSettingsSources surfaces every settings.json/settings.local.json
// source that could affect projectRoot (global, global-nested-anomaly,
// project, project-local) plus a merged, provenance-tracked effective view.
// Read-only; raw values are unmasked — masking happens client-side.
func (s *FilesService) EnumerateSettingsSources(projectRoot string) (files.SourcesView, error) {
	return files.EnumerateSettingsSources(projectRoot)
}

// ReadClaudeJSON returns the read-only census of ~/.claude.json (top-level key
// kinds/sizes, grouped flags, project-entry stale triage). Carries no raw
// values — per-value display goes through RevealClaudeJSONValue.
func (s *FilesService) ReadClaudeJSON() (files.ClaudeJSONCensus, error) {
	return files.ReadClaudeJSON()
}

// RevealClaudeJSONValue returns the masked JSON of a single top-level key's
// value; credential-shaped keys/values come back masked.
func (s *FilesService) RevealClaudeJSONValue(keyPath string) (string, error) {
	return files.RevealClaudeJSONValue(keyPath)
}

// ReadClaudeJSONMasked returns the full live ~/.claude.json server-side-masked
// so the inspector can diff live-vs-backup masked-vs-masked.
func (s *FilesService) ReadClaudeJSONMasked() (string, error) {
	return files.ReadClaudeJSONMasked()
}

// ListClaudeJSONBackups enumerates the CLI's own ~/.claude/backups rolling
// backups newest-first.
func (s *FilesService) ListClaudeJSONBackups() ([]files.ClaudeJSONBackup, error) {
	return files.ListClaudeJSONBackups()
}

// ReadClaudeJSONBackup returns a named backup's server-side-masked JSON so the
// diff stays masked-vs-masked; name is validated + confined to the backups dir.
func (s *FilesService) ReadClaudeJSONBackup(name string) (string, error) {
	return files.ReadClaudeJSONBackup(name)
}

// GetMCPStatus aggregates MCP server state from ~/.claude.json (top-level +
// per-project mcpServers), each project's .mcp.json, and the auth-needed
// connector cache into a read-only status view. All command/url/args values
// are server-side masked. Read-only — writes nothing.
func (s *FilesService) GetMCPStatus() (files.MCPStatusView, error) {
	return files.GetMCPStatus()
}

// GetPermissionRules returns the merged permission-rule table for a project
// (global settings.json + project settings.json + project settings.local.json),
// each row carrying its source provenance and a Writable flag.
func (s *FilesService) GetPermissionRules(projectRoot string) (files.PermissionRulesView, error) {
	return files.GetPermissionRules(projectRoot)
}

// AddPermissionRule appends one opaque rule to a writable scope's
// permissions[list] (global settings.json or project settings.local.json),
// preserving every other key.
func (s *FilesService) AddPermissionRule(scope files.PermissionScope, list, rule string) error {
	return files.AddPermissionRule(scope, list, rule)
}

// RemovePermissionRule drops every occurrence of rule from a writable scope's
// permissions[list], preserving every other key.
func (s *FilesService) RemovePermissionRule(scope files.PermissionScope, list, rule string) error {
	return files.RemovePermissionRule(scope, list, rule)
}

// MovePermissionRule adds rule to the target scope+list first, then removes it
// from the source scope+list — a crash between leaves a harmless duplicate,
// never a lost rule.
func (s *FilesService) MovePermissionRule(from, to files.PermissionScope, fromList, toList, rule string) error {
	return files.MovePermissionRule(from, to, fromList, toList, rule)
}

// PurgeClaudeJSONProjects removes provably-stale project entries from
// ~/.claude.json under the program's tightest guardrails: server-side
// re-triage, value-preserving surgical delete, a credential deny-list, an
// app-side pre-write backup, compare-and-swap before rename, and post-write
// re-verify. Never mutates or downgrades auth material.
func (s *FilesService) PurgeClaudeJSONProjects(keys []string) (files.PurgeResult, error) {
	return files.PurgeClaudeJSONProjects(keys)
}

// ListClaudeJSONAppBackups enumerates the app's own pre-purge ~/.claude.json
// backups (<AppDataDir>/claude-json-backups) newest-first.
func (s *FilesService) ListClaudeJSONAppBackups() ([]files.ClaudeJSONBackup, error) {
	return files.ListClaudeJSONAppBackups()
}

// RestoreClaudeJSONAppBackup replaces the live ~/.claude.json with a named
// app-side backup in full (auth included), backing up the current file first.
func (s *FilesService) RestoreClaudeJSONAppBackup(name string) error {
	return files.RestoreClaudeJSONAppBackup(name)
}
