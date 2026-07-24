import { JSX, useEffect, useState } from 'react';
import { api } from '@renderer/api';
import { Button } from '@renderer/components/ui/button';
import { Trash2 } from 'lucide-react';

import { ConfigEditorShell } from './ConfigEditorShell';
import { parseCommandFrontmatter, serializeCommandFrontmatter } from './commandFrontmatter';
import { useFileBackedEditor } from './useFileBackedEditor';

import type { CommandFields } from './commandFrontmatter';

interface CommandDetailEditorProps {
  relPath: string;
  isNewFile: boolean;
  deletable: boolean;
  canAct: boolean;
  onSaved: () => void;
  onDirtyChange: (dirty: boolean) => void;
  onRequestDelete: () => void;
}

// Structured-frontmatter counterpart to InstructionFileEditor, scoped to
// commands/*.md. Unlike AgentDetailEditor, the buffer here IS the raw file
// text (frontmatter + body) — writeInstructionFile takes the whole file, so
// there's no separate patch call to build.
export const CommandDetailEditor = ({
  relPath,
  isNewFile,
  deletable,
  canAct,
  onSaved,
  onDirtyChange,
  onRequestDelete,
}: Readonly<CommandDetailEditorProps>): JSX.Element => {
  const { value, setValue, dirty, error, saving, loading, save, discard } = useFileBackedEditor({
    load: async () => {
      try {
        return await api.maintenance.readInstructionFile(relPath);
      } catch (err) {
        if (isNewFile) return '';
        throw err;
      }
    },
    save: (v) => api.maintenance.writeInstructionFile(relPath, v),
  });

  const [showRaw, setShowRaw] = useState(false);

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

  const { fields, unknownLines, body, hasFrontmatter } = parseCommandFrontmatter(value);
  const update = (patch: Partial<CommandFields>): void => {
    setValue(serializeCommandFrontmatter({ ...fields, ...patch }, unknownLines, body));
  };
  const raw = !hasFrontmatter || showRaw;

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
      <div className="flex flex-col gap-3 px-4 py-3">
        <div className="flex items-center justify-between gap-2">
          {hasFrontmatter && (
            <Button variant="outline" size="sm" onClick={() => setShowRaw((v) => !v)}>
              {showRaw ? 'Structured' : 'Raw'}
            </Button>
          )}
          {deletable && (
            <Button variant="destructive" size="sm" disabled={!canAct} onClick={onRequestDelete}>
              <Trash2 className="size-3.5" />
              Delete
            </Button>
          )}
        </div>

        {raw ? (
          <textarea
            value={value}
            onChange={(e) => setValue(e.target.value)}
            disabled={!canAct}
            spellCheck={false}
            className="border-border/50 bg-card/50 text-foreground min-h-[400px] w-full rounded-md border p-3 font-mono text-xs leading-relaxed"
          />
        ) : (
          <>
            <label className="flex flex-col gap-1">
              <span className="text-muted-foreground text-xs">description</span>
              <input
                value={fields.description ?? ''}
                disabled={!canAct}
                onChange={(e) => update({ description: e.target.value })}
                className="border-border/50 bg-card/50 text-foreground rounded-md border px-2 py-1 text-xs"
              />
            </label>

            <label className="flex flex-col gap-1">
              <span className="text-muted-foreground text-xs">argument-hint</span>
              <input
                value={fields.argumentHint ?? ''}
                disabled={!canAct}
                placeholder="unset"
                onChange={(e) => update({ argumentHint: e.target.value })}
                className="border-border/50 bg-card/50 text-foreground rounded-md border px-2 py-1 text-xs"
              />
            </label>

            <label className="flex flex-col gap-1">
              <span className="text-muted-foreground text-xs">
                allowed-tools{' '}
                <span className="text-muted-foreground/70">(comma/space-separated, blank = unset)</span>
              </span>
              <input
                value={fields.allowedToolsIsComplex ? '' : (fields.allowedTools ?? '')}
                disabled={!canAct || fields.allowedToolsIsComplex === true}
                placeholder={fields.allowedToolsIsComplex ? 'YAML list — edit in Raw mode' : 'unset'}
                onChange={(e) => update({ allowedTools: e.target.value })}
                className="border-border/50 bg-card/50 text-foreground rounded-md border px-2 py-1 font-mono text-xs"
              />
              {fields.allowedToolsIsComplex && (
                <span className="text-[11px] text-amber-500">
                  Defined as a YAML list on disk — switch to Raw to edit.
                </span>
              )}
            </label>

            <label className="flex flex-col gap-1">
              <span className="text-muted-foreground text-xs">model</span>
              <input
                value={fields.model ?? ''}
                disabled={!canAct}
                placeholder="unset"
                onChange={(e) => update({ model: e.target.value })}
                className="border-border/50 bg-card/50 text-foreground rounded-md border px-2 py-1 text-xs"
              />
            </label>

            <label className="text-muted-foreground flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={fields.disableModelInvocation ?? false}
                disabled={!canAct}
                onChange={(e) => update({ disableModelInvocation: e.target.checked })}
              />
              disable-model-invocation
            </label>

            <label className="text-muted-foreground flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={fields.userInvocable ?? true}
                disabled={!canAct}
                onChange={(e) => update({ userInvocable: e.target.checked })}
              />
              user-invocable
            </label>

            <label className="flex flex-col gap-1">
              <span className="text-muted-foreground text-xs">body</span>
              <textarea
                value={body}
                disabled={!canAct}
                spellCheck={false}
                onChange={(e) =>
                  setValue(serializeCommandFrontmatter(fields, unknownLines, e.target.value))
                }
                className="border-border/50 bg-card/50 text-foreground min-h-[300px] w-full rounded-md border p-3 font-mono text-xs leading-relaxed"
              />
            </label>
          </>
        )}
      </div>
    </ConfigEditorShell>
  );
};
