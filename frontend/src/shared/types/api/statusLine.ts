// The `statusLine` object in ~/.claude/settings.json. Claude Code shell-executes
// `command` on every status-line refresh.
// Schema: https://code.claude.com/docs/en/statusline
export interface StatusLineConfig {
  type: 'command';
  command: string;
  padding?: number;
  refreshInterval?: number;
  hideVimModeIndicator?: boolean;
  // Sub-keys this app does not model are round-tripped verbatim by the Rust
  // side; the panel must spread the loaded object so they survive a save.
  [key: string]: unknown;
}

// Metadata about the script `command` points at. Never its content.
export interface StatusLineScriptInfo {
  // null when `command` is an inline shell command rather than a path.
  resolvedPath: string | null;
  exists: boolean;
  sizeBytes: number;
  isText: boolean;
  underClaudeRoot: boolean;
}
