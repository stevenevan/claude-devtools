/**
 * Type definitions for the new chat history architecture.
 * These types separate user input from AI responses for a chat-style display.
 */

export type { SemanticStep } from '../data';
export type {
  CommandInfo,
  ImageData,
  FileReference,
  UserGroupContent,
  UserGroup,
} from './userGroups';
export type {
  AIGroupExpansionLevel,
  AIGroupSummary,
  LinkedToolItem,
  SlashItem,
  TeammateMessage,
  AIGroupDisplayItem,
  AIGroupLastOutput,
  EnhancedAIGroup,
  AIGroupStatus,
  AIGroupTokens,
  AIGroup,
} from './aiGroups';
export type {
  SystemGroup,
  CompactGroup,
  EventGroup,
  ChatItem,
  SessionConversation,
} from './conversation';
