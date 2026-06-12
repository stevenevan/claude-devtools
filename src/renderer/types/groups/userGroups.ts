import type { ParsedMessage } from '../data';

/**
 * Command reference extracted from user input (e.g., /isolate-context, /context).
 */
export interface CommandInfo {
  /** Command name without slash (e.g., "isolate-context") */
  name: string;
  /** Optional arguments after the command */
  args?: string;
  /** Full raw text including slash */
  raw: string;
  /** Position in the text where command starts */
  startIndex: number;
  /** Position in the text where command ends */
  endIndex: number;
}

/**
 * Image data from user message.
 */
export interface ImageData {
  /** Unique identifier */
  id: string;
  /** MIME type */
  mediaType: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';
  /** Base64 encoded data for display */
  data?: string;
}

/**
 * File reference mentioned in user message (e.g., @file.ts).
 */
export interface FileReference {
  /** File path */
  path: string;
  /** Optional line range */
  lineRange?: {
    start: number;
    end?: number;
  };
  /** Raw text as written */
  raw: string;
}

/**
 * Parsed content from a user message.
 */
export interface UserGroupContent {
  /** Plain text content (with commands removed for display) */
  text?: string;
  /** Raw text content (original) */
  rawText?: string;
  /** Extracted commands */
  commands: CommandInfo[];
  /** Extracted images */
  images: ImageData[];
  /** Extracted file references */
  fileReferences: FileReference[];
}

/**
 * User Group - represents a user's complete input.
 * This is one side of a conversation turn.
 */
export interface UserGroup {
  /** Unique identifier */
  id: string;
  /** Original ParsedMessage */
  message: ParsedMessage;
  /** Timestamp of the message */
  timestamp: Date;
  /** Parsed content */
  content: UserGroupContent;
  /** Index within the session (for ordering) */
  index: number;
}
