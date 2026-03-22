/**
 * UpdateDialog - Modal dialog shown when a new version is available.
 *
 * Prompts the user to download the update or dismiss it.
 * Release notes may be HTML from the updater; we normalize to text and render as markdown.
 */

import { markdownComponents } from '@renderer/components/chat/markdownComponents';
import { Button } from '@renderer/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@renderer/components/ui/dialog';
import { useStore } from '@renderer/store';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

/**
 * Normalize release notes: strip HTML tags and convert block elements to newlines.
 * Uses DOMParser for proper HTML entity decoding (handles all entities like &mdash;, &#39;, etc.)
 */
function normalizeReleaseNotes(html: string): string {
  if (!html?.trim()) return '';

  const processed = html
    .replace(/<\/p>\s*/gi, '\n\n')
    .replace(/<br\s*\/?>\s*/gi, '\n')
    .replace(/<\/div>\s*/gi, '\n')
    .replace(/<\/li>\s*/gi, '\n')
    .replace(/<\/h[1-6]>\s*/gi, '\n\n');

  const parser = new DOMParser();
  const doc = parser.parseFromString(processed, 'text/html');
  const text = doc.body.textContent || '';

  return text.replace(/\n{3,}/g, '\n\n').trim();
}

export const UpdateDialog = (): React.JSX.Element => {
  const showUpdateDialog = useStore((s) => s.showUpdateDialog);
  const availableVersion = useStore((s) => s.availableVersion);
  const releaseNotes = useStore((s) => s.releaseNotes);
  const downloadUpdate = useStore((s) => s.downloadUpdate);
  const dismissUpdateDialog = useStore((s) => s.dismissUpdateDialog);

  return (
    <Dialog
      open={showUpdateDialog}
      onOpenChange={(open) => {
        if (!open) dismissUpdateDialog();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Update Available</DialogTitle>
          {availableVersion && <DialogDescription>v{availableVersion}</DialogDescription>}
        </DialogHeader>

        {releaseNotes && (
          <div className="prose prose-sm border-border bg-surface text-text-muted max-h-48 overflow-y-auto rounded-sm border p-2 text-xs">
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
              {normalizeReleaseNotes(releaseNotes)}
            </ReactMarkdown>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={dismissUpdateDialog}>
            Later
          </Button>
          <Button onClick={downloadUpdate}>Download</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
