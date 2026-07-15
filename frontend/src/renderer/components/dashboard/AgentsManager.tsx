import { JSX, useEffect, useState } from 'react';
import { api, isDesktopMode } from '@renderer/api';
import { confirm } from '@renderer/components/common/ConfirmDialog';
import { Button } from '@renderer/components/ui/button';
import { useStore } from '@renderer/store';
import { formatBytes } from '@renderer/utils/formatters';
import { Loader2, Plus } from 'lucide-react';

import { DryRunConfirmDialog } from '../maintenance/DryRunConfirmDialog';

import { AgentDetailEditor } from './AgentDetailEditor';

import type { GlobalAgent } from '@shared/types/api';

function fileBaseOf(filePath: string): string {
  const base = filePath.split('/').pop() ?? filePath;
  return base.endsWith('.md') ? base.slice(0, -3) : base;
}

function byteLength(content: string): number {
  return new TextEncoder().encode(content).length;
}

function toolsSummary(tools: string): string {
  const list = tools
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
  return list.length === 0 ? 'unset' : `${list.length} tool${list.length === 1 ? '' : 's'}`;
}

export const AgentsManager = (): JSX.Element => {
  const connectionMode = useStore((s) => s.connectionMode);
  const canAct = isDesktopMode() && connectionMode === 'local';

  const [agents, setAgents] = useState<GlobalAgent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedFileBase, setSelectedFileBase] = useState<string | null>(null);
  const [editorDirty, setEditorDirty] = useState(false);

  const [showCreate, setShowCreate] = useState(false);
  const [createName, setCreateName] = useState('');
  const [createDescription, setCreateDescription] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [pendingDelete, setPendingDelete] = useState<GlobalAgent | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const refresh = async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const result = await api.maintenance.listManagedAgents();
      setAgents(result);
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
    if (selectedFileBase || agents.length === 0) return;
    setSelectedFileBase(fileBaseOf(agents[0].filePath));
  }, [agents, selectedFileBase]);

  const selectAgent = async (fileBase: string): Promise<void> => {
    if (editorDirty) {
      const proceed = await confirm({
        title: 'Discard unsaved changes?',
        message: 'The current agent has unsaved changes. Switching will discard them.',
        confirmLabel: 'Discard',
        variant: 'danger',
      });
      if (!proceed) return;
    }
    setEditorDirty(false);
    setSelectedFileBase(fileBase);
  };

  const handleCreate = async (): Promise<void> => {
    const name = createName.trim();
    const description = createDescription.trim();
    if (!name) return;
    setCreating(true);
    setCreateError(null);
    try {
      await api.maintenance.createAgent(name, description);
      setShowCreate(false);
      setCreateName('');
      setCreateDescription('');
      setEditorDirty(false);
      await refresh();
      setSelectedFileBase(name);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : String(err));
    } finally {
      setCreating(false);
    }
  };

  const handleConfirmDelete = async (): Promise<void> => {
    if (!pendingDelete) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await api.maintenance.deleteAgent(fileBaseOf(pendingDelete.filePath));
      setPendingDelete(null);
      setSelectedFileBase(null);
      setEditorDirty(false);
      await refresh();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : String(err));
    } finally {
      setDeleting(false);
    }
  };

  const selectedAgent = agents.find((a) => fileBaseOf(a.filePath) === selectedFileBase) ?? null;

  return (
    <div className="bg-background flex flex-1 flex-col overflow-hidden">
      <div className="border-border/50 flex items-start justify-between gap-3 border-b px-4 py-3">
        <div>
          <p className="text-foreground text-sm font-medium">Agents</p>
          <p className="text-muted-foreground mt-0.5 text-xs">
            Edit ~/.claude/agents/*.md frontmatter and system prompts, or create and delete agents.
          </p>
        </div>
        <Button
          variant="default"
          size="sm"
          disabled={!canAct}
          onClick={() => {
            setCreateError(null);
            setShowCreate((v) => !v);
          }}
        >
          <Plus className="size-3.5" />
          New agent
        </Button>
      </div>

      {!canAct && (
        <div className="border-border/50 bg-card/50 text-muted-foreground border-b px-4 py-2 text-xs">
          Agent edits operate on this local machine only.
        </div>
      )}
      {error && (
        <div className="border-border/50 bg-destructive/10 text-destructive border-b px-4 py-2 text-xs">
          {error}
        </div>
      )}

      {showCreate && (
        <div className="border-border/50 flex flex-wrap items-end gap-2 border-b px-4 py-3">
          <label className="text-muted-foreground flex flex-col gap-1 text-xs">
            Name (filename)
            <input
              value={createName}
              disabled={!canAct}
              placeholder="my-agent"
              onChange={(e) => setCreateName(e.target.value)}
              className="border-border/50 bg-card/50 text-foreground w-48 rounded-sm border px-2 py-1 text-xs"
            />
          </label>
          <label className="text-muted-foreground flex flex-1 flex-col gap-1 text-xs">
            Description
            <input
              value={createDescription}
              disabled={!canAct}
              placeholder="What this agent does"
              onChange={(e) => setCreateDescription(e.target.value)}
              className="border-border/50 bg-card/50 text-foreground min-w-48 rounded-sm border px-2 py-1 text-xs"
            />
          </label>
          <Button
            variant="default"
            size="sm"
            disabled={!canAct || creating || createName.trim() === ''}
            onClick={() => void handleCreate()}
          >
            {creating && <Loader2 className="size-3.5 animate-spin" />}
            Create
          </Button>
          {createError && <p className="text-destructive w-full text-xs">{createError}</p>}
        </div>
      )}

      {loading ? (
        <p className="text-muted-foreground px-4 py-3 text-xs">Loading…</p>
      ) : (
        <div className="flex flex-1 overflow-hidden">
          <div className="border-border/50 flex w-72 shrink-0 flex-col gap-0.5 overflow-y-auto border-r p-2">
            {agents.length === 0 ? (
              <p className="text-muted-foreground px-1 pt-1 text-xs">
                No agents in ~/.claude/agents/.
              </p>
            ) : (
              agents.map((agent) => {
                const base = fileBaseOf(agent.filePath);
                const isSelected = base === selectedFileBase;
                return (
                  <Button
                    key={base}
                    variant={isSelected ? 'secondary' : 'ghost'}
                    size="sm"
                    className="h-auto flex-col items-start gap-0.5 py-1.5"
                    onClick={() => void selectAgent(base)}
                  >
                    <span className="text-foreground w-full truncate text-xs font-medium">
                      {agent.name}
                    </span>
                    <span className="flex w-full items-center gap-1.5 text-[10px]">
                      <span className="border-border bg-popover text-muted-foreground rounded-sm border px-1 py-px">
                        {agent.model || 'unset'}
                      </span>
                      <span className="text-muted-foreground truncate">
                        {toolsSummary(agent.tools)}
                      </span>
                      <span className="text-muted-foreground ml-auto shrink-0">
                        {formatBytes(byteLength(agent.content))}
                      </span>
                    </span>
                  </Button>
                );
              })
            )}
          </div>

          <div className="flex-1 overflow-y-auto">
            {selectedAgent ? (
              <AgentDetailEditor
                key={selectedFileBase ?? ''}
                fileBase={fileBaseOf(selectedAgent.filePath)}
                canAct={canAct}
                onSaved={() => void refresh()}
                onDirtyChange={setEditorDirty}
                onRequestDelete={() => setPendingDelete(selectedAgent)}
              />
            ) : (
              <p className="text-muted-foreground px-4 py-3 text-xs">Select an agent to edit.</p>
            )}
          </div>
        </div>
      )}

      {pendingDelete && (
        <DryRunConfirmDialog
          open
          onOpenChange={(open) => {
            if (!open) setPendingDelete(null);
          }}
          paths={[pendingDelete.filePath]}
          totalBytes={byteLength(pendingDelete.content)}
          fileCount={1}
          busy={deleting}
          error={deleteError}
          onMoveToTrash={() => void handleConfirmDelete()}
        />
      )}
    </div>
  );
};
