import type { TurnCell } from '../SessionComparisonColumn';
import type { Chunk, SessionDetail } from '@shared/types/chunks';

export interface TurnSummary {
  index: number;
  userText: string;
  aiSummary: string;
  toolCount: number;
}

export function formatCost(cost?: number): string {
  if (!cost) return '--';
  if (cost < 0.01) return `$${cost.toFixed(3)}`;
  return `$${cost.toFixed(2)}`;
}

/** Count tool calls by name from session detail chunks. */
export function countTools(detail: SessionDetail): Map<string, number> {
  const counts = new Map<string, number>();
  for (const chunk of detail.chunks) {
    if ('toolExecutions' in chunk) {
      for (const exec of (chunk as { toolExecutions: { toolCall: { name: string } }[] })
        .toolExecutions) {
        const name = exec.toolCall.name;
        counts.set(name, (counts.get(name) ?? 0) + 1);
      }
    }
  }
  return counts;
}

/** Extract turn summaries (user message + AI response summary) from chunks. */
export function extractTurns(detail: SessionDetail): TurnSummary[] {
  const turns: TurnSummary[] = [];
  const chunks = detail.chunks;
  let turnIndex = 0;

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    if (chunk.chunkType !== 'user') continue;

    const userText =
      typeof chunk.userMessage.content === 'string'
        ? chunk.userMessage.content.slice(0, 200)
        : '[complex content]';

    // Find the following AI chunk
    const nextChunk: Chunk | undefined = chunks[i + 1];
    let aiSummary = '';
    let toolCount = 0;

    if (nextChunk?.chunkType === 'ai') {
      toolCount = nextChunk.toolExecutions.length;
      // Get last text output from responses
      for (let j = nextChunk.responses.length - 1; j >= 0; j--) {
        const resp = nextChunk.responses[j];
        if (resp.type === 'assistant' && Array.isArray(resp.content)) {
          const textBlock = resp.content.find((b: { type: string }) => b.type === 'text') as
            | { text?: string }
            | undefined;
          if (textBlock?.text) {
            aiSummary = textBlock.text.slice(0, 200);
            break;
          }
        }
      }
    }

    turns.push({ index: turnIndex++, userText, aiSummary, toolCount });
  }

  return turns;
}

/** Check if two strings are meaningfully different. */
export function isDivergent(a: string, b: string): boolean {
  if (a === b) return false;
  // Normalize whitespace for comparison
  const norm = (s: string): string => s.replace(/\s+/g, ' ').trim();
  return norm(a) !== norm(b);
}

export function turnSignature(t: TurnCell): string {
  // Normalize whitespace so divergent whitespace doesn't poison alignment.
  return t.userText.replace(/\s+/g, ' ').trim().slice(0, 200);
}
