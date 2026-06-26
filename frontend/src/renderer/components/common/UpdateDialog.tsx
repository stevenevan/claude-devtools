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

// Strips HTML and converts block elements to newlines; uses DOMParser for entity decoding.
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
          <div className="prose prose-sm border-border bg-background text-muted-foreground max-h-48 overflow-y-auto rounded-sm border p-2 text-xs">
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
