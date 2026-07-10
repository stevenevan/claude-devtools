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

// FilesService exposes 17 commands: ValidatePath, ValidateMentions,
// ReadClaudeMdFiles, ReadDirectoryClaudeMd, ReadMentionedFile,
// ReadAgentConfigs, ReadGlobalAgents, ReadGlobalSkills, ReadGlobalPlugins,
// ReadGlobalSettings, UpdateGlobalSettings, ReadHooks, ToggleHook,
// SetPluginEnabled, DedupePlugin, DetectPluginDuplicates,
// EnumerateSettingsSources.
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
