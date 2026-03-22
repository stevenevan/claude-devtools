/**
 * Shared type definitions.
 *
 * Usage:
 *   import type { Session, Chunk, ParsedMessage } from '@shared/types';
 */

// JSONL format types
export * from './jsonl';

// Domain/business entities
export type * from './domain';

// Parsed message types and guards
export * from './messages';

// Chunk and visualization types
export * from './chunks';

// Re-export notification and config types
export * from './notifications';

// Re-export visualization types (WaterfallData, WaterfallItem)
export type * from './visualization';

// Re-export API types (ElectronAPI, ConfigAPI, etc.)
export type * from './api';
