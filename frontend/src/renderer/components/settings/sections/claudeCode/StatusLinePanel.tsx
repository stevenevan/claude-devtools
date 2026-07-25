import { JSX, useEffect, useState } from 'react';
import { api, isDesktopMode } from '@renderer/api';
import { confirm } from '@renderer/components/common/ConfirmDialog';
import { Button } from '@renderer/components/ui/button';
import { Input } from '@renderer/components/ui/input';
import { Switch } from '@renderer/components/ui/switch';
import { useStore } from '@renderer/store';
import { formatBytes } from '@renderer/utils/formatters';
import { Loader2 } from 'lucide-react';

import type { StatusLineConfig, StatusLineScriptInfo } from '@shared/types/api';

const EMPTY: StatusLineConfig = { type: 'command', command: '' };

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function toOptionalNumber(raw: string): number | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : undefined;
}

export const StatusLinePanel = (): JSX.Element => {
  const connectionMode = useStore((s) => s.connectionMode);
  const canAct = isDesktopMode() && connectionMode === 'local';

  const [loaded, setLoaded] = useState<StatusLineConfig | null>(null);
  const [draft, setDraft] = useState<StatusLineConfig>(EMPTY);
  const [present, setPresent] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [script, setScript] = useState<StatusLineScriptInfo | null>(null);

  const refresh = async (): Promise<void> => {
    setLoading(true);
    setLoadError(null);
    try {
      const cfg = await api.readStatusLine();
      setLoaded(cfg);
      setPresent(cfg !== null);
      setDraft(cfg ?? EMPTY);
    } catch (error) {
      setLoadError(errText(error));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
    // Load once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!draft.command.trim()) {
      setScript(null);
      return;
    }
    let stale = false;
    void api
      .statStatusLineScript(draft.command)
      .then((info) => {
        if (!stale) setScript(info);
      })
      .catch(() => {
        if (!stale) setScript(null);
      });
    return () => {
      stale = true;
    };
  }, [draft.command]);

  const patch = (fields: Partial<StatusLineConfig>): void =>
    setDraft((prev) => ({ ...prev, ...fields }));

  const handleSave = async (): Promise<void> => {
    setSaveError(null);
    // Claude Code shell-executes this on every refresh, so a changed command is
    // armed the moment it lands in settings.json — same gate hooks get.
    if (draft.command !== loaded?.command) {
      const armed = await confirm({
        title: 'Save status line command?',
        message: `Claude Code runs this in a shell on every status-line refresh — it is not previewed or sandboxed:\n\n${draft.command}`,
        confirmLabel: 'Save command',
        variant: 'danger',
      });
      if (!armed) return;
    }

    setSaving(true);
    try {
      // Spread the loaded object so sub-keys this app does not model survive.
      await api.updateStatusLine({ ...(loaded ?? {}), ...draft });
      await refresh();
    } catch (error) {
      setSaveError(errText(error));
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = async (): Promise<void> => {
    setSaveError(null);
    const confirmed = await confirm({
      title: 'Remove status line?',
      message: 'Deletes the statusLine key from settings.json. Claude Code stops rendering a status line.',
      confirmLabel: 'Remove',
      variant: 'danger',
    });
    if (!confirmed) return;

    setSaving(true);
    try {
      await api.updateStatusLine(null);
      await refresh();
    } catch (error) {
      setSaveError(errText(error));
    } finally {
      setSaving(false);
    }
  };

  if (loading && !loaded && !loadError) {
    return (
      <div className="text-text-muted flex items-center gap-2 py-6 text-sm">
        <Loader2 className="size-4 animate-spin" />
        Loading status line...
      </div>
    );
  }

  // A malformed statusLine must not render an empty form that would be saved
  // back over the user's value.
  if (loadError) {
    return (
      <div className="border-destructive/40 bg-destructive/10 text-destructive rounded-md border px-3 py-2 text-xs">
        {loadError} — edit ~/.claude/settings.json directly to repair it.
      </div>
    );
  }

  return (
    <div>
      <p className="text-text-muted text-xs">
        The command Claude Code runs to render the status bar. It executes in a shell on every
        refresh; this panel never runs it.
      </p>

      {!canAct && (
        <p className="text-text-muted mt-2 text-xs">
          The status line can only be edited on this local machine.
        </p>
      )}

      <div className="mt-3 flex flex-col gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-text text-xs font-medium">Command</span>
          <Input
            value={draft.command}
            disabled={!canAct || saving}
            placeholder="~/.claude/statusline.sh"
            onChange={(e) => patch({ command: e.target.value })}
          />
        </label>

        <div className="flex flex-wrap gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-text text-xs font-medium">Padding</span>
            <Input
              type="number"
              min={0}
              className="w-28"
              value={draft.padding ?? ''}
              disabled={!canAct || saving}
              onChange={(e) => patch({ padding: toOptionalNumber(e.target.value) })}
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-text text-xs font-medium">Refresh interval (s)</span>
            <Input
              type="number"
              min={1}
              className="w-28"
              value={draft.refreshInterval ?? ''}
              disabled={!canAct || saving}
              onChange={(e) => patch({ refreshInterval: toOptionalNumber(e.target.value) })}
            />
          </label>
        </div>

        <label className="flex items-center gap-2">
          <Switch
            checked={draft.hideVimModeIndicator ?? false}
            disabled={!canAct || saving}
            onCheckedChange={(checked) => patch({ hideVimModeIndicator: checked })}
          />
          <span className="text-text text-xs">Hide the built-in vim mode indicator</span>
        </label>
      </div>

      <ScriptInfoRow info={script} disabled={!canAct} command={draft.command} />

      {saveError && <p className="text-destructive mt-2 text-xs">{saveError}</p>}

      <div className="mt-4 flex items-center gap-2">
        <Button
          variant="default"
          size="sm"
          disabled={!canAct || saving || !draft.command.trim()}
          onClick={() => void handleSave()}
        >
          {saving && <Loader2 className="size-3 animate-spin" />}
          Save status line
        </Button>
        {present && (
          <Button
            variant="outline"
            size="sm"
            disabled={!canAct || saving}
            onClick={() => void handleRemove()}
          >
            Remove status line
          </Button>
        )}
      </div>
    </div>
  );
};

interface ScriptInfoRowProps {
  info: StatusLineScriptInfo | null;
  command: string;
  disabled: boolean;
}

const ScriptInfoRow = ({ info, command, disabled }: Readonly<ScriptInfoRowProps>): JSX.Element => {
  if (!info) return <></>;

  if (info.resolvedPath === null) {
    return (
      <p className="text-text-muted mt-3 text-xs">
        Inline shell command — no script file to inspect.
      </p>
    );
  }

  return (
    <div className="border-border bg-surface-raised mt-3 rounded-md border px-3 py-2">
      <p className="text-text-muted font-mono text-xs break-all">{info.resolvedPath}</p>
      <p className="text-text-muted mt-1 text-xs">
        {info.exists
          ? `${formatBytes(info.sizeBytes)} · ${info.isText ? 'text' : 'binary'} · ${
              info.underClaudeRoot ? 'under ~/.claude' : 'outside ~/.claude'
            }`
          : 'Not found on disk'}
      </p>
      {info.exists && (
        <Button
          variant="outline"
          size="sm"
          className="mt-2"
          disabled={disabled}
          onClick={() => void api.revealStatusLineScript(command)}
        >
          Reveal in Finder
        </Button>
      )}
    </div>
  );
};
