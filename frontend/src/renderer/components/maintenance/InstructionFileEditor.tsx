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

interface InstructionFileEditorProps {
  relPath: string;
  isNewFile: boolean;
  deletable: boolean;
  canAct: boolean;
  onSaved: () => void;
  onDirtyChange: (dirty: boolean) => void;
  onRequestDelete: () => void;
}

// Bound to one file via the parent's key={relPath} — remounts (and reloads)
// on every file switch instead of trying to reset useFileBackedEditor state
// in place.
export const InstructionFileEditor = ({
  relPath,
  isNewFile,
  deletable,
  canAct,
  onSaved,
  onDirtyChange,
  onRequestDelete,
}: Readonly<InstructionFileEditorProps>): JSX.Element => {
  const { value, setValue, dirty, error, saving, loading, save, discard } = useFileBackedEditor({
    load: async () => {
      try {
        return await api.maintenance.readInstructionFile(relPath);
      } catch (err) {
        // A file selected via "New rules file" doesn't exist on disk yet —
        // start from an empty buffer instead of surfacing a read error.
        if (isNewFile) return '';
        throw err;
      }
    },
    save: (v) => api.maintenance.writeInstructionFile(relPath, v),
  });

  const [showPreview, setShowPreview] = useState(false);
  const isMarkdown = relPath.endsWith('.md');

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
      title={relPath}
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
            {isMarkdown && (
              <Button variant="outline" size="sm" onClick={() => setShowPreview((v) => !v)}>
                {showPreview ? 'Edit' : 'Preview'}
              </Button>
            )}
            {deletable && (
              <Button variant="destructive" size="sm" disabled={!canAct} onClick={onRequestDelete}>
                <Trash2 className="size-3.5" />
                Delete
              </Button>
            )}
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
