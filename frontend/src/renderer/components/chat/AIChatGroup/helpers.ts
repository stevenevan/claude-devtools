import { type PrecedingSlashInfo } from '@renderer/utils/slashCommandExtractor';
import { extractSlashInfo, isCommandContent } from '@shared/utils/contentSanitizer';

import type { AIGroupDisplayItem, UserGroup } from '@renderer/types/groups';

export function extractPrecedingSlashInfo(
  userGroup: UserGroup | undefined
): PrecedingSlashInfo | undefined {
  if (!userGroup) return undefined;

  const msg = userGroup.message;
  const content = msg.content;

  // Check if this is a slash message (has <command-name> tags)
  if (typeof content === 'string' && isCommandContent(content)) {
    const slashInfo = extractSlashInfo(content);
    if (slashInfo) {
      return {
        name: slashInfo.name,
        message: slashInfo.message,
        args: slashInfo.args,
        commandMessageUuid: msg.uuid,
        timestamp: new Date(msg.timestamp),
      };
    }
  }

  return undefined;
}

export function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${ms}ms`;
  }
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) {
    const decimal = ms % 1000 >= 100 ? `.${Math.floor((ms % 1000) / 100)}` : '';
    return `${seconds}${decimal}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (remainingSeconds === 0) {
    return `${minutes}m`;
  }
  return `${minutes}m ${remainingSeconds}s`;
}

export function containsToolUseId(items: AIGroupDisplayItem[], toolUseId: string): boolean {
  for (const item of items) {
    if (item.type === 'tool' && item.tool.id === toolUseId) {
      return true;
    }
    // Check nested subagent messages for the tool ID
    if (item.type === 'subagent' && item.subagent.messages) {
      for (const msg of item.subagent.messages) {
        if (msg.toolCalls?.some((tc) => tc.id === toolUseId)) {
          return true;
        }
        if (msg.toolResults?.some((tr) => tr.toolUseId === toolUseId)) {
          return true;
        }
      }
    }
  }
  return false;
}
