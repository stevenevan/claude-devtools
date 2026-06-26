import type { Chunk, SessionDetail } from '@renderer/types/data';

import { extractTextFromContent } from './contentExtractor';
import {
  formatCost,
  formatDurationForExport,
  formatNumber,
  formatTimestamp,
  truncate,
} from './formatHelpers';

function formatToolExecutionPlainText(exec: {
  toolCall: { name: string; input: Record<string, unknown> };
  result?: { content: string | unknown[]; isError: boolean };
}): string[] {
  const lines: string[] = [];
  lines.push(`  TOOL: ${exec.toolCall.name}`);
  lines.push(`  Input: ${JSON.stringify(exec.toolCall.input)}`);
  if (exec.result) {
    const prefix = exec.result.isError ? '  [ERROR] Result: ' : '  Result: ';
    const resultText =
      typeof exec.result.content === 'string'
        ? exec.result.content
        : JSON.stringify(exec.result.content);
    lines.push(`${prefix}${truncate(resultText, 500)}`);
  } else {
    lines.push('  [No result]');
  }
  return lines;
}

function formatChunkPlainText(chunk: Chunk): string[] {
  const lines: string[] = [];

  switch (chunk.chunkType) {
    case 'user': {
      lines.push(`USER: ${extractTextFromContent(chunk.userMessage.content)}`);
      break;
    }
    case 'ai': {
      for (const response of chunk.responses) {
        if (Array.isArray(response.content)) {
          for (const block of response.content) {
            if (block.type === 'thinking') {
              lines.push(`THINKING: ${block.thinking}`);
            }
          }
          const text = extractTextFromContent(response.content);
          if (text) {
            lines.push(`ASSISTANT: ${text}`);
          }
        } else if (typeof response.content === 'string') {
          lines.push(`ASSISTANT: ${response.content}`);
        }
      }

      for (const exec of chunk.toolExecutions) {
        lines.push(...formatToolExecutionPlainText(exec));
      }
      break;
    }
    case 'system': {
      lines.push(`SYSTEM: ${chunk.commandOutput}`);
      break;
    }
    case 'compact': {
      lines.push('[Context compacted]');
      break;
    }
  }

  return lines;
}

export function exportAsPlainText(detail: SessionDetail): string {
  const { session, metrics, chunks } = detail;
  const lines: string[] = [];

  lines.push('═'.repeat(60));
  lines.push('SESSION EXPORT');
  lines.push('═'.repeat(60));
  lines.push(`Session:  ${session.id}`);
  lines.push(`Project:  ${session.projectPath}`);
  if (session.gitBranch) {
    lines.push(`Branch:   ${session.gitBranch}`);
  }
  lines.push(`Date:     ${formatTimestamp(new Date(session.createdAt))}`);
  lines.push('');

  lines.push('─'.repeat(40));
  lines.push('METRICS');
  lines.push('─'.repeat(40));
  lines.push(`Duration:       ${formatDurationForExport(metrics.durationMs)}`);
  lines.push(`Total Tokens:   ${formatNumber(metrics.totalTokens)}`);
  lines.push(`Input Tokens:   ${formatNumber(metrics.inputTokens)}`);
  lines.push(`Output Tokens:  ${formatNumber(metrics.outputTokens)}`);
  lines.push(`Cache Read:     ${formatNumber(metrics.cacheReadTokens)}`);
  lines.push(`Cache Created:  ${formatNumber(metrics.cacheCreationTokens)}`);
  lines.push(`Messages:       ${formatNumber(metrics.messageCount)}`);
  lines.push(`Cost:           ${formatCost(metrics.costUsd)}`);
  lines.push('');

  lines.push('═'.repeat(60));
  lines.push('CONVERSATION');
  lines.push('═'.repeat(60));
  lines.push('');

  for (const chunk of chunks) {
    lines.push('─'.repeat(40));
    lines.push(...formatChunkPlainText(chunk));
    lines.push('');
  }

  return lines.join('\n');
}
