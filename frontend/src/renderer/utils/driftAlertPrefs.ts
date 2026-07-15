// Week 32 config-drift alert toggles. The backend's retention validator
// allowlists only {categories, trashExpiryDays, scheduleInterval} and hard-
// rejects any other key, so these two booleans cannot ride the config.update
// path — they persist client-side (the plan's explicit fallback). Defaults:
// settings.json ON, ~/.claude.json OFF (the CLI rewrites .claude.json
// constantly, so its alerts are noisy).

const SETTINGS_KEY = 'claude-devtools-drift-alert-settings';
const CLAUDE_JSON_KEY = 'claude-devtools-drift-alert-claude-json';

function readBool(key: string, fallback: boolean): boolean {
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === null) return fallback;
    return raw === '1';
  } catch {
    return fallback;
  }
}

function writeBool(key: string, value: boolean): void {
  try {
    window.localStorage.setItem(key, value ? '1' : '0');
  } catch {
    // localStorage may be unavailable — the toggle stays in-memory for this run.
  }
}

export const getDriftAlertSettings = (): boolean => readBool(SETTINGS_KEY, true);
export const getDriftAlertClaudeJson = (): boolean => readBool(CLAUDE_JSON_KEY, false);

export const setDriftAlertSettings = (value: boolean): void => writeBool(SETTINGS_KEY, value);
export const setDriftAlertClaudeJson = (value: boolean): void => writeBool(CLAUDE_JSON_KEY, value);

// isDriftAlertEnabledForPath maps a watched config file path to its toggle by
// basename. Unknown files never alert.
export function isDriftAlertEnabledForPath(path: string): boolean {
  const base = path.split(/[\\/]/).pop() ?? '';
  if (base === 'settings.json') return getDriftAlertSettings();
  if (base === '.claude.json') return getDriftAlertClaudeJson();
  return false;
}
