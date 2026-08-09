import { getBaseName } from './pathUtils';

const POSIX_PATH_PATTERN = /(^|[\s([{'"])((?:~|\/)(?:[^\s/]+\/)+[^\s)\]}"',;:!?]+)/gm;
const FILE_URL_PATTERN = /file:\/\/\/(?:[^\s/]+\/)+[^\s)\]}"',;:!?]+/gi;
const WINDOWS_PATH_PATTERN = /(?:[A-Za-z]:\\|\\\\)(?:[^\s\\]+\\)+[^\s\\]+/g;
const UUID_PATTERN = /\b[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}\b/gi;
const CLAUDE_MODEL_PATTERN =
  /\bclaude(?:[- ][\w.]+)*[- ](?:opus|sonnet|haiku|fable|mythos)(?:[- ][\w.]+)*\b/gi;
const TOKEN_COUNT_PATTERN = /\b\d[\d,]*(?:\.\d+)?\s+(?:input |output |cached? |cache(?: read| creation)? )?tokens?\b/gi;
const JSONL_PATTERN = /\b[\w.-]*\.jsonl\b|\bjsonl\b/gi;

function redactPath(path: string): string {
  const baseName = getBaseName(path);
  return baseName || 'file';
}

export function sanitizeSimpleText(text: string): string {
  return text
    .replace(POSIX_PATH_PATTERN, (_match, delimiter: string, path: string) => `${delimiter}${redactPath(path)}`)
    .replace(FILE_URL_PATTERN, redactPath)
    .replace(WINDOWS_PATH_PATTERN, redactPath)
    .replace(CLAUDE_MODEL_PATTERN, 'Claude')
    .replace(UUID_PATTERN, 'a session identifier')
    .replace(TOKEN_COUNT_PATTERN, 'usage details')
    .replace(JSONL_PATTERN, 'session file');
}
