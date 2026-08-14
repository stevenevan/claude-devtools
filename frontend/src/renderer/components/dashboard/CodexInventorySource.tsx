import { JSX } from 'react';
import { Button } from '@renderer/components/ui/button';

import type {
  CodexInventoryDiagnostic,
  CodexInventoryScope,
  CodexValidationState,
} from '@shared/types/api';
import type { Project } from '@shared/types';

export type InventorySource = 'claude' | 'codex';

export function getCodexScope(
  selectedProjectId: string | null,
  projects: readonly Project[]
): CodexInventoryScope {
  return selectedProjectId && projects.some((project) => project.id === selectedProjectId)
    ? { kind: 'project', projectId: selectedProjectId }
    : { kind: 'global' };
}

export function codexScopeLabel(scope: CodexInventoryScope, projectName?: string): string {
  return scope.kind === 'project'
    ? `Project · ${projectName || 'selected project'}`
    : 'Global Codex layer';
}

interface CodexSourcePickerProps {
  readonly source: InventorySource;
  readonly onChange: (source: InventorySource) => void;
  readonly scope: CodexInventoryScope;
  readonly projectName?: string;
}

export const CodexSourcePicker = ({
  source,
  onChange,
  scope,
  projectName,
}: Readonly<CodexSourcePickerProps>): JSX.Element => (
  <div className="border-border/50 flex flex-wrap items-center gap-2 border-b px-4 py-2">
    <span className="text-muted-foreground text-[10px] font-medium uppercase tracking-wide">
      Source
    </span>
    <div className="flex items-center gap-1" role="group" aria-label="Inventory source">
      {(['claude', 'codex'] as const).map((option) => (
        <Button
          key={option}
          type="button"
          variant={source === option ? 'secondary' : 'ghost'}
          size="sm"
          aria-pressed={source === option}
          onClick={() => onChange(option)}
        >
          {option === 'claude' ? 'Claude' : 'Codex'}
        </Button>
      ))}
    </div>
    <span className="text-muted-foreground text-xs">
      {source === 'codex' ? codexScopeLabel(scope, projectName) : 'Claude global inventory'}
    </span>
    {source === 'codex' && scope.kind === 'global' && (
      <span className="text-muted-foreground text-[10px]">
        Select a project to include its project layers.
      </span>
    )}
  </div>
);

export function codexStateLabel(state: CodexValidationState): string {
  switch (state) {
    case 'valid':
      return 'Valid';
    case 'missing':
      return 'Missing';
    case 'malformed':
      return 'Malformed';
    case 'invalid':
      return 'Invalid';
    default:
      return 'Unknown';
  }
}

export function codexEnabledLabel(state: string): string {
  switch (state) {
    case 'enabled':
      return 'Enabled';
    case 'disabled':
      return 'Disabled';
    case 'inherited':
      return 'Inherited';
    default:
      return 'State unknown';
  }
}

interface CodexDiagnosticsProps {
  readonly diagnostics: readonly CodexInventoryDiagnostic[];
}

export const CodexDiagnostics = ({
  diagnostics,
}: Readonly<CodexDiagnosticsProps>): JSX.Element | null => {
  if (diagnostics.length === 0) return null;

  return (
    <div className="border-border/50 bg-card/50 rounded-md border px-3 py-2">
      <p className="text-muted-foreground text-[10px] font-medium uppercase tracking-wide">
        Diagnostics
      </p>
      <ul className="mt-1 space-y-1">
        {diagnostics.map((diagnostic, index) => (
          <li key={`${diagnostic.code}-${diagnostic.relativePath ?? 'inventory'}-${index}`} className="text-muted-foreground text-xs">
            <span className="text-foreground">{diagnostic.severity}:</span> {diagnostic.message}
          </li>
        ))}
      </ul>
    </div>
  );
};
