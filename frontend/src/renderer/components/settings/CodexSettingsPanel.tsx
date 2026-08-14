import { JSX, useMemo, useState } from 'react';
import { Button } from '@renderer/components/ui/button';
import { Input } from '@renderer/components/ui/input';
import { Loader2, RefreshCw } from 'lucide-react';

import { SettingsSectionHeader } from './components';
import { useCodexSettings } from './hooks/useCodexSettings';

import type { CodexResolvedSetting, CodexSettingsSource } from '@shared/types/api';

interface CodexSettingsPanelProps {
  readonly nerd?: boolean;
}

const SIMPLE_KEYS = ['model', 'approval_policy', 'sandbox_mode'] as const;

const LABELS: Record<string, string> = {
  model: 'Model',
  approval_policy: 'Approval mode',
  sandbox_mode: 'Sandbox',
  default_permissions: 'Default permissions',
};

function settingLabel(key: string): string {
  return LABELS[key] ?? key;
}

function settingDisplay(setting: CodexResolvedSetting | undefined): string {
  return setting?.value.display || 'Not set';
}

function sourceSummary(setting: CodexResolvedSetting | undefined): string {
  return setting ? `Source: ${setting.sourceLabel}` : 'No source defines this setting';
}

function SourceRow({ source }: Readonly<{ source: CodexSettingsSource }>): JSX.Element {
  return (
    <tr className="border-border/40 border-t align-top">
      <td className="px-2 py-2 font-medium">{source.label}</td>
      <td className="px-2 py-2">{source.status}</td>
      <td className="px-2 py-2">{source.supportedKeys.join(', ') || '—'}</td>
      <td className="px-2 py-2">{source.active ? 'Active' : 'Inactive'}</td>
    </tr>
  );
}

export const CodexSettingsPanel = ({ nerd = false }: CodexSettingsPanelProps): JSX.Element => {
  const {
    view,
    loading,
    error,
    projectRoot,
    profile,
    setProfile,
    refresh,
    openConfigFolder,
  } = useCodexSettings();
  const [showSources, setShowSources] = useState(nerd);
  const [profileDraft, setProfileDraft] = useState(profile ?? '');

  const settings = useMemo(
    () => new Map((view?.settings ?? []).map((setting) => [setting.key, setting])),
    [view?.settings]
  );

  const applyProfile = (): void => {
    const next = profileDraft.trim();
    setProfile(next || null);
  };

  return (
    <section id="settings-codex-settings" tabIndex={-1} className="mt-8 focus-visible:outline-none">
      <SettingsSectionHeader title="Codex settings" anchorId="settings-codex-settings-heading" />
      <p className="border-border/50 bg-card/50 text-muted-foreground rounded-md border px-3 py-2 text-xs">
        Local-only inspection of Codex TOML settings. CLI overrides and cloud-managed policy are
        not visible here.
      </p>

      {!projectRoot && !loading && (
        <p className="text-muted-foreground mt-3 text-xs">
          Select a project before inspecting its trusted Codex settings.
        </p>
      )}

      {loading && (
        <div className="text-muted-foreground mt-3 flex items-center gap-2 text-xs" role="status">
          <Loader2 className="size-3 animate-spin" />
          Loading Codex settings…
        </div>
      )}

      {error && (
        <div className="border-destructive/40 bg-destructive/10 text-destructive mt-3 rounded-md border px-3 py-2 text-xs" role="alert">
          {error}
        </div>
      )}

      {view && (
        <>
          <div className="mt-3 grid gap-1 text-xs sm:grid-cols-2">
            <div className="text-muted-foreground">Profile</div>
            <div>{profile ?? 'None selected'}</div>
            <div className="text-muted-foreground">Trust</div>
            <div>{view.trust.state}</div>
            <div className="text-muted-foreground">Inspection directory</div>
            <div className="truncate" title={view.context.workingDirectory}>
              {view.context.workingDirectory}
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => setShowSources((value) => !value)}>
              {showSources ? 'Hide sources' : 'View sources'}
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => void openConfigFolder()}>
              Open config folder
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => void refresh()} disabled={loading}>
              <RefreshCw className="size-3" />
              Refresh
            </Button>
          </div>

          <div className="mt-3 grid gap-1 sm:grid-cols-[auto_1fr_auto] sm:items-center">
            <label htmlFor="codex-settings-profile" className="text-muted-foreground text-xs">
              Inspect profile
            </label>
            <Input
              id="codex-settings-profile"
              value={profileDraft}
              onChange={(event) => setProfileDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') applyProfile();
              }}
              placeholder="optional profile name"
              aria-describedby="codex-settings-profile-help"
            />
            <Button type="button" variant="outline" size="sm" onClick={applyProfile}>
              Inspect
            </Button>
            <span id="codex-settings-profile-help" className="text-muted-foreground text-[0.7rem] sm:col-span-3">
              This is an inspection projection, not the profile of a running Codex process.
            </span>
          </div>

          {!nerd ? (
            <div className="mt-3">
              {SIMPLE_KEYS.map((key) => {
                const setting = settings.get(key);
                return (
                  <div key={key} className="border-border/50 flex items-center justify-between border-b py-2 text-xs">
                    <div>
                      <div className="font-medium">{settingLabel(key)}</div>
                      <div className="text-muted-foreground">{sourceSummary(setting)}</div>
                    </div>
                    <div className="max-w-[52%] truncate text-right" title={settingDisplay(setting)}>
                      {settingDisplay(setting)}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <NerdDetails view={view} settings={settings} showSources={showSources} />
          )}
        </>
      )}
    </section>
  );
};

function NerdDetails({
  view,
  settings,
  showSources,
}: Readonly<{
  view: NonNullable<ReturnType<typeof useCodexSettings>['view']>;
  settings: Map<string, CodexResolvedSetting>;
  showSources: boolean;
}>): JSX.Element {
  return (
    <div className="mt-4 space-y-4 text-xs">
      <table className="w-full table-fixed" aria-label="Codex effective settings">
        <thead className="text-muted-foreground text-left">
          <tr>
            <th className="px-2 py-1 font-medium">Setting</th>
            <th className="px-2 py-1 font-medium">Value</th>
            <th className="px-2 py-1 font-medium">Source</th>
            <th className="px-2 py-1 font-medium">State</th>
          </tr>
        </thead>
        <tbody>
          {Object.keys(LABELS).map((key) => {
            const setting = settings.get(key);
            return (
              <tr key={key} className="border-border/40 border-t align-top">
                <th scope="row" className="px-2 py-2 text-left font-medium">{settingLabel(key)}</th>
                <td className="px-2 py-2">{settingDisplay(setting)}</td>
                <td className="px-2 py-2">{setting?.sourceLabel ?? '—'}</td>
                <td className="px-2 py-2">
                  {setting?.editable ? 'Editable user value' : setting?.readOnlyReason ?? 'Not set'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {showSources && (
        <details open className="border-border/50 rounded-md border">
          <summary className="cursor-pointer px-3 py-2 font-medium">Configuration sources</summary>
          <div className="overflow-x-auto px-1 pb-1">
            <table className="w-full" aria-label="Codex configuration sources">
              <thead className="text-muted-foreground text-left">
                <tr>
                  <th className="px-2 py-1 font-medium">Source</th>
                  <th className="px-2 py-1 font-medium">Status</th>
                  <th className="px-2 py-1 font-medium">Keys</th>
                  <th className="px-2 py-1 font-medium">Activity</th>
                </tr>
              </thead>
              <tbody>{view.sources.map((source) => <SourceRow key={source.id} source={source} />)}</tbody>
            </table>
          </div>
        </details>
      )}

      {view.provenance.length > 0 && (
        <details className="border-border/50 rounded-md border">
          <summary className="cursor-pointer px-3 py-2 font-medium">Feature and profile provenance</summary>
          <ul className="text-muted-foreground space-y-1 px-3 pb-3">
            {view.provenance.map((row) => <li key={`${row.sourceId}-${row.key}`}>{row.key}: {row.sourceLabel}</li>)}
          </ul>
        </details>
      )}

      <div className="border-border/50 rounded-md border px-3 py-2">
        <div className="font-medium">Managed policy: {view.policy.resolution}</div>
        <div className="text-muted-foreground mt-1">
          Local requirements: {view.policy.localRequirementsAvailable ? 'available' : 'unavailable'}.
          Cloud/MDM requirements: unavailable.
        </div>
      </div>

      {(view.diagnostics.length > 0 || view.settings.some((setting) => setting.shadowed.length > 0)) && (
        <details className="border-border/50 rounded-md border">
          <summary className="cursor-pointer px-3 py-2 font-medium">Diagnostics and shadowed values</summary>
          <div className="space-y-2 px-3 pb-3" aria-live="polite">
            {view.diagnostics.map((diagnostic, index) => (
              <p key={`${diagnostic.sourceId}-${diagnostic.code}-${index}`} className="text-muted-foreground">
                {diagnostic.message}
              </p>
            ))}
            {view.settings.flatMap((setting) => setting.shadowed.map((shadow) => (
              <p key={`${setting.key}-${shadow.sourceId}`} className="text-muted-foreground">
                {settingLabel(setting.key)} also appears in {shadow.sourceLabel} and is shadowed.
              </p>
            )))}
          </div>
        </details>
      )}
    </div>
  );
}
