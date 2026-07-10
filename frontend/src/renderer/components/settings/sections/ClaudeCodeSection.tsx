import { JSX, useEffect, useState } from 'react';
import { Button } from '@renderer/components/ui/button';
import { useStore } from '@renderer/store';
import { CheckCircle, Loader2, Plus, Trash2 } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';

import { SettingsSectionHeader } from '../components';

import { EnvFlagsPanel } from './claudeCode/EnvFlagsPanel';
import { HooksPanel } from './claudeCode/HooksPanel';

import type { GlobalSettingsPatch } from '@shared/types/api';

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function toEnvRecord(value: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, v] of Object.entries(toRecord(value))) {
    if (typeof v === 'string') out[key] = v;
  }
  return out;
}

function toStringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

const inputClass = 'border-border bg-surface text-text rounded-sm border px-2 py-1 text-xs';

interface PermissionListEditorProps {
  readonly label: string;
  readonly items: string[];
  readonly onChange: (items: string[]) => void;
  readonly disabled: boolean;
}

const PermissionListEditor = ({
  label,
  items,
  onChange,
  disabled,
}: PermissionListEditorProps): JSX.Element => {
  const [draft, setDraft] = useState('');

  const handleAdd = (): void => {
    const value = draft.trim();
    if (!value) return;
    onChange([...items, value]);
    setDraft('');
  };

  return (
    <div>
      <div className="text-text mb-1.5 text-xs font-medium">{label}</div>
      <div className="border-border bg-surface-raised divide-border-subtle divide-y rounded-md border">
        {items.length === 0 && <div className="text-text-muted px-3 py-2 text-xs">No rules</div>}
        {items.map((item, idx) => (
          <div key={`${item}-${idx}`} className="flex items-center gap-2 px-3 py-1.5">
            <code className="text-text flex-1 truncate font-mono text-xs">{item}</code>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              disabled={disabled}
              onClick={() => onChange(items.filter((_, i) => i !== idx))}
              aria-label={`Remove ${item}`}
            >
              <Trash2 className="text-text-muted size-3" />
            </Button>
          </div>
        ))}
      </div>
      <div className="mt-2 flex gap-2">
        <input
          type="text"
          value={draft}
          disabled={disabled}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              handleAdd();
            }
          }}
          placeholder="Bash(rm:*)"
          className={`${inputClass} flex-1 font-mono`}
        />
        <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={handleAdd}>
          <Plus className="size-3" />
          Add
        </Button>
      </div>
    </div>
  );
};

export const ClaudeCodeSection = (): JSX.Element | null => {
  const {
    globalSettings,
    globalSettingsLoading,
    globalSettingsError,
    fetchGlobalSettings,
    saveGlobalSettings,
  } = useStore(
    useShallow((s) => ({
      globalSettings: s.globalSettings,
      globalSettingsLoading: s.globalSettingsLoading,
      globalSettingsError: s.globalSettingsError,
      fetchGlobalSettings: s.fetchGlobalSettings,
      saveGlobalSettings: s.saveGlobalSettings,
    }))
  );

  useEffect(() => {
    if (globalSettings === null && !globalSettingsLoading) {
      void fetchGlobalSettings();
    }
  }, [globalSettings, globalSettingsLoading, fetchGlobalSettings]);

  const [env, setEnv] = useState<Record<string, string>>({});
  const [allow, setAllow] = useState<string[]>([]);
  const [deny, setDeny] = useState<string[]>([]);
  const [ask, setAsk] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  useEffect(() => {
    if (!globalSettings) return;
    setEnv(toEnvRecord(globalSettings.env));
    const permissions = toRecord(globalSettings.permissions);
    setAllow(toStringList(permissions.allow));
    setDeny(toStringList(permissions.deny));
    setAsk(toStringList(permissions.ask));
  }, [globalSettings]);

  if (globalSettingsLoading && !globalSettings) {
    return (
      <div className="text-text-muted flex items-center gap-2 py-6 text-sm">
        <Loader2 className="size-4 animate-spin" />
        Loading settings...
      </div>
    );
  }

  if (globalSettingsError && !globalSettings) {
    return (
      <div className="border-destructive/40 bg-destructive/10 text-destructive rounded-md border px-3 py-2 text-xs">
        {globalSettingsError}
      </div>
    );
  }

  if (!globalSettings) {
    return null;
  }

  const handleSave = async (): Promise<void> => {
    setSaveError(null);
    setSaveSuccess(false);
    setSaving(true);
    const patch: GlobalSettingsPatch = {
      env,
      allow,
      deny,
      ask,
    };
    try {
      await saveGlobalSettings(patch);
      setSaveSuccess(true);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <p className="text-text-muted text-xs">
        Edits <code>~/.claude/settings.json</code>. Unrecognized keys are preserved untouched.
      </p>

      <SettingsSectionHeader title="Environment Variables" />
      <EnvFlagsPanel env={env} onChange={setEnv} disabled={saving} />

      <SettingsSectionHeader title="Permissions" />
      <div className="flex flex-col gap-4">
        <PermissionListEditor label="Allow" items={allow} onChange={setAllow} disabled={saving} />
        <PermissionListEditor label="Deny" items={deny} onChange={setDeny} disabled={saving} />
        <PermissionListEditor label="Ask" items={ask} onChange={setAsk} disabled={saving} />
      </div>

      <SettingsSectionHeader title="Hooks" />
      <HooksPanel />

      <div className="mt-6 flex items-center gap-3">
        <Button
          type="button"
          variant="default"
          size="sm"
          disabled={saving}
          onClick={() => void handleSave()}
        >
          {saving ? (
            <>
              <Loader2 className="size-3 animate-spin" />
              Saving...
            </>
          ) : (
            'Save'
          )}
        </Button>
        {saveSuccess && (
          <span className="inline-flex items-center gap-1 text-xs text-emerald-400">
            <CheckCircle className="size-3" />
            Saved
          </span>
        )}
        {saveError && <span className="text-destructive text-xs">{saveError}</span>}
      </div>
    </div>
  );
};
