import type { ContentBlock } from '@shared/types';

interface ExtractOptions {
  includeThinking?: boolean;
}

export function extractTextFromContent(
  content: string | ContentBlock[],
  options?: ExtractOptions
): string {
  if (typeof content === 'string') {
    return content;
  }

  if (!Array.isArray(content) || content.length === 0) {
    return '';
  }

  const parts: string[] = [];

  for (const block of content) {
    switch (block.type) {
      case 'text':
        parts.push(block.text);
        break;
      case 'thinking':
        if (options?.includeThinking) {
          parts.push(block.thinking);
        }
        break;
      case 'tool_use':
        parts.push(`Tool: ${block.name}\nInput: ${JSON.stringify(block.input, null, 2)}`);
        break;
      case 'tool_result': {
        const resultContent = block.content;
        if (typeof resultContent === 'string') {
          parts.push(resultContent);
        } else if (Array.isArray(resultContent)) {
            const nested = extractTextFromContent(resultContent);
          if (nested) parts.push(nested);
        }
        break;
      }
      case 'image':
        parts.push('[Image]');
        break;
    }
  }

  return parts.join('\n');
}
