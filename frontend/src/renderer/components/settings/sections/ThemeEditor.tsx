import { useEffect, useMemo, useRef, useState } from 'react';

import { Button } from '@renderer/components/ui/button';
import { useStore } from '@renderer/store';
import {
  ALL_THEME_TOKENS,
  applyTheme,
  isValidColor,
  readComputedToken,
  revertTheme,
  THEME_TOKEN_GROUPS,
} from '@renderer/utils/themeApplier';
import { createLogger } from '@shared/utils/logger';
import { Check, Download, Plus, Trash2, Upload } from 'lucide-react';

import { SettingsSectionHeader } from '../components';

import type { CustomTheme } from '@shared/types/notifications';

const logger = createLogger('Component:ThemeEditor');

function makeId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `theme_${crypto.randomUUID()}`;
  }
  return `theme_${Date.now().toString(36)}`;
}

function cloneTheme(name: string, basedOn: 'dark' | 'light', existing?: CustomTheme): CustomTheme {
  if (existing) {
    return {
      id: makeId(),
      name,
      basedOn,
      overrides: { ...existing.overrides },
    };
  }
  return { id: makeId(), name, basedOn, overrides: {} };
}

function readBaselineOverrides(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const token of ALL_THEME_TOKENS) {
    const value = readComputedToken(token);
    if (value) out[token] = value;
  }
  return out;
}

export const ThemeEditor = (): React.JSX.Element => {
  const appConfig = useStore((s) => s.appConfig);
  const saveCustomTheme = useStore((s) => s.saveCustomTheme);
  const deleteCustomTheme = useStore((s) => s.deleteCustomTheme);
  const setActiveTheme = useStore((s) => s.setActiveTheme);

  const themes = useMemo(() => appConfig?.themes?.custom ?? [], [appConfig?.themes?.custom]);
  const activeId = appConfig?.themes?.activeId ?? null;

  const [editingId, setEditingId] = useState<string | null>(null);
  const editingTheme = themes.find((t) => t.id === editingId) ?? null;
  const [draft, setDraft] = useState<CustomTheme | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setDraft(editingTheme ? { ...editingTheme, overrides: { ...editingTheme.overrides } } : null);
  }, [editingId, editingTheme]);

  useEffect(() => {
    if (!draft) return;
    applyTheme(draft.overrides);
    return () => {
      const active = themes.find((t) => t.id === activeId);
      if (active) {
        applyTheme(active.overrides);
      } else {
        revertTheme();
      }
    };
  }, [draft, themes, activeId]);

  const handleNew = (basedOn: 'dark' | 'light'): void => {
    const baseline = readBaselineOverrides();
    const theme: CustomTheme = {
      id: makeId(),
      name: `Custom ${basedOn}`,
      basedOn,
      overrides: baseline,
    };
    void saveCustomTheme(theme).then(() => setEditingId(theme.id));
  };

  const handleClone = (source: CustomTheme): void => {
    const next = cloneTheme(`${source.name} copy`, source.basedOn, source);
    void saveCustomTheme(next).then(() => setEditingId(next.id));
  };

  const handleSaveDraft = (): void => {
    if (!draft) return;
    void saveCustomTheme(draft);
  };

  const handleDelete = (id: string): void => {
    if (editingId === id) setEditingId(null);
    void deleteCustomTheme(id);
  };

  const handleApply = (id: string | null): void => {
    void setActiveTheme(id);
  };

  const handleExport = (theme: CustomTheme): void => {
    const json = JSON.stringify(theme, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${theme.name.replace(/\s+/g, '-').toLowerCase()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const input = e.target;
    const file = input.files?.[0];
    if (!file) return;
    void file.text().then((text) => {
      try {
        const parsed = JSON.parse(text) as CustomTheme;
        if (
          !parsed.name ||
          !parsed.overrides ||
          (parsed.basedOn !== 'dark' && parsed.basedOn !== 'light')
        ) {
          throw new Error('invalid shape');
        }
        const next: CustomTheme = { ...parsed, id: makeId() };
        void saveCustomTheme(next);
      } catch (err) {
        logger.error('Failed to import theme', err);
      }
    });
    input.value = '';
  };

  const updateDraftToken = (token: string, value: string): void => {
    setDraft((prev) =>
      prev ? { ...prev, overrides: { ...prev.overrides, [token]: value } } : prev
    );
  };

  const updateDraftName = (name: string): void => {
    setDraft((prev) => (prev ? { ...prev, name } : prev));
  };

  return (
    <div>
      <SettingsSectionHeader title="Theme Editor" />
      <p className="text-muted-foreground mb-4 text-sm">
        Customize CSS variables to create your own theme. Active theme persists across restarts.
      </p>

      <div className="mb-4 flex items-center gap-2">
        <Button size="sm" variant="outline" onClick={() => handleNew('dark')}>
          <Plus className="size-3" /> New (dark)
        </Button>
        <Button size="sm" variant="outline" onClick={() => handleNew('light')}>
          <Plus className="size-3" /> New (light)
        </Button>
        <Button size="sm" variant="ghost" onClick={() => fileRef.current?.click()}>
          <Upload className="size-3" /> Import
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json"
          className="hidden"
          onChange={handleImport}
        />
        <Button size="sm" variant="ghost" disabled={!activeId} onClick={() => handleApply(null)}>
          Use built-in
        </Button>
      </div>

      <div className="border-border divide-border-subtle bg-background/50 mb-4 divide-y rounded-xs border">
        {themes.length === 0 && (
          <div className="text-text-muted px-3 py-4 text-center text-xs">
            No custom themes. Create one to get started.
          </div>
        )}
        {themes.map((theme) => {
          const isActive = activeId === theme.id;
          const isEditing = editingId === theme.id;
          return (
            <div key={theme.id} className="flex items-center justify-between px-3 py-2 text-xs">
              <div className="flex items-center gap-2">
                {isActive && <Check className="size-3 text-emerald-400" />}
                <span className="text-foreground">{theme.name}</span>
                <span className="text-text-muted text-[9px] uppercase">{theme.basedOn}</span>
              </div>
              <div className="flex items-center gap-1">
                <Button
                  size="xs"
                  variant={isEditing ? 'secondary' : 'ghost'}
                  onClick={() => setEditingId(isEditing ? null : theme.id)}
                >
                  {isEditing ? 'Done' : 'Edit'}
                </Button>
                <Button size="xs" variant="ghost" onClick={() => handleClone(theme)}>
                  Clone
                </Button>
                <Button size="xs" variant="ghost" onClick={() => handleExport(theme)}>
                  <Download className="size-2.5" />
                </Button>
                <Button
                  size="xs"
                  variant={isActive ? 'secondary' : 'outline'}
                  onClick={() => handleApply(isActive ? null : theme.id)}
                >
                  {isActive ? 'Active' : 'Apply'}
                </Button>
                <Button size="xs" variant="ghost" onClick={() => handleDelete(theme.id)}>
                  <Trash2 className="size-2.5 text-rose-400" />
                </Button>
              </div>
            </div>
          );
        })}
      </div>

      {draft && (
        <div className="border-border bg-background/50 mb-4 rounded-xs border p-3">
          <div className="mb-3 flex items-center justify-between">
            <input
              value={draft.name}
              onChange={(e) => updateDraftName(e.target.value)}
              className="border-border bg-background text-foreground rounded-sm border px-2 py-1 text-xs"
            />
            <div className="flex items-center gap-2">
              <Button size="sm" variant="default" onClick={handleSaveDraft}>
                Save
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>
                Close
              </Button>
            </div>
          </div>

          {THEME_TOKEN_GROUPS.map((group) => (
            <div key={group.label} className="mb-3">
              <div className="text-text-muted mb-1.5 text-[10px] font-medium tracking-widest uppercase">
                {group.label}
              </div>
              <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                {group.tokens.map(({ name, description }) => {
                  const value = draft.overrides[name] ?? '';
                  const valid = value.length === 0 || isValidColor(value);
                  return (
                    <label key={name} className="flex items-center gap-2 text-[11px]">
                      <span
                        className="border-border size-4 shrink-0 rounded-sm border"
                        style={{ backgroundColor: valid && value ? value : 'transparent' }}
                      />
                      <span className="text-foreground w-32 shrink-0 font-mono" title={description}>
                        --{name}
                      </span>
                      <input
                        value={value}
                        onChange={(e) => updateDraftToken(name, e.target.value)}
                        placeholder={readComputedToken(name)}
                        className={`border-border bg-background text-foreground flex-1 rounded-sm border px-1.5 py-0.5 font-mono text-[10px] ${valid ? '' : 'border-rose-500/60'}`}
                      />
                    </label>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
