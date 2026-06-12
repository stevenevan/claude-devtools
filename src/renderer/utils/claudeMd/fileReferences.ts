import { extractFileReferences } from '../groupTransformer';

import {
  getDirectory,
  getParentDirectory,
  isAbsolutePath,
  isAtOrAbove,
  joinPaths,
} from './pathHelpers';

import type { ParsedMessage, SemanticStep } from '../../types/data';
import type { FileReference, UserGroup } from '../../types/groups';

const CLAUDE_MD_FILENAME = 'CLAUDE.md';

export function extractReadToolPaths(steps: SemanticStep[]): string[] {
  const paths: string[] = [];

  for (const step of steps) {
    if (step.type === 'tool_call' && step.content.toolName === 'Read') {
      const toolInput = step.content.toolInput as Record<string, unknown> | undefined;
      if (toolInput && typeof toolInput.file_path === 'string') {
        paths.push(toolInput.file_path);
      }
    }
  }

  return paths;
}

export function extractUserMentionPaths(
  userGroup: UserGroup | null,
  projectRoot: string
): string[] {
  if (!userGroup) return [];

  const fileReferences = userGroup.content.fileReferences || [];
  const paths: string[] = [];

  for (const ref of fileReferences) {
    if (ref.path) {
      const absolutePath = isAbsolutePath(ref.path) ? ref.path : joinPaths(projectRoot, ref.path);
      paths.push(absolutePath);
    }
  }

  return paths;
}

// Extracts @-mentioned file paths from isMeta:true user messages (slash command follow-ups, etc.)
export function extractFileRefsFromResponses(responses: ParsedMessage[]): FileReference[] {
  const refs: FileReference[] = [];
  for (const msg of responses) {
    if (msg.type !== 'user') continue;
    let text = '';
    if (typeof msg.content === 'string') {
      text = msg.content;
    } else if (Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (block.type === 'text' && block.text) text += block.text;
      }
    }
    if (text) refs.push(...extractFileReferences(text));
  }
  return refs;
}

export function detectClaudeMdFromFilePath(filePath: string, projectRoot: string): string[] {
  const claudeMdPaths: string[] = [];
  const sep = filePath.includes('\\') ? '\\' : '/';

  let currentDir = getDirectory(filePath);

  // Walk up to project root (inclusive)
  while (currentDir && isAtOrAbove(projectRoot, currentDir)) {
    const claudeMdPath = `${currentDir}${sep}${CLAUDE_MD_FILENAME}`;
    claudeMdPaths.push(claudeMdPath);

    const parentDir = getParentDirectory(currentDir);
    if (!parentDir || parentDir === currentDir) {
      break;
    }
    currentDir = parentDir;
  }

  return claudeMdPaths;
}
