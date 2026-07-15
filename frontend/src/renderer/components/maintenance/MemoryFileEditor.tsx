import { JSX, useEffect, useState } from 'react';
import { api } from '@renderer/api';
import { markdownComponents } from '@renderer/components/chat/markdownComponents';
import { Button } from '@renderer/components/ui/button';
import { formatBytes } from '@renderer/utils/formatters';
import { Trash2 } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { ConfigEditorShell } from './ConfigEditorShell';
import { useFileBackedEditor } from './useFileBackedEditor';

interface MemoryFileEditorProps {
  dirID: string;
  fileName: string;
  canAct: boolean;
  onSaved: () => void;
  onDirtyChange: (dirty: boolean) => void;
  onRequestDelete: () => void;
}

// Bound to one fact file via the parent's key={fileName} — remounts (and
// reloads fresh) on every file switch. Save surfaces the backend's
// consolidation-lock refusal through useFileBackedEditor's error.
export const MemoryFileEditor = ({
  dirID,
  fileName,
  canAct,
  onSaved,
  onDirtyChange,
  onRequestDelete,
}: Readonly<MemoryFileEditorProps>): JSX.Element => {
  const { value, setValue, dirty, error, saving, loading, save, discard } = useFileBackedEditor({
    load: () => api.maintenance.readMemoryFile(dirID, fileName),
    save: (v) => api.maintenance.writeMemoryFile(dirID, fileName, v),
  });

  const [showPreview, setShowPreview] = useState(false);

  useEffect(() => {
    onDirtyChange(dirty);
  }, [dirty, onDirtyChange]);

  const handleSave = async (): Promise<void> => {
    await save();
    onSaved();
  };

  if (loading) {
    return <p className="text-muted-foreground px-4 py-3 text-xs">Loading…</p>;
  }

  return (
    <ConfigEditorShell
      title={fileName}
      dirty={dirty}
      saving={saving}
      error={error}
      onSave={() => void handleSave()}
      onDiscard={discard}
      canAct={canAct}
    >
      <div className="flex flex-col gap-2 px-4 py-3">
        <div className="flex items-center justify-between gap-2">
          <span className="text-muted-foreground text-xs">
            {formatBytes(new TextEncoder().encode(value).length)} buffered
          </span>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setShowPreview((v) => !v)}>
              {showPreview ? 'Edit' : 'Preview'}
            </Button>
            <Button variant="destructive" size="sm" disabled={!canAct} onClick={onRequestDelete}>
              <Trash2 className="size-3.5" />
              Delete
            </Button>
          </div>
        </div>

        {showPreview ? (
          <div className="border-border/50 min-h-[400px] rounded-md border p-3">
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
              {value}
            </ReactMarkdown>
          </div>
        ) : (
          <textarea
            value={value}
            onChange={(e) => setValue(e.target.value)}
            disabled={!canAct}
            spellCheck={false}
            className="border-border/50 bg-card/50 text-foreground min-h-[400px] w-full rounded-md border p-3 font-mono text-xs leading-relaxed"
          />
        )}
      </div>
    </ConfigEditorShell>
  );
};
