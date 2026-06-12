/**
 * Session export utilities for claude-devtools.
 *
 * Provides formatters to export session data as plain text, Markdown, or JSON,
 * and a download trigger for browser-based file saving.
 */

import type { SessionDetail } from '@renderer/types/data';

import { exportAIChunkAsMarkdown, exportAsMarkdown } from './markdownExporter';
import { exportAsPlainText } from './plainTextExporter';

export { extractTextFromContent } from './contentExtractor';
export { exportAsMarkdown, exportAIChunkAsMarkdown, exportAsPlainText };

export type ExportFormat = 'markdown' | 'json' | 'plaintext';

/**
 * Export session as pretty-printed JSON.
 */
export function exportAsJson(detail: SessionDetail): string {
  return JSON.stringify(detail, null, 2);
}

/**
 * Trigger a browser file download for the given session in the specified format.
 *
 * Creates a Blob, generates an object URL, and simulates an anchor click
 * to initiate the download.
 */
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
