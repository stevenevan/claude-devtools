import { JSX, useEffect, useState } from 'react';
import { api, isDesktopMode } from '@renderer/api';
import { confirm } from '@renderer/components/common/ConfirmDialog';
import { Button } from '@renderer/components/ui/button';
import { useStore } from '@renderer/store';
import { formatBytes } from '@renderer/utils/formatters';

import { DryRunConfirmDialog } from '../maintenance/DryRunConfirmDialog';

import { SkillDetail } from './SkillDetail';

import type { SkillInventoryEntry } from '@shared/types/api';

export const SkillsManager = (): JSX.Element => {
  const connectionMode = useStore((s) => s.connectionMode);
  const canAct = isDesktopMode() && connectionMode === 'local';

  const [skills, setSkills] = useState<SkillInventoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [editorDirty, setEditorDirty] = useState(false);

  const [pendingRemoveLink, setPendingRemoveLink] = useState<SkillInventoryEntry | null>(null);
  const [pendingDelete, setPendingDelete] = useState<SkillInventoryEntry | null>(null);
  const [mutating, setMutating] = useState(false);
  const [mutateError, setMutateError] = useState<string | null>(null);

  const refresh = async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const result = await api.maintenance.skillsInventory();
      setSkills(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
    // Load once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (selectedName || skills.length === 0) return;
    setSelectedName(skills[0].name);
  }, [skills, selectedName]);

  const selectSkill = async (name: string): Promise<void> => {
    if (editorDirty) {
      const proceed = await confirm({
        title: 'Discard unsaved changes?',
        message: 'The current skill has unsaved changes. Switching will discard them.',
        confirmLabel: 'Discard',
        variant: 'danger',
      });
      if (!proceed) return;
    }
    setEditorDirty(false);
    setSelectedName(name);
  };

  const handleRemoveLink = async (): Promise<void> => {
    if (!pendingRemoveLink) return;
    setMutating(true);
    setMutateError(null);
    try {
      await api.maintenance.removeSkillLink(pendingRemoveLink.name);
      setPendingRemoveLink(null);
      setSelectedName(null);
      setEditorDirty(false);
      await refresh();
    } catch (err) {
      setMutateError(err instanceof Error ? err.message : String(err));
    } finally {
      setMutating(false);
    }
  };

  const handleDelete = async (): Promise<void> => {
    if (!pendingDelete) return;
    setMutating(true);
    setMutateError(null);
    try {
      await api.maintenance.deleteSkill(pendingDelete.name);
      setPendingDelete(null);
      setSelectedName(null);
      setEditorDirty(false);
      await refresh();
    } catch (err) {
      setMutateError(err instanceof Error ? err.message : String(err));
    } finally {
      setMutating(false);
    }
  };

  const selectedSkill = skills.find((s) => s.name === selectedName) ?? null;

  return (
    <div className="bg-background flex flex-1 flex-col overflow-hidden">
      <div className="border-border/50 border-b px-4 py-3">
        <p className="text-foreground text-sm font-medium">Skills</p>
        <p className="text-muted-foreground mt-0.5 text-xs">
          Inventory ~/.claude/skills/, edit a real skill&apos;s SKILL.md, and remove links or delete
          skills. Skills have no enable/disable — presence means enabled.
        </p>
      </div>

      {!canAct && (
        <div className="border-border/50 bg-card/50 text-muted-foreground border-b px-4 py-2 text-xs">
          Skill edits operate on this local machine only.
        </div>
      )}
      {error && (
        <div className="border-border/50 bg-destructive/10 text-destructive border-b px-4 py-2 text-xs">
          {error}
        </div>
      )}

      {loading ? (
        <p className="text-muted-foreground px-4 py-3 text-xs">Loading…</p>
      ) : (
        <div className="flex flex-1 overflow-hidden">
          <div className="border-border/50 flex w-72 shrink-0 flex-col gap-0.5 overflow-y-auto border-r p-2">
            {skills.length === 0 ? (
              <p className="text-muted-foreground px-1 pt-1 text-xs">
                No skills in ~/.claude/skills/.
              </p>
            ) : (
              skills.map((skill) => {
                const isSelected = skill.name === selectedName;
                return (
                  <Button
                    key={skill.name}
                    variant={isSelected ? 'secondary' : 'ghost'}
                    size="sm"
                    className="h-auto flex-col items-start gap-0.5 py-1.5"
                    onClick={() => void selectSkill(skill.name)}
                  >
                    <span className="flex w-full items-center gap-1.5">
                      <span className="text-foreground truncate text-xs font-medium">
                        {skill.name}
                      </span>
                      {skill.isSymlink && (
                        <span className="border-border bg-popover text-muted-foreground rounded-sm border px-1 py-px text-[10px]">
                          symlink
                        </span>
                      )}
                      <span className="text-muted-foreground ml-auto shrink-0 text-[10px]">
                        {formatBytes(skill.bytes)}
                      </span>
                    </span>
                    <span className="text-muted-foreground w-full truncate text-[10px]">
                      {skill.description || 'unset'}
                    </span>
                  </Button>
                );
              })
            )}
          </div>

          <div className="flex-1 overflow-y-auto">
            {selectedSkill ? (
              <SkillDetail
                key={selectedSkill.name}
                entry={selectedSkill}
                canAct={canAct}
                onSaved={() => void refresh()}
                onDirtyChange={setEditorDirty}
                onRequestRemoveLink={() => {
                  setMutateError(null);
                  setPendingRemoveLink(selectedSkill);
                }}
                onRequestDelete={() => {
                  setMutateError(null);
                  setPendingDelete(selectedSkill);
                }}
              />
            ) : (
              <p className="text-muted-foreground px-4 py-3 text-xs">Select a skill to view.</p>
            )}
          </div>
        </div>
      )}

      {pendingRemoveLink && (
        <DryRunConfirmDialog
          open
          onOpenChange={(open) => {
            if (!open) setPendingRemoveLink(null);
          }}
          paths={[pendingRemoveLink.resolvedPath]}
          totalBytes={pendingRemoveLink.bytes}
          fileCount={1}
          busy={mutating}
          error={mutateError}
          onMoveToTrash={() => void handleRemoveLink()}
        />
      )}

      {pendingDelete && (
        <DryRunConfirmDialog
          open
          onOpenChange={(open) => {
            if (!open) setPendingDelete(null);
          }}
          paths={[pendingDelete.resolvedPath]}
          totalBytes={pendingDelete.bytes}
          fileCount={1}
          busy={mutating}
          error={mutateError}
          onMoveToTrash={() => void handleDelete()}
        />
      )}
    </div>
  );
};
