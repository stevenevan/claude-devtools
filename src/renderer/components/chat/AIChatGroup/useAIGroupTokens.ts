import { useMemo } from 'react';

import { estimateTokens } from '@shared/utils/tokenFormatting';

import type { ParsedMessage } from '@renderer/types/data';
import type { UsageMetadata } from '@shared/types/jsonl';

export interface AIGroupTokensResult {
  lastUsage: UsageMetadata | null;
  thinkingTokens: number;
  textOutputTokens: number;
}

/**
 * Compute token-related metrics from AI group responses.
 * - lastUsage: usage data from the last assistant message (current context window snapshot)
 * - thinkingTokens / textOutputTokens: estimated from content blocks
 */
export function useAIGroupTokens(responses: ParsedMessage[] | undefined): AIGroupTokensResult {
  // Get the LAST assistant message's usage (represents current context window snapshot)
  // This is the correct metric to display - not the summed values across all messages
  const lastUsage = useMemo(() => {
    const list = responses || [];
    // Find the last assistant message with usage data
    for (let i = list.length - 1; i >= 0; i--) {
      const msg = list[i];
      if (msg.type === 'assistant' && msg.usage) {
        return msg.usage;
      }
    }
    return null;
  }, [responses]);

  // Calculate thinking and text output tokens from assistant message content blocks
  // These are estimated from the actual content, providing breakdown of output token usage
  const { thinkingTokens, textOutputTokens } = useMemo(() => {
    let thinking = 0;
    let textOutput = 0;

    const list = responses || [];
    for (const msg of list) {
      if (msg.type === 'assistant' && Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if (block.type === 'thinking' && block.thinking) {
            thinking += estimateTokens(block.thinking);
          } else if (block.type === 'text' && block.text) {
            textOutput += estimateTokens(block.text);
          }
        }
      }
    }

    return { thinkingTokens: thinking, textOutputTokens: textOutput };
  }, [responses]);

  return { lastUsage, thinkingTokens, textOutputTokens };
}
