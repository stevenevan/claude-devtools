import { JSX, useEffect, useMemo, useState } from 'react';
import { Button } from '@renderer/components/ui/button';
import { Input } from '@renderer/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@renderer/components/ui/native-select';
import { Loader2, RefreshCw } from 'lucide-react';

import { SettingsSectionHeader } from './components';
import { CodexSettingsReviewDialog } from './CodexSettingsReviewDialog';
import { useCodexSettings } from './hooks/useCodexSettings';

import type {
  CodexResolvedSetting,
  CodexSettingsConflict,
  CodexSettingsPatch,
  CodexSettingsPreview,
  CodexSettingsSource,
  CodexSettingsView,
} from '@shared/types/api';

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

interface CodexSettingsDraft {
  model: string;
  approvalPolicy: string;
  sandboxMode: string;
}

interface CodexReviewState {
  patch: CodexSettingsPatch;
  preview: CodexSettingsPreview;
}

const EMPTY_DRAFT: CodexSettingsDraft = {
  model: '',
  approvalPolicy: '',
  sandboxMode: '',
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

function settingMap(view: CodexSettingsView): Map<string, CodexResolvedSetting> {
  return new Map(view.settings.map((setting) => [setting.key, setting]));
}

function draftFromView(view: CodexSettingsView): CodexSettingsDraft {
  const settings = settingMap(view);
  const valueFor = (key: string): string => {
    const setting = settings.get(key);
    if (!setting?.editable) return '';
    return setting.userValue?.scalar ?? setting.value.scalar ?? '';
  };
  return {
    model: valueFor('model'),
    approvalPolicy: valueFor('approval_policy'),
    sandboxMode: valueFor('sandbox_mode'),
  };
}

function buildPatch(
  draft: CodexSettingsDraft,
  settings: Map<string, CodexResolvedSetting>
): CodexSettingsPatch {
  const patch: CodexSettingsPatch = {};
  const addIfChanged = (key: string, value: string, assign: (value: string) => void): void => {
    const trimmed = value.trim();
    if (trimmed && trimmed !== settings.get(key)?.value.scalar) assign(trimmed);
  };
  addIfChanged('model', draft.model, (value) => { patch.model = value; });
  addIfChanged('approval_policy', draft.approvalPolicy, (value) => { patch.approvalPolicy = value; });
  addIfChanged('sandbox_mode', draft.sandboxMode, (value) => { patch.sandboxMode = value; });
  return patch;
}

function fieldEditable(
  view: CodexSettingsView,
  settings: Map<string, CodexResolvedSetting>,
  key: string
): boolean {
  if (!view.canEdit) return false;
  const setting = settings.get(key);
  if (setting && !setting.editable) return false;
  if (
    (key === 'approval_policy' || key === 'sandbox_mode') &&
    (settings.has('default_permissions') ||
      view.policy.constraints.some((item) => item.key === 'default_permissions'))
  ) {
    return false;
  }
  return true;
}

function fieldReason(
  view: CodexSettingsView,
  settings: Map<string, CodexResolvedSetting>,
  key: string
): string | null {
  const setting = settings.get(key);
  if (setting && !setting.editable) return setting.readOnlyReason;
  if (
    (key === 'approval_policy' || key === 'sandbox_mode') &&
    (settings.has('default_permissions') ||
      view.policy.constraints.some((item) => item.key === 'default_permissions'))
  ) {
    return 'default_permissions is present; this safety field is read-only in this sprint';
  }
  const constraint = view.policy.constraints.find((item) => item.key === key);
  if (constraint?.value.scalar) {
    return `Managed requirement fixes this value to ${constraint.value.scalar}`;
  }
  return null;
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
    writeError,
    writeBusy,
    projectRoot,
    profile,
    context,
    setProfile,
    refresh,
    openConfigFolder,
    previewPatch,
    applyPatch,
    clearWriteError,
  } = useCodexSettings();
  const [showSources, setShowSources] = useState(nerd);
  const [profileDraft, setProfileDraft] = useState(profile ?? '');
  const [draft, setDraft] = useState<CodexSettingsDraft>(EMPTY_DRAFT);
  const [draftRevision, setDraftRevision] = useState<string | null>(null);
  const [review, setReview] = useState<CodexReviewState | null>(null);
  const [conflict, setConflict] = useState<CodexSettingsConflict | null>(null);
  const [editorError, setEditorError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const settings = useMemo(
    () => new Map((view?.settings ?? []).map((setting) => [setting.key, setting])),
    [view?.settings]
  );

  useEffect(() => {
    if (!view) {
      setDraft(EMPTY_DRAFT);
      setDraftRevision(null);
      return;
    }
    if (review || draftRevision === view.userRevision) return;
    setDraft(draftFromView(view));
    setDraftRevision(view.userRevision);
  }, [draftRevision, review, view]);

  const applyProfile = (): void => {
    const next = profileDraft.trim();
    setProfile(next || null);
  };

  const updateDraft = (field: keyof CodexSettingsDraft, value: string): void => {
    setDraft((current) => ({ ...current, [field]: value }));
    setEditorError(null);
    setSuccessMessage(null);
    setConflict(null);
    clearWriteError();
  };

  const resetDraft = (): void => {
    if (!view) return;
    setDraft(draftFromView(view));
    setDraftRevision(view.userRevision);
    setEditorError(null);
    setSuccessMessage(null);
    setConflict(null);
    clearWriteError();
  };

  const handleReview = async (): Promise<void> => {
    if (!view || !context) return;
    const patch = buildPatch(draft, settings);
    if (Object.keys(patch).length === 0) {
      setEditorError('Change at least one safe user value before reviewing.');
      return;
    }
    setEditorError(null);
    setSuccessMessage(null);
    setConflict(null);
    clearWriteError();
    try {
      const result = await previewPatch(patch, view.userRevision);
      if (result.status === 'conflict') {
        setConflict(result.data);
        await refresh();
        return;
      }
      setReview({ patch, preview: result.data });
    } catch {
      // The hook stores the renderer-safe error for the editor and dialog.
    }
  };

  const handleApply = async (): Promise<void> => {
    if (!review) return;
    try {
      const result = await applyPatch(review.patch, review.preview.expectedRevision);
      if (result.status === 'conflict') {
        setReview(null);
        setConflict(result.data);
        await refresh();
        return;
      }
      setReview(null);
      setSuccessMessage(
        result.data.verification.verified
          ? 'Codex settings applied and verified.'
          : 'Codex settings applied.'
      );
      await refresh();
    } catch {
      // The hook stores the renderer-safe error while the review remains open.
    }
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

          <CodexSettingsEditor
            view={view}
            settings={settings}
            draft={draft}
            disabled={loading || writeBusy}
            error={editorError ?? writeError}
            successMessage={successMessage}
            onDraftChange={updateDraft}
            onReview={() => void handleReview()}
            onReset={resetDraft}
          />

          {conflict && (
            <div className="border-amber-500/40 bg-amber-500/10 text-amber-500 mt-3 flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 text-xs" role="alert">
              <span>{conflict.message} The editor was refreshed; review the current values again.</span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  setConflict(null);
                  void refresh();
                }}
              >
                Refresh
              </Button>
            </div>
          )}

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

          {review && (
            <CodexSettingsReviewDialog
              open
              preview={review.preview}
              busy={writeBusy}
              error={writeError}
              onOpenChange={(open) => {
                if (!open) setReview(null);
              }}
              onApply={handleApply}
            />
          )}
        </>
      )}
    </section>
  );
};

function CodexSettingsEditor({
  view,
  settings,
  draft,
  disabled,
  error,
  successMessage,
  onDraftChange,
  onReview,
  onReset,
}: Readonly<{
  view: CodexSettingsView;
  settings: Map<string, CodexResolvedSetting>;
  draft: CodexSettingsDraft;
  disabled: boolean;
  error: string | null;
  successMessage: string | null;
  onDraftChange: (field: keyof CodexSettingsDraft, value: string) => void;
  onReview: () => void;
  onReset: () => void;
}>): JSX.Element {
  const modelEditable = fieldEditable(view, settings, 'model');
  const approvalEditable = fieldEditable(view, settings, 'approval_policy');
  const sandboxEditable = fieldEditable(view, settings, 'sandbox_mode');
  const reasonFor = (key: string): string | null =>
    fieldReason(view, settings, key) ?? (!view.canEdit ? 'Safe user editing is unavailable' : null);

  return (
    <div className="border-border/50 bg-card/30 mt-4 rounded-md border p-3 text-xs">
      <div className="font-medium">Safe user defaults</div>
      <p className="text-muted-foreground mt-1">
        Draft changes locally, then review the exact fields before writing to the user config. Unknown TOML stays untouched.
      </p>

      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <div className="space-y-1">
          <label htmlFor="codex-settings-model" className="font-medium">Model</label>
          <Input
            id="codex-settings-model"
            value={draft.model}
            disabled={disabled || !modelEditable}
            onChange={(event) => onDraftChange('model', event.target.value)}
            placeholder="Keep current"
            aria-describedby="codex-settings-model-help"
          />
          <p id="codex-settings-model-help" className="text-muted-foreground min-h-8 text-[0.7rem]">
            {reasonFor('model') ?? 'Safe model identifier only; paths and secrets are rejected.'}
          </p>
        </div>

        <div className="space-y-1">
          <label htmlFor="codex-settings-approval" className="font-medium">Approval mode</label>
          <NativeSelect
            id="codex-settings-approval"
            className="w-full"
            value={draft.approvalPolicy}
            disabled={disabled || !approvalEditable}
            onChange={(event) => onDraftChange('approvalPolicy', event.target.value)}
            aria-describedby="codex-settings-approval-help"
          >
            <NativeSelectOption value="">Keep current</NativeSelectOption>
            <NativeSelectOption value="untrusted">Untrusted</NativeSelectOption>
            <NativeSelectOption value="on-request">On request</NativeSelectOption>
            <NativeSelectOption value="never">Never</NativeSelectOption>
          </NativeSelect>
          <p id="codex-settings-approval-help" className="text-muted-foreground min-h-8 text-[0.7rem]">
            {reasonFor('approval_policy') ?? 'Granular approval rules are read-only.'}
          </p>
        </div>

        <div className="space-y-1">
          <label htmlFor="codex-settings-sandbox" className="font-medium">Sandbox</label>
          <NativeSelect
            id="codex-settings-sandbox"
            className="w-full"
            value={draft.sandboxMode}
            disabled={disabled || !sandboxEditable}
            onChange={(event) => onDraftChange('sandboxMode', event.target.value)}
            aria-describedby="codex-settings-sandbox-help"
          >
            <NativeSelectOption value="">Keep current</NativeSelectOption>
            <NativeSelectOption value="read-only">Read-only</NativeSelectOption>
            <NativeSelectOption value="workspace-write">Workspace write</NativeSelectOption>
          </NativeSelect>
          <p id="codex-settings-sandbox-help" className="text-muted-foreground min-h-8 text-[0.7rem]">
            {reasonFor('sandbox_mode') ?? 'Danger-full-access is intentionally excluded.'}
          </p>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" disabled={disabled || !view.canEdit} onClick={onReview}>
          {disabled && <Loader2 className="size-3 animate-spin" />}
          {disabled ? 'Reviewing…' : 'Review changes'}
        </Button>
        <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={onReset}>
          Reset draft
        </Button>
      </div>

      {error && <p className="text-destructive mt-2" role="alert">{error}</p>}
      {successMessage && <p className="mt-2 text-emerald-500" role="status">{successMessage}</p>}
    </div>
  );
}

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
