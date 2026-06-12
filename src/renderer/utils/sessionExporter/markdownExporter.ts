import type { Chunk, SessionDetail } from '@renderer/types/data';

import { extractTextFromContent } from './contentExtractor';
import {
  formatCost,
  formatDurationForExport,
  formatNumber,
  formatTimestamp,
  truncate,
} from './formatHelpers';

function formatToolExecutionMarkdown(exec: {
  toolCall: { name: string; input: Record<string, unknown> };
  result?: { content: string | unknown[]; isError: boolean };
}): string[] {
  const lines: string[] = [];
  lines.push(`**Tool:** \`${exec.toolCall.name}\``);
  lines.push('');
  lines.push('```json');
  lines.push(JSON.stringify(exec.toolCall.input, null, 2));
  lines.push('```');
  lines.push('');

  if (exec.result) {
    if (exec.result.isError) {
      lines.push('**Error:**');
    } else {
      lines.push('**Result:**');
    }
    lines.push('');
    const resultText =
      typeof exec.result.content === 'string'
        ? exec.result.content
        : JSON.stringify(exec.result.content, null, 2);
    lines.push('```');
    lines.push(truncate(resultText, 2000));
    lines.push('```');
  }

  return lines;
}

function formatChunkMarkdown(chunk: Chunk, turnNum: number): string[] {
  const lines: string[] = [];

  switch (chunk.chunkType) {
    case 'user': {
      lines.push(`### User (Turn ${turnNum})`);
      lines.push('');
      lines.push(extractTextFromContent(chunk.userMessage.content));
      lines.push('');
      break;
    }
    case 'ai': {
      lines.push(`### Assistant (Turn ${turnNum})`);
      lines.push('');

      for (const response of chunk.responses) {
        if (Array.isArray(response.content)) {
          for (const block of response.content) {
            if (block.type === 'thinking') {
              lines.push('> *Thinking:*');
              for (const thinkLine of block.thinking.split('\n')) {
                lines.push(`> ${thinkLine}`);
              }
              lines.push('');
            }
          }
          const text = extractTextFromContent(response.content);
          if (text) {
            lines.push(text);
            lines.push('');
          }
        } else if (typeof response.content === 'string') {
          lines.push(response.content);
          lines.push('');
        }
      }

      for (const exec of chunk.toolExecutions) {
        lines.push(...formatToolExecutionMarkdown(exec));
        lines.push('');
      }
      break;
    }
    case 'system': {
      lines.push(`### System (Turn ${turnNum})`);
      lines.push('');
      lines.push(chunk.commandOutput);
      lines.push('');
      break;
    }
    case 'compact': {
      lines.push('---');
      lines.push('');
      lines.push('*Context compacted*');
      lines.push('');
      break;
    }
  }

  return lines;
}

export function exportAsMarkdown(detail: SessionDetail): string {
  const { session, metrics, chunks } = detail;
  const lines: string[] = [];

  lines.push('# Session Export');
  lines.push('');

  lines.push('| Property | Value |');
  lines.push('|----------|-------|');
  lines.push(`| Session | \`${session.id}\` |`);
  lines.push(`| Project | \`${session.projectPath}\` |`);
  if (session.gitBranch) {
    lines.push(`| Branch | \`${session.gitBranch}\` |`);
  }
  lines.push(`| Date | ${formatTimestamp(new Date(session.createdAt))} |`);
  lines.push('');

  lines.push('## Metrics');
  lines.push('');
  lines.push('| Metric | Value |');
  lines.push('|--------|-------|');
  lines.push(`| Duration | ${formatDurationForExport(metrics.durationMs)} |`);
  lines.push(`| Total Tokens | ${formatNumber(metrics.totalTokens)} |`);
  lines.push(`| Input Tokens | ${formatNumber(metrics.inputTokens)} |`);
  lines.push(`| Output Tokens | ${formatNumber(metrics.outputTokens)} |`);
  lines.push(`| Cache Read | ${formatNumber(metrics.cacheReadTokens)} |`);
  lines.push(`| Cache Created | ${formatNumber(metrics.cacheCreationTokens)} |`);
  lines.push(`| Messages | ${formatNumber(metrics.messageCount)} |`);
  lines.push(`| Cost | ${formatCost(metrics.costUsd)} |`);
  lines.push('');

  lines.push('## Conversation');
  lines.push('');

  let turnNum = 0;
  for (const chunk of chunks) {
    turnNum++;
    lines.push(...formatChunkMarkdown(chunk, turnNum));
  }

  return lines.join('\n');
}

export function exportAIChunkAsMarkdown(chunk: Chunk): string {
  if (chunk.chunkType !== 'ai') return '';
  const lines = formatChunkMarkdown(chunk, 0);
  const filtered = lines.filter((l) => !l.startsWith('### Assistant'));
  return filtered.join('\n').trim();
}
