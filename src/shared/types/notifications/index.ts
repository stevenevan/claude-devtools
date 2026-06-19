/**
 * Notification and configuration types for claude-devtools.
 *
 * These types define:
 * - Detected errors from session files
 * - Notification triggers (rules for when to notify)
 * - Application configuration settings
 *
 * Shared between preload and renderer processes.
 */

export type * from './errors';
export type * from './triggers';
export type * from './appConfig';
