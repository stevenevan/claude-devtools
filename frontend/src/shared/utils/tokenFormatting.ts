/**
 * Shared token formatting utilities.
 *
 * This module consolidates all token-related formatting functions across the codebase.
 * Use these functions instead of implementing token formatting inline.
 */

/**
 * Formats token count for compact display.
 * Shows full number under 1k, uses 'k' suffix for thousands, 'M' suffix for millions.
 *
 * Examples:
 * - 500 -> "500"
 * - 1500 -> "1.5k"
 * - 50000 -> "50.0k"
 * - 1500000 -> "1.5M"
 */
export function formatTokensCompact(tokens: number): string {
  if (tokens >= 1000000) {
    return `${(tokens / 1000000).toFixed(1)}M`;
  }
  if (tokens >= 1000) {
    return `${(tokens / 1000).toFixed(1)}k`;
  }
  return tokens.toString();
}

/**
 * Formats token count with smart precision.
 * Uses one decimal for 1k-10k range, whole numbers above 10k.
 *
 * Examples:
 * - 500 -> "500"
 * - 1500 -> "1.5k"
 * - 15000 -> "15k"
 */
export function formatTokens(tokens: number): string {
  if (tokens < 1000) {
    return `${tokens}`;
  }
  if (tokens < 10000) {
    return `${(tokens / 1000).toFixed(1)}k`;
  }
  return `${Math.round(tokens / 1000)}k`;
}

/**
 * Estimates token count from text content.
 * Uses the rough heuristic of ~4 characters per token, which is a
 * reasonable average for English text and code.
 *
 * This is faster than using a real tokenizer and accurate enough
 * for display purposes.
 */
export function estimateTokens(text: string | undefined | null): number {
  if (!text || text.length === 0) {
    return 0;
  }
  return Math.ceil(text.length / 4);
}
