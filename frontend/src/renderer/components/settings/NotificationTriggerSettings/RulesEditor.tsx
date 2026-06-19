import { useEffect, useMemo, useState } from 'react';

import { api } from '@renderer/api';
import { Button } from '@renderer/components/ui/button';
import { useStore } from '@renderer/store';

import type { NotificationRule } from '@shared/types/notifications';

const SAMPLE_RULE: NotificationRule = {
  id: 'sample',
  name: 'Long Bash + TODO',
  enabled: true,
  condition: {
    kind: 'all',
    children: [
      { kind: 'predicate', predicate: { kind: 'regexMatch', pattern: 'TODO' } },
      { kind: 'predicate', predicate: { kind: 'durationGt', ms: 5000 } },
    ],
  },
  action: { kind: 'notify' },
};

export const RulesEditor = (): React.JSX.Element => {
  const rules = useStore((s) => s.appConfig?.notificationRules ?? []);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDraft(JSON.stringify(rules.length > 0 ? rules : [SAMPLE_RULE], null, 2));
  }, [rules]);

  const ruleCount = useMemo(() => rules.length, [rules]);

  const handleSave = async (): Promise<void> => {
    setSaving(true);
    setError(null);
    try {
      const parsed: unknown = JSON.parse(draft);
      if (!Array.isArray(parsed)) throw new Error('Rules must be a JSON array');
      await api.config.update('notificationRules', parsed as unknown as Record<string, unknown>);
      const fetchConfig = useStore.getState().fetchConfig;
      await fetchConfig();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div>
        <h3 className="text-text text-sm font-semibold">Notification rules</h3>
        <p className="text-text-muted mt-1 text-xs">
          {ruleCount === 0
            ? 'No rules yet. Edit the sample below and save to enable.'
            : `${ruleCount} rule${ruleCount === 1 ? '' : 's'} active.`}
        </p>
        <p className="text-text-muted mt-1 text-[11px]">
          DSL: condition tree of <code>all</code>/<code>any</code> nodes wrapping{' '}
          <code>toolName</code>, <code>durationGt</code>, <code>error</code>, <code>costGt</code>,{' '}
          <code>regexMatch</code> predicates. Actions: <code>notify</code>, <code>badge</code>,{' '}
          <code>webhook</code> (HTTP dispatch lands in sprint 41).
        </p>
      </div>

      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        spellCheck={false}
        className="border-border bg-surface text-text h-72 rounded-md border p-3 font-mono text-[11px]"
      />

      {error && (
        <div className="border-destructive/40 bg-destructive/10 text-destructive rounded-md border px-3 py-2 text-xs">
          {error}
        </div>
      )}

      <div className="flex gap-2">
        <Button variant="secondary" size="sm" onClick={() => void handleSave()} disabled={saving}>
          {saving ? 'Saving…' : 'Save rules'}
        </Button>
      </div>
    </div>
  );
};
