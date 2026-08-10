import { JSX, useEffect, useState } from 'react';
import { api } from '@renderer/api';
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
import { NativeSelect, NativeSelectOption } from '@renderer/components/ui/native-select';
import { useStore } from '@renderer/store';
import { useShallow } from 'zustand/react/shallow';

import { JsonDiffView } from './JsonDiffView';
import { redactSecretValues } from './redactSecrets';

import type { Source, SourcesView } from '@shared/types/api';

const KIND_LABELS: Record<string, string> = {
  global: 'Global',
  'global-nested-anomaly': 'Global (nested anomaly)',
  project: 'Project',
  'project-local': 'Project (local)',
};

function kindLabel(kind: string): string {
  return KIND_LABELS[kind] ?? kind;
}

function prettyPrint(raw: string, reveal: boolean): string {
  try {
    const parsed = JSON.parse(raw || '{}');
    return JSON.stringify(reveal ? parsed : redactSecretValues(parsed), null, 2);
  } catch {
    return raw;
  }
}

// Read-only Week 18 panel: enumerates every settings.json source affecting a
// project plus a merged, provenance-tracked view. Secrets are masked by
// default (client-side); nothing here writes or deletes anything.
export const ProjectSettingsPanel = (): JSX.Element => {
  const { projects, projectsLoading, fetchProjects } = useStore(
    useShallow((s) => ({
      projects: s.projects,
      projectsLoading: s.projectsLoading,
      projectsError: s.projectsError,
      fetchProjects: s.fetchProjects,
    }))
  );

  const [projectPath, setProjectPath] = useState('');
  const [view, setView] = useState<SourcesView | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<Set<string>>(new Set());
  const [diffLeftPath, setDiffLeftPath] = useState('');
  const [diffRightPath, setDiffRightPath] = useState('');

  useEffect(() => {
    if (projects.length === 0 && !projectsLoading) void fetchProjects();
    // Load once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!projectPath && projects.length > 0) setProjectPath(projects[0].path);
  }, [projects, projectPath]);

  useEffect(() => {
    if (!projectPath) return;
    setLoading(true);
    setError(null);
    setRevealed(new Set());
    api
      .enumerateSettingsSources(projectPath)
      .then((result) => {
        setView(result);
        const existing = result.sources.filter((s) => s.exists);
        setDiffLeftPath(existing[0]?.path ?? '');
        setDiffRightPath(existing[1]?.path ?? existing[0]?.path ?? '');
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, [projectPath]);

  const toggleReveal = (path: string): void =>
    setRevealed((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  const sourceByPath = new Map((view?.sources ?? []).map((s) => [s.path, s]));
  const diffLeft = sourceByPath.get(diffLeftPath);
  const diffRight = sourceByPath.get(diffRightPath);

  return (
    <div className="flex flex-col">
      <div className="border-border/50 border-b px-4 py-3">
        <p className="text-foreground text-sm font-medium">Project Settings</p>
        <p className="text-muted-foreground mt-0.5 text-xs">
          Read-only view of every settings.json source affecting a project, merged with
          provenance. Secrets are masked by default. Nothing here writes or deletes anything.
        </p>
      </div>

      <div className="border-border/50 flex items-center gap-2 border-b px-4 py-3">
        <Field className="flex-row items-center gap-1">
          <FieldLabel htmlFor="project-settings-project" className="text-muted-foreground text-xs">
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
                id="project-settings-project"
                aria-label="Project"
                aria-describedby="project-settings-project-description"
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
          <FieldDescription id="project-settings-project-description" className="sr-only">
            Choose the project whose settings sources are shown.
          </FieldDescription>
        </Field>
      </div>

      {error && (
        <div className="border-border/50 bg-destructive/10 text-destructive border-b px-4 py-2 text-xs">
          {error}
        </div>
      )}

      {loading && <p className="text-muted-foreground px-4 py-3 text-xs">Loading…</p>}

      {!loading && !view && (
        <p className="text-muted-foreground px-4 py-3 text-xs">
          Select a project to inspect its settings sources.
        </p>
      )}

      {!loading && view && (
        <>
          <div className="border-border/50 border-b px-4 py-3">
            <p className="text-foreground mb-2 text-xs font-medium">Sources</p>
            {view.sources.length === 0 ? (
              <p className="text-muted-foreground text-xs">No sources found.</p>
            ) : (
              <div className="flex flex-col gap-3">
                {view.sources.map((source) => (
                  <SourceRow
                    key={source.path}
                    source={source}
                    revealed={revealed.has(source.path)}
                    onToggleReveal={() => toggleReveal(source.path)}
                  />
                ))}
              </div>
            )}
          </div>

          <div className="border-border/50 border-b px-4 py-3">
            <p className="text-foreground mb-2 text-xs font-medium">Merged (effective)</p>
            <MergedView merged={view.merged} provenance={view.provenance} />
          </div>

          <div className="px-4 py-3">
            <p className="text-foreground mb-2 text-xs font-medium">Diff</p>
            <div className="mb-2 flex flex-wrap items-center gap-3">
              <label className="text-muted-foreground flex items-center gap-1 text-xs">
                Left
                <NativeSelect
                  size="sm"
                  value={diffLeftPath}
                  onChange={(e) => setDiffLeftPath(e.target.value)}
                  className="min-w-40"
                >
                  {view.sources.map((s) => (
                    <NativeSelectOption key={s.path} value={s.path}>
                      {kindLabel(s.kind)}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </label>

              <label className="text-muted-foreground flex items-center gap-1 text-xs">
                Right
                <NativeSelect
                  size="sm"
                  value={diffRightPath}
                  onChange={(e) => setDiffRightPath(e.target.value)}
                  className="min-w-40"
                >
                  {view.sources.map((s) => (
                    <NativeSelectOption key={s.path} value={s.path}>
                      {kindLabel(s.kind)}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </label>
            </div>

            {diffLeft && diffRight ? (
              <JsonDiffView
                left={diffLeft.raw || '{}'}
                right={diffRight.raw || '{}'}
                leftLabel={kindLabel(diffLeft.kind)}
                rightLabel={kindLabel(diffRight.kind)}
                redactSecrets
              />
            ) : (
              <p className="text-muted-foreground text-xs">No sources to diff.</p>
            )}
          </div>
        </>
      )}
    </div>
  );
};

interface SourceRowProps {
  source: Source;
  revealed: boolean;
  onToggleReveal: () => void;
}

const SourceRow = ({ source, revealed, onToggleReveal }: Readonly<SourceRowProps>): JSX.Element => (
  <div className="border-border/50 rounded-md border p-3">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="min-w-0">
        <span className="text-foreground text-xs font-medium">{kindLabel(source.kind)}</span>
        <span className="bg-card/50 text-muted-foreground ml-2 rounded-sm px-1 py-px text-[9px] font-medium">
          {source.exists ? 'exists' : 'missing'}
        </span>
        {source.isAnomaly && (
          <span className="ml-2 rounded-sm bg-amber-500/15 px-1 py-px text-[9px] font-medium text-amber-500">
            anomaly
          </span>
        )}
        <p className="text-muted-foreground mt-0.5 truncate text-xs" title={source.path}>
          {source.path}
        </p>
      </div>
      {source.exists && (
        <Button variant="outline" size="sm" onClick={onToggleReveal}>
          {revealed ? 'Hide secrets' : 'Reveal secrets'}
        </Button>
      )}
    </div>

    {source.exists && (
      <pre className="border-border/50 bg-card/50 text-muted-foreground mt-2 max-h-64 overflow-auto rounded-md border p-2 font-mono text-xs whitespace-pre-wrap">
        {prettyPrint(source.raw, revealed)}
      </pre>
    )}
  </div>
);

interface MergedViewProps {
  merged: Record<string, unknown>;
  provenance: Record<string, string>;
}

const MergedView = ({ merged, provenance }: Readonly<MergedViewProps>): JSX.Element => {
  const masked = redactSecretValues(merged) as Record<string, unknown>;
  const keys = Object.keys(masked).sort();

  if (keys.length === 0) {
    return <p className="text-muted-foreground text-xs">No merged keys.</p>;
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-1">
        {keys.map((key) => (
          <span
            key={key}
            className="bg-card/50 text-muted-foreground rounded-sm px-1.5 py-0.5 text-[10px]"
            title={provenance[key] ?? 'unknown source'}
          >
            {key} ← {provenance[key] ?? 'unknown'}
          </span>
        ))}
      </div>
      <pre className="border-border/50 bg-card/50 text-muted-foreground max-h-96 overflow-auto rounded-md border p-2 font-mono text-xs whitespace-pre-wrap">
        {JSON.stringify(masked, null, 2)}
      </pre>
    </div>
  );
};
