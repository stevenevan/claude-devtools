import { JSX, useEffect, useState } from 'react';
import { api, isDesktopMode } from '@renderer/api';
import { Button } from '@renderer/components/ui/button';
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from '@renderer/components/ui/combobox';
import { Field, FieldDescription, FieldLabel } from '@renderer/components/ui/field';
import { Input } from '@renderer/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@renderer/components/ui/native-select';
import { useStore } from '@renderer/store';
import { Loader2 } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';

import type { PermissionRuleRow, PermissionScope, Suggestion } from '@shared/types/api';

type ListKey = 'allow' | 'deny' | 'ask';
type ScopeKind = 'global' | 'project-local';
const LISTS: ListKey[] = ['allow', 'deny', 'ask'];

const SOURCE_LABEL: Record<string, string> = {
  global: 'Global',
  'project-local': 'Project (local)',
  project: 'Project (committed)',
  'global-nested-anomaly': 'Global (nested anomaly)',
};

const LIST_BADGE: Record<string, string> = {
  allow: 'bg-emerald-500/15 text-emerald-500',
  deny: 'bg-red-500/15 text-red-500',
  ask: 'bg-amber-500/15 text-amber-500',
};

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function sourceLabel(kind: string): string {
  return SOURCE_LABEL[kind] ?? kind;
}

// scopeFor maps a writable row's sourceKind (or an add/move target) to the
// PermissionScope the write API expects. Only global + project-local are
// writable; project-local carries the selected project's root.
function scopeFor(kind: ScopeKind, projectPath: string): PermissionScope {
  return { kind, projectRoot: kind === 'project-local' ? projectPath : '' };
}

export const PermissionsPanel = (): JSX.Element => {
  const { projects, projectsLoading, connectionMode, fetchProjects } = useStore(
    useShallow((s) => ({
      projects: s.projects,
      projectsLoading: s.projectsLoading,
      projectsError: s.projectsError,
      connectionMode: s.connectionMode,
      fetchProjects: s.fetchProjects,
    }))
  );

  const [projectPath, setProjectPath] = useState('');
  const [rows, setRows] = useState<PermissionRuleRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [listFilter, setListFilter] = useState<'all' | ListKey>('all');
  const [addScope, setAddScope] = useState<ScopeKind>('project-local');
  const [addList, setAddList] = useState<ListKey>('allow');
  const [addRule, setAddRule] = useState('');
  const [movingIndex, setMovingIndex] = useState<number | null>(null);
  const [moveTargetKind, setMoveTargetKind] = useState<ScopeKind>('project-local');
  const [moveTargetList, setMoveTargetList] = useState<ListKey>('allow');

  const canAct = isDesktopMode() && connectionMode === 'local';

  useEffect(() => {
    if (projects.length === 0 && !projectsLoading) void fetchProjects();
    // Load once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!projectPath && projects.length > 0) setProjectPath(projects[0].path);
  }, [projects, projectPath]);

  const load = async (path: string): Promise<void> => {
    if (!path) return;
    setLoading(true);
    setError(null);
    setMovingIndex(null);
    try {
      const view = await api.getPermissionRules(path);
      setRows(view.rows);
    } catch (err) {
      setError(errText(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load(projectPath);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectPath]);

  const runWrite = async (op: () => Promise<void>): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await op();
      await load(projectPath);
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(false);
    }
  };

  const handleAdd = (): void => {
    const rule = addRule.trim();
    if (!rule) return;
    void runWrite(() => api.addPermissionRule(scopeFor(addScope, projectPath), addList, rule)).then(
      () => setAddRule('')
    );
  };

  const handleRemove = (row: PermissionRuleRow): void => {
    void runWrite(() =>
      api.removePermissionRule(scopeFor(row.sourceKind as ScopeKind, projectPath), row.list, row.rule)
    );
  };

  const handleMoveConfirm = (row: PermissionRuleRow): void => {
    void runWrite(() =>
      api.movePermissionRule(
        scopeFor(row.sourceKind as ScopeKind, projectPath),
        scopeFor(moveTargetKind, projectPath),
        row.list,
        moveTargetList,
        row.rule
      )
    );
  };

  const startMove = (index: number, row: PermissionRuleRow): void => {
    setMovingIndex(index);
    setMoveTargetKind(row.sourceKind === 'global' ? 'project-local' : 'global');
    setMoveTargetList(row.list as ListKey);
  };

  const filtered = rows.filter((r) => listFilter === 'all' || r.list === listFilter);

  return (
    <div className="flex flex-col">
      <div className="border-border/50 border-b px-4 py-3">
        <p className="text-foreground text-sm font-medium">Permissions</p>
        <p className="text-muted-foreground mt-0.5 text-xs">
          One view over permission rules scattered across global settings.json and each project&apos;s
          settings.local.json. Add, remove, or move rules between the two writable files. Rules are
          opaque strings — no grammar validation.
        </p>
      </div>

      {!canAct && (
        <div className="border-border/50 bg-card/50 text-muted-foreground border-b px-4 py-2 text-xs">
          Permission edits operate on this local machine only.
        </div>
      )}
      {error && (
        <div className="border-border/50 bg-destructive/10 text-destructive border-b px-4 py-2 text-xs">
          {error}
        </div>
      )}

      <div className="border-border/50 flex flex-wrap items-center gap-3 border-b px-4 py-3">
        <Field className="flex-row items-center gap-1">
          <FieldLabel htmlFor="permissions-project" className="text-muted-foreground text-xs">
            Project
          </FieldLabel>
          <Combobox
            items={projects.map((project) => project.path)}
            value={projectPath || null}
            itemToStringLabel={(path) =>
              projects.find((project) => project.path === path)?.name ?? path
            }
            onValueChange={(value) => {
              if (value) setProjectPath(value);
            }}
            autoHighlight
          >
            <div className="min-w-40">
              <ComboboxInput
                id="permissions-project"
                aria-label="Project"
                aria-describedby="permissions-project-description"
                placeholder={projectsLoading ? 'Loading projects…' : 'Select project...'}
                className="h-6 min-w-40"
              />
            </div>
            <ComboboxContent align="start" className="w-(--anchor-width)">
              <ComboboxList>
                {projects.map((project) => (
                  <ComboboxItem key={project.id} value={project.path}>
                    <span className="truncate">{project.name}</span>
                    <span className="text-muted-foreground ml-2 truncate text-[10px]">
                      {project.path}
                    </span>
                  </ComboboxItem>
                ))}
                <ComboboxEmpty>
                  {projectsLoading
                    ? 'Loading projects…'
                    : projects.length === 0
                      ? (projectsError ?? 'No projects available')
                      : 'No matching projects'}
                </ComboboxEmpty>
              </ComboboxList>
            </ComboboxContent>
          </Combobox>
          <FieldDescription id="permissions-project-description" className="sr-only">
            Choose the project whose permission rules are shown.
          </FieldDescription>
        </Field>
        <label className="text-muted-foreground flex items-center gap-1 text-xs">
          List
          <NativeSelect
            size="sm"
            value={listFilter}
            onChange={(e) => setListFilter(e.target.value as 'all' | ListKey)}
            className="min-w-20"
          >
            <NativeSelectOption value="all">all</NativeSelectOption>
            {LISTS.map((l) => (
              <NativeSelectOption key={l} value={l}>
                {l}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </label>
      </div>

      <AddRuleForm
        canAct={canAct}
        busy={busy}
        scope={addScope}
        list={addList}
        rule={addRule}
        onScope={setAddScope}
        onList={setAddList}
        onRule={setAddRule}
        onAdd={handleAdd}
      />

      <div className="border-border/50 border-b px-4 py-3">
        <p className="text-foreground mb-2 text-xs font-medium">Rules ({filtered.length})</p>
        {loading ? (
          <p className="text-muted-foreground text-xs">Loading…</p>
        ) : filtered.length === 0 ? (
          <p className="text-muted-foreground text-xs">No permission rules for this project.</p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {filtered.map((row, index) => (
              <RuleRow
                key={`${row.sourceKind}:${row.list}:${row.rule}:${index}`}
                row={row}
                canAct={canAct}
                busy={busy}
                isMoving={movingIndex === index}
                moveTargetKind={moveTargetKind}
                moveTargetList={moveTargetList}
                onStartMove={() => startMove(index, row)}
                onCancelMove={() => setMovingIndex(null)}
                onConfirmMove={() => handleMoveConfirm(row)}
                onMoveTargetKind={setMoveTargetKind}
                onMoveTargetList={setMoveTargetList}
                onRemove={() => handleRemove(row)}
              />
            ))}
          </div>
        )}
      </div>

      <SuggestionsDrawer
        canAct={canAct}
        projectPath={projectPath}
        onReload={() => load(projectPath)}
      />
    </div>
  );
};

interface AddRuleFormProps {
  canAct: boolean;
  busy: boolean;
  scope: ScopeKind;
  list: ListKey;
  rule: string;
  onScope: (s: ScopeKind) => void;
  onList: (l: ListKey) => void;
  onRule: (r: string) => void;
  onAdd: () => void;
}

const AddRuleForm = (props: Readonly<AddRuleFormProps>): JSX.Element => {
  const { canAct, busy, scope, list, rule, onScope, onList, onRule, onAdd } = props;
  return (
    <div className="border-border/50 flex flex-wrap items-end gap-2 border-b px-4 py-3">
      <label className="text-muted-foreground flex items-center gap-1 text-xs">
        File
        <NativeSelect
          size="sm"
          value={scope}
          disabled={!canAct}
          onChange={(e) => onScope(e.target.value as ScopeKind)}
          className="min-w-44"
        >
          <NativeSelectOption value="global">Global settings.json</NativeSelectOption>
          <NativeSelectOption value="project-local">Project settings.local.json</NativeSelectOption>
        </NativeSelect>
      </label>
      <label className="text-muted-foreground flex items-center gap-1 text-xs">
        List
        <NativeSelect
          size="sm"
          value={list}
          disabled={!canAct}
          onChange={(e) => onList(e.target.value as ListKey)}
          className="min-w-20"
        >
          {LISTS.map((l) => (
            <NativeSelectOption key={l} value={l}>
              {l}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </label>
      <Input
        value={rule}
        disabled={!canAct}
        placeholder="e.g. Bash(rm:*)"
        onChange={(e) => onRule(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onAdd();
        }}
        className="border-border/50 bg-card/50 text-foreground min-w-48 flex-1 rounded-sm border px-2 py-1 font-mono text-xs"
      />
      <Button
        variant="default"
        size="sm"
        disabled={!canAct || busy || rule.trim() === ''}
        onClick={onAdd}
      >
        {busy && <Loader2 className="size-3.5 animate-spin" />}
        Add
      </Button>
    </div>
  );
};

interface RuleRowProps {
  row: PermissionRuleRow;
  canAct: boolean;
  busy: boolean;
  isMoving: boolean;
  moveTargetKind: ScopeKind;
  moveTargetList: ListKey;
  onStartMove: () => void;
  onCancelMove: () => void;
  onConfirmMove: () => void;
  onMoveTargetKind: (s: ScopeKind) => void;
  onMoveTargetList: (l: ListKey) => void;
  onRemove: () => void;
}

const RuleRow = (props: Readonly<RuleRowProps>): JSX.Element => {
  const { row, canAct, busy, isMoving } = props;
  const writable = row.writable && canAct;
  return (
    <div className="border-border/50 rounded-md border px-2.5 py-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className={`rounded-sm px-1.5 py-px text-[10px] font-medium ${LIST_BADGE[row.list] ?? 'bg-card/50 text-muted-foreground'}`}
          >
            {row.list}
          </span>
          <span className="text-foreground truncate font-mono text-xs" title={row.rule}>
            {row.rule}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <span className="text-muted-foreground text-[10px]" title={row.sourcePath}>
            {sourceLabel(row.sourceKind)}
          </span>
          {writable && !isMoving && (
            <>
              <Button variant="ghost" size="sm" disabled={busy} onClick={props.onStartMove}>
                Move
              </Button>
              <Button variant="ghost" size="sm" disabled={busy} onClick={props.onRemove}>
                Remove
              </Button>
            </>
          )}
        </div>
      </div>
      {writable && isMoving && (
        <MovePicker
          busy={busy}
          targetKind={props.moveTargetKind}
          targetList={props.moveTargetList}
          onTargetKind={props.onMoveTargetKind}
          onTargetList={props.onMoveTargetList}
          onConfirm={props.onConfirmMove}
          onCancel={props.onCancelMove}
        />
      )}
    </div>
  );
};

interface MovePickerProps {
  busy: boolean;
  targetKind: ScopeKind;
  targetList: ListKey;
  onTargetKind: (s: ScopeKind) => void;
  onTargetList: (l: ListKey) => void;
  onConfirm: () => void;
  onCancel: () => void;
}

const MovePicker = (props: Readonly<MovePickerProps>): JSX.Element => (
  <div className="border-border/50 mt-2 flex flex-wrap items-center gap-2 border-t pt-2">
    <span className="text-muted-foreground text-[10px]">Move to</span>
    <NativeSelect
      size="sm"
      value={props.targetKind}
      onChange={(e) => props.onTargetKind(e.target.value as ScopeKind)}
      className="min-w-44"
    >
      <NativeSelectOption value="global">Global settings.json</NativeSelectOption>
      <NativeSelectOption value="project-local">Project settings.local.json</NativeSelectOption>
    </NativeSelect>
    <NativeSelect
      size="sm"
      value={props.targetList}
      onChange={(e) => props.onTargetList(e.target.value as ListKey)}
      className="min-w-20"
    >
      {LISTS.map((l) => (
        <NativeSelectOption key={l} value={l}>
          {l}
        </NativeSelectOption>
      ))}
    </NativeSelect>
    <Button variant="default" size="sm" disabled={props.busy} onClick={props.onConfirm}>
      {props.busy && <Loader2 className="size-3.5 animate-spin" />}
      Confirm
    </Button>
    <Button variant="ghost" size="sm" disabled={props.busy} onClick={props.onCancel}>
      Cancel
    </Button>
  </div>
);

interface SuggestionsDrawerProps {
  canAct: boolean;
  projectPath: string;
  onReload: () => Promise<void>;
}

// Suggestions are mined from the user's own tool_use records (Week 30). Each
// row proposes an allow rule; Add routes through the existing single-rule write
// path, Dismiss persists across restarts. No bulk/auto-apply.
const SuggestionsDrawer = (props: Readonly<SuggestionsDrawerProps>): JSX.Element => {
  const { canAct, projectPath, onReload } = props;
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [expandedRule, setExpandedRule] = useState<string | null>(null);
  const [actingRule, setActingRule] = useState<string | null>(null);

  const fetchSuggestions = async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const { effectivePath } = await api.config.getClaudeRootInfo();
      const [all, dismissed] = await Promise.all([
        api.analyzePermissionSuggestions(effectivePath),
        api.config.getDismissedSuggestions(),
      ]);
      const dismissedSet = new Set(dismissed);
      setSuggestions(all.filter((s) => !dismissedSet.has(s.rule)));
      setLoaded(true);
    } catch (err) {
      setError(errText(err));
    } finally {
      setLoading(false);
    }
  };

  const toggle = (): void => {
    const next = !open;
    setOpen(next);
    if (next && !loaded && !loading) void fetchSuggestions();
  };

  const handleAdd = async (s: Suggestion): Promise<void> => {
    setActingRule(s.rule);
    setError(null);
    try {
      await api.addPermissionRule(scopeFor('global', projectPath), 'allow', s.rule);
      setSuggestions((prev) => prev.filter((x) => x.rule !== s.rule));
      await onReload();
    } catch (err) {
      setError(errText(err));
    } finally {
      setActingRule(null);
    }
  };

  const handleDismiss = async (s: Suggestion): Promise<void> => {
    setActingRule(s.rule);
    setError(null);
    try {
      await api.config.dismissSuggestion(s.rule);
      setSuggestions((prev) => prev.filter((x) => x.rule !== s.rule));
    } catch (err) {
      setError(errText(err));
    } finally {
      setActingRule(null);
    }
  };

  return (
    <div className="px-4 py-3">
      <Button variant="ghost" size="sm" onClick={toggle}>
        {open ? '▾' : '▸'} Suggestions
      </Button>
      {open && (
        <div className="mt-2 flex flex-col gap-2">
          <p className="text-muted-foreground text-xs">
            Suggestions are derived from your own tool usage — they are not vetted for safety.
            Review each before adding.
          </p>
          {error && <p className="text-destructive text-xs">{error}</p>}
          {loading ? (
            <p className="text-muted-foreground text-xs">Loading…</p>
          ) : suggestions.length === 0 ? (
            <p className="text-muted-foreground text-xs">
              No suggestions — derived from your own usage.
            </p>
          ) : (
            <div className="flex flex-col gap-1.5">
              {suggestions.map((s) => (
                <SuggestionRow
                  key={s.rule}
                  suggestion={s}
                  canAct={canAct}
                  acting={actingRule === s.rule}
                  disabled={actingRule !== null}
                  expanded={expandedRule === s.rule}
                  onToggleSamples={() =>
                    setExpandedRule((cur) => (cur === s.rule ? null : s.rule))
                  }
                  onAdd={() => void handleAdd(s)}
                  onDismiss={() => void handleDismiss(s)}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

interface SuggestionRowProps {
  suggestion: Suggestion;
  canAct: boolean;
  acting: boolean;
  disabled: boolean;
  expanded: boolean;
  onToggleSamples: () => void;
  onAdd: () => void;
  onDismiss: () => void;
}

const SuggestionRow = (props: Readonly<SuggestionRowProps>): JSX.Element => {
  const { suggestion, canAct, acting, disabled, expanded } = props;
  const hasSamples = suggestion.samples.length > 0;
  return (
    <div className="border-border/50 rounded-md border px-2.5 py-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="text-foreground truncate font-mono text-xs" title={suggestion.rule}>
            {suggestion.rule}
          </span>
          <span className="text-muted-foreground text-[10px]">
            seen {suggestion.evidenceCount}× across {suggestion.sessionCount} sessions
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {hasSamples && (
            <Button variant="ghost" size="sm" onClick={props.onToggleSamples}>
              {expanded ? '▾' : '▸'} Samples ({suggestion.samples.length})
            </Button>
          )}
          <Button
            variant="default"
            size="sm"
            disabled={!canAct || disabled}
            onClick={props.onAdd}
          >
            {acting && <Loader2 className="size-3.5 animate-spin" />}
            Add to allow
          </Button>
          <Button variant="ghost" size="sm" disabled={disabled} onClick={props.onDismiss}>
            Dismiss
          </Button>
        </div>
      </div>
      {expanded && hasSamples && (
        <div className="border-border/50 mt-2 flex flex-col gap-1 border-t pt-2">
          {suggestion.samples.map((sample, index) => (
            <span
              key={`${sample}:${index}`}
              className="text-muted-foreground truncate font-mono text-[11px]"
              title={sample}
            >
              {sample}
            </span>
          ))}
        </div>
      )}
    </div>
  );
};
