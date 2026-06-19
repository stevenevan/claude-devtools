import { isCommandContent, sanitizeDisplayContent } from '@shared/utils/contentSanitizer';

import { extractCommands, extractFileReferences } from './contentParsing';

import type { EnhancedUserChunk, ParsedMessage } from '@renderer/types/data';
import type { FileReference, ImageData, UserGroup, UserGroupContent } from '@renderer/types/groups';

export function createUserGroupFromChunk(chunk: EnhancedUserChunk, index: number): UserGroup {
  return createUserGroup(chunk.userMessage, index);
}

function createUserGroup(message: ParsedMessage, index: number): UserGroup {
  const content = extractUserGroupContent(message);

  return {
    id: `user-${message.uuid}`,
    message,
    timestamp: message.timestamp,
    content,
    index,
  };
}

function extractUserGroupContent(message: ParsedMessage): UserGroupContent {
  let rawText = '';
  const images: ImageData[] = [];
  const fileReferences: FileReference[] = [];

  if (typeof message.content === 'string') {
    rawText = message.content;
  } else if (Array.isArray(message.content)) {
    let imageIndex = 0;
    for (const block of message.content) {
      if (block.type === 'text' && block.text) {
        rawText += block.text;
      } else if (block.type === 'image' && 'source' in block) {
        const src = block.source as { media_type: string; data: string };
        images.push({
          id: `${message.uuid}-img-${imageIndex++}`,
          mediaType: src.media_type as ImageData['mediaType'],
          data: src.data,
        });
      }
    }
  }

  const sanitizedText = sanitizeDisplayContent(rawText);
  const isCommand = isCommandContent(rawText);
  const commands = isCommand ? [] : extractCommands(sanitizedText);

  fileReferences.push(...extractFileReferences(sanitizedText));

  let displayText = sanitizedText;
  if (!isCommand) {
    for (const cmd of commands) {
      displayText = displayText.replace(cmd.raw, '').trim();
    }
  }

  return {
    text: displayText || undefined,
    rawText: sanitizedText,
    commands,
    images,
    fileReferences,
  };
}
