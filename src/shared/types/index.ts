/**
 * Shared type definitions.
 *
 * Usage:
 *   import type { Session, Chunk, ParsedMessage } from '@shared/types';
 */

// JSONL format types
export type * from './jsonl';

// Domain/business entities
export type * from './domain/index';

// Parsed message types
export type * from './messages';

// Chunk and visualization types
export * from './chunks';

// Re-export notification and config types
export * from './notifications';

// Re-export visualization types (WaterfallData, WaterfallItem)
export type * from './visualization';

// Re-export API types (ElectronAPI, ConfigAPI, etc.)
export type * from './api';
