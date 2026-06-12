import type { SessionDetail } from '@renderer/types/data';

import { exportAIChunkAsMarkdown, exportAsMarkdown } from './markdownExporter';
import { exportAsPlainText } from './plainTextExporter';

export { extractTextFromContent } from './contentExtractor';
export { exportAsMarkdown, exportAIChunkAsMarkdown, exportAsPlainText };

export type ExportFormat = 'markdown' | 'json' | 'plaintext';

export function exportAsJson(detail: SessionDetail): string {
  return JSON.stringify(detail, null, 2);
}

export function triggerDownload(detail: SessionDetail, format: ExportFormat): void {
  const formatters: Record<
    ExportFormat,
    { fn: (d: SessionDetail) => string; ext: string; mime: string }
  > = {
    markdown: { fn: exportAsMarkdown, ext: 'md', mime: 'text/markdown;charset=utf-8' },
    json: { fn: exportAsJson, ext: 'json', mime: 'application/json;charset=utf-8' },
    plaintext: { fn: exportAsPlainText, ext: 'txt', mime: 'text/plain;charset=utf-8' },
  };

  const { fn, ext, mime } = formatters[format];
  const content = fn(detail);
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);

  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `session-${detail.session.id}.${ext}`;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}
