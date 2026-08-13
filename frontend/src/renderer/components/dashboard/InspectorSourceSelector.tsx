import { useEffect } from 'react';

import { useShallow } from 'zustand/react/shallow';

import { useStore } from '@renderer/store';
import { Button } from '@renderer/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@renderer/components/ui/select';

import type { SourceKind } from '@shared/types/api';

const SOURCE_OPTIONS: SourceKind[] = ['claude', 'codex'];

const SOURCE_LABELS: Record<SourceKind, string> = {
  claude: 'Claude',
  codex: 'Codex',
};

export function InspectorSourceSelector() {
  const {
    inspectorSource,
    inspectorSources,
    inspectorSourcesLoading,
    inspectorSourcesError,
    loadInspectorSources,
    setInspectorSource,
  } = useStore(
    useShallow((state) => ({
      inspectorSource: state.inspectorSource,
      inspectorSources: state.inspectorSources,
      inspectorSourcesLoading: state.inspectorSourcesLoading,
      inspectorSourcesError: state.inspectorSourcesError,
      loadInspectorSources: state.loadInspectorSources,
      setInspectorSource: state.setInspectorSource,
    }))
  );

  useEffect(() => {
    void loadInspectorSources();
  }, [loadInspectorSources]);

  const statusBySource = new Map(inspectorSources.map((status) => [status.sourceKind, status]));
  const selectedStatus = statusBySource.get(inspectorSource);

  return (
    <div className="flex min-w-0 items-center gap-2">
      <span className="text-muted-foreground text-xs">Source</span>
      <Select
        value={inspectorSource}
        onValueChange={(value) => {
          if (value === 'claude' || value === 'codex') setInspectorSource(value);
        }}
      >
        <SelectTrigger aria-label="Inspector source" size="sm" className="min-w-32">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {SOURCE_OPTIONS.map((source) => {
            const status = statusBySource.get(source);
            const state = status?.state ?? 'unknown';
            return (
              <SelectItem key={source} value={source}>
                <span>{SOURCE_LABELS[source]}</span>
                <span className="text-muted-foreground">{state}</span>
              </SelectItem>
            );
          })}
        </SelectContent>
      </Select>
      {selectedStatus?.state !== 'available' && selectedStatus?.reason ? (
        <span className="text-warning max-w-56 truncate text-xs" title={selectedStatus.reason}>
          {selectedStatus.reason}
        </span>
      ) : null}
      {inspectorSourcesError ? (
        <>
          <span className="text-destructive max-w-48 truncate text-xs" title={inspectorSourcesError}>
            {inspectorSourcesError}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="xs"
            aria-label="Retry loading inspector sources"
            title="Retry loading sources"
            disabled={inspectorSourcesLoading}
            onClick={() => void loadInspectorSources()}
          >
            Retry
          </Button>
        </>
      ) : null}
    </div>
  );
}
