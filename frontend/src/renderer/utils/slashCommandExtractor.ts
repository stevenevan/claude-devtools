import { extractSlashInfo, isCommandContent } from '@shared/utils/contentSanitizer';

import { estimateTokens, toDate } from './aiGroupHelpers';

import type { ParsedMessage } from '@renderer/types/data';
import type { SlashItem } from '@renderer/types/groups';

export interface PrecedingSlashInfo {
  name: string;
  message?: string;
  args?: string;
  commandMessageUuid: string;
  timestamp: Date;
}

export function extractSlashes(
  responses: ParsedMessage[],
  precedingSlash?: PrecedingSlashInfo
): SlashItem[] {
  const slashes: SlashItem[] = [];

  // isMeta:true messages keyed by parentUuid contain slash instructions/output
  const followUpsByParentUuid = new Map<
    string,
    {
      text: string;
      timestamp: Date;
    }
  >();

  // Fallback: slash messages that appear inside responses rather than preceding the turn
  const slashMessagesById = new Map<
    string,
    {
      uuid: string;
      name: string;
      message?: string;
      args?: string;
      timestamp: Date;
    }
  >();

  for (const msg of responses) {
    if (msg.type === 'user' && typeof msg.content === 'string' && isCommandContent(msg.content)) {
      const slashInfo = extractSlashInfo(msg.content);
      if (slashInfo) {
        slashMessagesById.set(msg.uuid, {
          uuid: msg.uuid,
          name: slashInfo.name,
          message: slashInfo.message,
          args: slashInfo.args,
          timestamp: toDate(msg.timestamp),
        });
      }
    }

    if (
      msg.type === 'user' &&
      msg.isMeta === true &&
      msg.parentUuid &&
      !msg.sourceToolUseID && // Exclude tool-call related messages
      Array.isArray(msg.content)
    ) {
      for (const block of msg.content) {
        if (block.type === 'text' && block.text) {
          const text = block.text;
          followUpsByParentUuid.set(msg.parentUuid, {
            text,
            timestamp: toDate(msg.timestamp),
          });
          break; // Only need the first text block
        }
      }
    }
  }

  // Strategy 1: link precedingSlash to its follow-up instructions
  if (precedingSlash) {
    const followUp = followUpsByParentUuid.get(precedingSlash.commandMessageUuid);

    slashes.push({
      id: `slash-${precedingSlash.commandMessageUuid}`,
      name: precedingSlash.name,
      message: precedingSlash.message,
      args: precedingSlash.args,
      commandMessageUuid: precedingSlash.commandMessageUuid,
      instructions: followUp?.text,
      instructionsTokenCount: followUp ? estimateTokens(followUp.text) : undefined,
      // Use follow-up timestamp if available so it sorts correctly with other AI items
      timestamp: followUp?.timestamp ?? precedingSlash.timestamp,
    });
  }

  // Strategy 2: fallback — slash messages found inside responses
  for (const [uuid, slashMsg] of slashMessagesById.entries()) {
    if (uuid === precedingSlash?.commandMessageUuid) {
      continue;
    }

    const followUp = followUpsByParentUuid.get(uuid);

    slashes.push({
      id: `slash-${uuid}`,
      name: slashMsg.name,
      message: slashMsg.message,
      args: slashMsg.args,
      commandMessageUuid: uuid,
      instructions: followUp?.text,
      instructionsTokenCount: followUp ? estimateTokens(followUp.text) : undefined,
      timestamp: slashMsg.timestamp,
    });
  }

  return slashes;
}
