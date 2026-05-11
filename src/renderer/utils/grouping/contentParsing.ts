import { getFirstSegment, hasPathSeparator, isRelativePath } from '@renderer/utils/pathUtils';

import type { CommandInfo, FileReference } from '@renderer/types/groups';

// eslint-disable-next-line security/detect-unsafe-regex -- Pattern is safe: limited to 1000 chars and used on bounded user input
const COMMAND_PATTERN_SOURCE = '\\/([a-z][a-z-]{0,50})(?:\\s+(\\S[^\\n]{0,1000}))?$';
const COMMAND_PATTERN_FLAGS = 'gim';

const FILE_REF_PATTERN_SOURCE = '@([~a-zA-Z0-9._/-]+)';
const FILE_REF_PATTERN_FLAGS = 'g';

const KNOWN_DIRS = new Set([
  'src',
  'apps',
  'app',
  'lib',
  'types',
  'packages',
  'components',
  'utils',
  'services',
  'hooks',
  'store',
  'renderer',
  'main',
  'preload',
  'public',
  'assets',
  'config',
  'tests',
  'test',
  'specs',
  'spec',
  'e2e',
  'docs',
  'scripts',
  'screens',
  'features',
  'pages',
  'views',
  'models',
  'controllers',
  'routes',
  'middleware',
  'api',
  'common',
  'shared',
  'core',
  'modules',
  'client',
  'server',
  'web',
  'mobile',
  'native',
  'electron',
  'node_modules',
]);

function isValidFileRef(path: string): boolean {
  if (isRelativePath(path)) return true;
  const first = getFirstSegment(path);
  if (KNOWN_DIRS.has(first)) return true;
  if (hasPathSeparator(path) && path.length > 2) return true;
  return false;
}

export function extractCommands(text: string): CommandInfo[] {
  if (!text) return [];

  const pattern = new RegExp(COMMAND_PATTERN_SOURCE, COMMAND_PATTERN_FLAGS);
  const commands: CommandInfo[] = [];
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    const [fullMatch, commandName, args] = match;
    commands.push({
      name: commandName,
      args: args?.trim(),
      raw: fullMatch,
      startIndex: match.index,
      endIndex: match.index + fullMatch.length,
    });
  }

  return commands;
}

export function extractFileReferences(text: string): FileReference[] {
  if (!text) return [];

  const pattern = new RegExp(FILE_REF_PATTERN_SOURCE, FILE_REF_PATTERN_FLAGS);
  const references: FileReference[] = [];
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    const [fullMatch, path] = match;
    if (isValidFileRef(path)) {
      references.push({
        path,
        raw: fullMatch,
      });
    }
  }

  return references;
}
