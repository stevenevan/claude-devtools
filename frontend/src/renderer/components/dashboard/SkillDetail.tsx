import { JSX, useEffect, useState } from 'react';
import { api } from '@renderer/api';
import { MarkdownViewer } from '@renderer/components/chat/viewers/MarkdownViewer';
import { Button } from '@renderer/components/ui/button';
import { Pencil, Trash2, Unlink } from 'lucide-react';

import { ConfigEditorShell } from '../maintenance/ConfigEditorShell';
import { useFileBackedEditor } from '../maintenance/useFileBackedEditor';

import type { SkillInventoryEntry } from '@shared/types/api';

interface SkillDetailProps {
  entry: SkillInventoryEntry;
  canAct: boolean;
  onSaved: () => void;
  onDirtyChange: (dirty: boolean) => void;
  onRequestRemoveLink: () => void;
  onRequestDelete: () => void;
}

// Bound to one skill via the parent's key={entry.name} — remounts (and reloads
// SKILL.md fresh) on every selection change, mirroring AgentDetailEditor. The
// loaded SKILL.md doubles as the read-only markdown source and the editor
// buffer, so switching to edit never re-fetches.
export const SkillDetail = ({
  entry,
  canAct,
  onSaved,
  onDirtyChange,
  onRequestRemoveLink,
  onRequestDelete,
}: Readonly<SkillDetailProps>): JSX.Element => {
  const [editing, setEditing] = useState(false);
  const canEdit = !entry.isSymlink && entry.hasSkillMd;

  const { value, setValue, dirty, error, saving, loading, save, discard } = useFileBackedEditor({
    load: async () => (entry.hasSkillMd ? api.maintenance.readSkillDoc(entry.name) : ''),
    save: (v) => api.maintenance.writeSkillDoc(entry.name, v),
  });

  useEffect(() => {
    onDirtyChange(dirty);
  }, [dirty, onDirtyChange]);

  const editDisabledReason = entry.isSymlink
    ? 'Editing through a symlink writes the outside target.'
    : !entry.hasSkillMd
      ? 'No SKILL.md — not an editable skill.'
      : null;

  const handleSave = async (): Promise<void> => {
    await save();
    onSaved();
  };

  if (loading) {
    return <p className="text-muted-foreground px-4 py-3 text-xs">Loading…</p>;
  }

  if (editing && canEdit) {
    return (
      <ConfigEditorShell
        title={`${entry.name}/SKILL.md`}
        dirty={dirty}
        saving={saving}
        error={error}
        onSave={() => void handleSave()}
        onDiscard={discard}
        canAct={canAct}
      >
        <div className="flex flex-col gap-2 px-4 py-3">
          <div className="flex justify-end">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                discard();
                setEditing(false);
              }}
            >
              Done editing
            </Button>
          </div>
          <textarea
            value={value}
            onChange={(e) => setValue(e.target.value)}
            disabled={!canAct}
            spellCheck={false}
            className="border-border/50 bg-card/50 text-foreground min-h-[400px] w-full rounded-md border p-3 font-mono text-xs leading-relaxed"
          />
        </div>
      </ConfigEditorShell>
    );
  }

  return (
    <div className="flex flex-col gap-3 px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-foreground text-sm font-medium">{entry.name}</p>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={!canAct || !canEdit}
            onClick={() => setEditing(true)}
          >
            <Pencil className="size-3.5" />
            Edit SKILL.md
          </Button>
          {entry.isSymlink ? (
            <Button variant="destructive" size="sm" disabled={!canAct} onClick={onRequestRemoveLink}>
              <Unlink className="size-3.5" />
              Remove symlink
            </Button>
          ) : (
            <Button variant="destructive" size="sm" disabled={!canAct} onClick={onRequestDelete}>
              <Trash2 className="size-3.5" />
              Delete skill
            </Button>
          )}
        </div>
      </div>

      {editDisabledReason && <p className="text-muted-foreground text-xs">{editDisabledReason}</p>}

      {entry.isSymlink && (
        <div className="border-border/50 bg-card/50 rounded-md border px-3 py-2 text-xs">
          <p className="text-muted-foreground">
            Symlink → <span className="text-foreground font-mono">{entry.symlinkTarget}</span>
          </p>
          <p className="text-muted-foreground mt-1">
            Removing the link only removes the link; it never deletes the target or reclaims its
            space.
          </p>
        </div>
      )}

      <p className="text-muted-foreground text-xs">
        {entry.hasReferences ? 'Has a references/ directory.' : 'No references/ directory.'}
      </p>

      {entry.hasSkillMd ? (
        <MarkdownViewer content={value} label="SKILL.md" maxHeight="max-h-none" />
      ) : (
        <p className="text-muted-foreground text-xs">No SKILL.md in this directory.</p>
      )}
    </div>
  );
};
