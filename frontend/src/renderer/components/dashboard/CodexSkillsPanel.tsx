import { JSX, useCallback, useEffect, useState } from 'react';
import { api } from '@renderer/api';
import { MarkdownViewer } from '@renderer/components/chat/viewers/MarkdownViewer';
import { Button } from '@renderer/components/ui/button';

import {
  codexEnabledLabel,
  codexScopeLabel,
  codexStateLabel,
  CodexDiagnostics,
} from './CodexInventorySource';

import type {
  CodexInventoryScope,
  CodexSkillDetail,
  CodexSkillList,
  CodexSkillSummary,
} from '@shared/types/api';
import type { UIMode } from '@shared/types';

interface CodexSkillsPanelProps {
  readonly mode: UIMode;
  readonly scope: CodexInventoryScope;
  readonly projectName?: string;
}

export const CodexSkillsPanel = ({
  mode,
  scope,
  projectName,
}: Readonly<CodexSkillsPanelProps>): JSX.Element => {
  const [inventory, setInventory] = useState<CodexSkillList | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<CodexSkillDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      setInventory(await api.listCodexSkills(scope));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLoading(false);
    }
  }, [scope]);

  useEffect(() => {
    setSelectedId(null);
    setDetail(null);
    setDetailError(null);
    void refresh();
  }, [refresh]);

  const selectSkill = async (skill: CodexSkillSummary): Promise<void> => {
    setSelectedId(skill.identity.id);
    setDetail(null);
    setDetailError(null);
    if (mode === 'simple') return;
    setDetailLoading(true);
    try {
      setDetail(await api.readCodexSkill(scope, skill.identity.id));
    } catch (reason) {
      setDetailError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setDetailLoading(false);
    }
  };

  const selected = inventory?.items.find((skill) => skill.identity.id === selectedId) ?? null;
  const scopeLabel = codexScopeLabel(scope, projectName);

  return (
    <div className="bg-background flex flex-1 flex-col overflow-hidden">
      <div className="border-border/50 border-b px-4 py-3">
        <p className="text-foreground text-sm font-medium">Codex skills</p>
        <p className="text-muted-foreground mt-0.5 text-xs">
          Inspect read-only skill metadata and bounded SKILL.md content from the {scopeLabel.toLowerCase()}.
          Scripts, references, and assets are listed but never loaded or run.
        </p>
      </div>
      {error && (
        <div className="border-border/50 bg-destructive/10 text-destructive border-b px-4 py-2 text-xs">
          {error}
        </div>
      )}
      {loading ? (
        <p className="text-muted-foreground px-4 py-3 text-xs">Loading Codex skills…</p>
      ) : mode === 'simple' ? (
        <SimpleSkills
          skills={inventory?.items ?? []}
          selected={selected}
          onSelect={(skill) => void selectSkill(skill)}
        />
      ) : (
        <div className="flex flex-1 overflow-hidden">
          <div className="border-border/50 flex w-80 shrink-0 flex-col gap-0.5 overflow-y-auto border-r p-2">
            {inventory && inventory.items.length > 0 ? (
              inventory.items.map((skill) => (
                <Button
                  key={skill.identity.id}
                  type="button"
                  variant={skill.identity.id === selectedId ? 'secondary' : 'ghost'}
                  size="sm"
                  className="h-auto flex-col items-start gap-1 py-2 text-left"
                  onClick={() => void selectSkill(skill)}
                >
                  <span className="text-foreground w-full truncate text-xs font-medium">
                    {skill.name}
                  </span>
                  <span className="text-muted-foreground w-full truncate text-[10px]">
                    {skill.description || 'No description provided.'}
                  </span>
                  <span className="flex w-full items-center gap-1.5 text-[10px]">
                    <span className="text-muted-foreground truncate">{skill.identity.label}</span>
                    <span className="text-muted-foreground ml-auto shrink-0 rounded-sm border border-border/60 px-1">
                      {codexStateLabel(skill.state)}
                    </span>
                  </span>
                </Button>
              ))
            ) : (
              <p className="text-muted-foreground px-1 pt-1 text-xs">
                No Codex skills were found in this scope.
              </p>
            )}
          </div>
          <div className="flex-1 overflow-y-auto">
            {detailLoading ? (
              <p className="text-muted-foreground px-4 py-3 text-xs">Loading selected skill…</p>
            ) : detailError ? (
              <p className="text-destructive px-4 py-3 text-xs">{detailError}</p>
            ) : detail && selected ? (
              <SkillDetail detail={detail} />
            ) : (
              <p className="text-muted-foreground px-4 py-3 text-xs">
                Select a skill to inspect it. Nothing is selected automatically.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

const SimpleSkills = ({
  skills,
  selected,
  onSelect,
}: Readonly<{
  skills: readonly CodexSkillSummary[];
  selected: CodexSkillSummary | null;
  onSelect: (skill: CodexSkillSummary) => void;
}>): JSX.Element => (
  <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-6 py-6">
    <p className="text-muted-foreground max-w-2xl text-sm">
      Codex skills add focused instructions. This view shows their purpose, source, and effective
      state without exposing local skill text or controls to install or toggle them.
    </p>
    <div className="flex flex-col gap-2">
      {skills.length === 0 ? (
        <p className="text-muted-foreground text-sm">No Codex skills were found in this scope.</p>
      ) : (
        skills.map((skill) => (
          <button
            key={skill.identity.id}
            type="button"
            className={`border-border bg-card/50 hover:bg-muted flex w-full items-start justify-between gap-4 rounded-md border px-4 py-3 text-left ${selected?.identity.id === skill.identity.id ? 'ring-ring/50 ring-1' : ''}`}
            onClick={() => onSelect(skill)}
          >
            <span className="min-w-0">
              <span className="text-foreground block text-sm font-medium">{skill.name}</span>
              <span className="text-muted-foreground mt-1 block text-xs leading-relaxed">
                {skill.description || 'No description provided.'}
              </span>
              <span className="text-muted-foreground mt-2 block text-xs">
                Source: {skill.identity.label}
              </span>
            </span>
            <span className="text-muted-foreground shrink-0 rounded-sm border border-border/60 px-2 py-1 text-xs">
              {codexEnabledLabel(skill.enabledState)}
            </span>
          </button>
        ))
      )}
    </div>
    {selected && (
      <div className="border-border/50 bg-card/50 rounded-md border px-4 py-3">
        <p className="text-foreground text-sm font-medium">{selected.name}</p>
        <p className="text-muted-foreground mt-1 text-xs">
          {selected.description || 'No description provided.'}
        </p>
        <p className="text-muted-foreground mt-2 text-xs">Source: {selected.identity.label}</p>
        <p className="text-muted-foreground mt-1 text-xs">
          State: {codexEnabledLabel(selected.enabledState)}
        </p>
      </div>
    )}
  </div>
);

const SkillDetail = ({ detail }: Readonly<{ detail: CodexSkillDetail }>): JSX.Element => (
  <div className="flex flex-col gap-3 px-4 py-3">
    <div>
      <p className="text-foreground text-sm font-medium">{detail.skill.name}</p>
      <p className="text-muted-foreground mt-1 text-xs">{detail.skill.identity.relativePath}</p>
    </div>
    <p className="text-muted-foreground text-xs">
      Local skill metadata and content are untrusted. This inspector never imports or runs a
      skill resource.
    </p>
    {detail.truncated && (
      <p className="text-amber-400 text-xs">SKILL.md was truncated to the bounded detail size.</p>
    )}
    <div className="grid gap-2 sm:grid-cols-3">
      <Metadata label="Validation" value={codexStateLabel(detail.skill.state)} />
      <Metadata label="Enabled state" value={codexEnabledLabel(detail.skill.enabledState)} />
      <Metadata label="Entry point" value={detail.skill.entryPoint} />
      <Metadata label="Revision" value={detail.exactRevision ?? 'Unavailable'} mono />
    </div>
    <CodexDiagnostics diagnostics={detail.skill.diagnostics} />
    <div className="border-border/50 bg-card/50 rounded-md border px-3 py-2">
      <p className="text-muted-foreground text-[10px] font-medium uppercase tracking-wide">
        Resources
      </p>
      {detail.skill.resources.length === 0 ? (
        <p className="text-muted-foreground mt-1 text-xs">No listed resources.</p>
      ) : (
        <ul className="mt-1 space-y-1">
          {detail.skill.resources.map((resource) => (
            <li key={`${resource.kind}-${resource.relativePath}`} className="text-muted-foreground text-xs">
              {resource.kind}: {resource.relativePath}
            </li>
          ))}
        </ul>
      )}
    </div>
    <MarkdownViewer
      content={detail.content}
      label="Untrusted SKILL.md"
      maxHeight="max-h-[32rem]"
    />
  </div>
);

const Metadata = ({
  label,
  value,
  mono = false,
}: Readonly<{ label: string; value: string; mono?: boolean }>): JSX.Element => (
  <div className="border-border/50 bg-card/50 rounded-md border px-3 py-2">
    <p className="text-muted-foreground text-[10px]">{label}</p>
    <p className={`text-foreground mt-1 break-all text-xs ${mono ? 'font-mono' : ''}`}>{value}</p>
  </div>
);
