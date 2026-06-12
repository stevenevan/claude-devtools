import { extractFileReferences } from '@renderer/utils/groupTransformer';

import { resolveFilePath } from '../utils/pathResolution';

import type { ClaudeMdStats } from '@renderer/types/claudeMd';
import type { ChatItem } from '@renderer/types/groups';

export interface DirectoryTokenUpdate {
  directoryTokens: Map<string, number>;
  nonExistentPaths: Set<string>;
}

export function applyDirectoryTokenData(
  statsMap: Map<string, ClaudeMdStats>,
  update: DirectoryTokenUpdate
): void {
  const { directoryTokens, nonExistentPaths } = update;
  for (const [, stats] of statsMap.entries()) {
    stats.accumulatedInjections = stats.accumulatedInjections.filter(
      (inj) => inj.source !== 'directory' || !nonExistentPaths.has(inj.path)
    );
    stats.newInjections = stats.newInjections.filter(
      (inj) => inj.source !== 'directory' || !nonExistentPaths.has(inj.path)
    );

    for (const injection of stats.accumulatedInjections) {
      if (injection.source === 'directory' && directoryTokens.has(injection.path)) {
        injection.estimatedTokens = directoryTokens.get(injection.path)!;
      }
    }
    for (const injection of stats.newInjections) {
      if (injection.source === 'directory' && directoryTokens.has(injection.path)) {
        injection.estimatedTokens = directoryTokens.get(injection.path)!;
      }
    }

    stats.totalEstimatedTokens = stats.accumulatedInjections.reduce(
      (sum, inj) => sum + inj.estimatedTokens,
      0
    );
    stats.accumulatedCount = stats.accumulatedInjections.length;
    stats.newCount = stats.newInjections.length;
  }
}

export function collectMentionedFilePaths(items: ChatItem[], projectRoot: string): Set<string> {
  const paths = new Set<string>();
  for (const item of items) {
    if (item.type === 'user' && item.group.content.fileReferences) {
      for (const ref of item.group.content.fileReferences) {
        paths.add(resolveFilePath(projectRoot, ref.path));
      }
    }
  }
  for (const item of items) {
    if (item.type !== 'ai') continue;
    for (const msg of item.group.responses) {
      if (msg.type !== 'user') continue;
      let text = '';
      if (typeof msg.content === 'string') {
        text = msg.content;
      } else if (Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if (block.type === 'text' && block.text) text += block.text;
        }
      }
      if (!text) continue;
      for (const ref of extractFileReferences(text)) {
        paths.add(resolveFilePath(projectRoot, ref.path));
      }
    }
  }
  return paths;
}
