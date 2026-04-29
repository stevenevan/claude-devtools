import { useState } from 'react';

import { Button } from '@renderer/components/ui/button';
import { useStore } from '@renderer/store';
import {
  parseFilterPayload,
  parseFilterPresetEntry,
} from '@renderer/utils/filterPresetSerialization';
import { Save } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';

import { PresetChip } from './PresetChip';

import type { FilterPresetEntry } from '@shared/types/notifications';

export const FilterPresetBar = (): React.JSX.Element | null => {
  const {
    activeFilters,
    applyFilterPreset,
    addFilterPreset,
    removeFilterPreset,
    renameFilterPreset,
    setDefaultFilterPreset,
    rawPresets,
    defaultPresetId,
  } = useStore(
    useShallow((s) => ({
      activeFilters: s.activeFilters,
      applyFilterPreset: s.applyFilterPreset,
      addFilterPreset: s.addFilterPreset,
      removeFilterPreset: s.removeFilterPreset,
      renameFilterPreset: s.renameFilterPreset,
      setDefaultFilterPreset: s.setDefaultFilterPreset,
      rawPresets: s.appConfig?.sessions?.filterPresets ?? [],
      defaultPresetId: s.appConfig?.sessions?.defaultFilterPresetId ?? null,
    }))
  );

  const [savingName, setSavingName] = useState<string | null>(null);
  const [draft, setDraft] = useState('');

  const presets: FilterPresetEntry[] = rawPresets
    .map((raw) => parseFilterPresetEntry(raw))
    .filter((p): p is FilterPresetEntry => p !== null);

  const hasActiveFilter = Object.keys(activeFilters).length > 0;

  const handleApply = (preset: FilterPresetEntry): void => {
    const filter = parseFilterPayload(preset.filter);
    if (filter === null) return;
    applyFilterPreset(filter);
  };

  const startSave = (): void => {
    if (!hasActiveFilter) return;
    setSavingName('');
    setDraft('');
  };

  const commitSave = async (): Promise<void> => {
    const trimmed = draft.trim();
    if (!trimmed) {
      setSavingName(null);
      return;
    }
    await addFilterPreset(trimmed, { ...activeFilters });
    setSavingName(null);
    setDraft('');
  };

  return (
    <div className="border-border/60 flex flex-wrap items-center gap-1 border-b px-2 py-1.5">
      {presets.map((preset, index) => (
        <PresetChip
          key={preset.id}
          preset={preset}
          index={index}
          isDefault={defaultPresetId === preset.id}
          onApply={() => handleApply(preset)}
          onRename={(next) => void renameFilterPreset(preset.id, next)}
          onDelete={() => void removeFilterPreset(preset.id)}
          onSetDefault={() =>
            void setDefaultFilterPreset(defaultPresetId === preset.id ? null : preset.id)
          }
        />
      ))}

      {savingName !== null ? (
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void commitSave();
            else if (e.key === 'Escape') {
              setSavingName(null);
              setDraft('');
            }
          }}
          onBlur={() => void commitSave()}
          placeholder="Preset name"
          className="border-border bg-background text-foreground w-28 rounded-full border px-2 py-0.5 text-[10px] outline-none"
        />
      ) : (
        <Button
          variant="ghost"
          size="sm"
          onClick={startSave}
          disabled={!hasActiveFilter}
          className="h-auto gap-1 rounded-full px-2 py-0.5 text-[10px]"
          title={hasActiveFilter ? 'Save current filter' : 'Configure filter to save'}
        >
          <Save className="size-3" />
          Save current
        </Button>
      )}
    </div>
  );
};
