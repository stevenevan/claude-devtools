import { useEffect, useState } from 'react';

import { api, isDesktopMode } from '@renderer/api';
import { Button } from '@renderer/components/ui/button';
import { useStore } from '@renderer/store';
import { Plug, Send, Trash2 } from 'lucide-react';

import type { WebhookEndpoint } from '@shared/types/notifications';

const DEFAULT_TEMPLATE = '{"text":"Tool {tool} finished. Cost: ${cost}. {summary}"}';

function newEndpointDraft(): WebhookEndpoint {
  return {
    id: crypto.randomUUID(),
    label: 'Slack #alerts',
    url: 'https://hooks.slack.com/services/T000/B000/abc',
    template: DEFAULT_TEMPLATE,
  };
}

export const WebhookSettings = (): React.JSX.Element => {
  const persisted = useStore((s) => s.appConfig?.webhookEndpoints ?? []);
  const fetchConfig = useStore((s) => s.fetchConfig);

  const [draft, setDraft] = useState<WebhookEndpoint[]>(persisted);
  const [error, setError] = useState<string | null>(null);
  const [testStatus, setTestStatus] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDraft(persisted);
  }, [persisted]);

  const isDesktop = isDesktopMode();

  const updateAt = (idx: number, patch: Partial<WebhookEndpoint>): void => {
    setDraft((current) => current.map((ep, i) => (i === idx ? { ...ep, ...patch } : ep)));
  };

  const removeAt = (idx: number): void => {
    setDraft((current) => current.filter((_, i) => i !== idx));
  };

  const handleAdd = (): void => {
    setDraft((current) => [...current, newEndpointDraft()]);
  };

  const handleSave = async (): Promise<void> => {
    setError(null);
    setSaving(true);
    try {
      await api.config.update('webhookEndpoints', draft as unknown as Record<string, unknown>);
      await fetchConfig();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async (endpoint: WebhookEndpoint): Promise<void> => {
    setTestStatus(null);
    try {
      await api.webhook.testSend(endpoint);
      setTestStatus(`Sent test payload to ${endpoint.label}`);
    } catch (e) {
      setTestStatus(e instanceof Error ? e.message : 'Test failed');
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div>
        <h2 className="text-text inline-flex items-center gap-2 text-base font-semibold">
          <Plug className="size-4" />
          Webhook endpoints
        </h2>
        <p className="text-text-muted mt-1 text-xs">
          Slack and Discord webhooks for rule actions. SSRF allowlist permits only{' '}
          <code>hooks.slack.com</code>, <code>discord.com/api/webhooks/</code>, and{' '}
          <code>discordapp.com/api/webhooks/</code>. Template variables:{' '}
          <code>{'{session_id}'}</code>, <code>{'{tool}'}</code>, <code>{'{cost}'}</code>,{' '}
          <code>{'{summary}'}</code>.
        </p>
      </div>

      {draft.length === 0 && <p className="text-text-muted text-xs">No endpoints configured.</p>}

      <ul className="flex flex-col gap-3">
        {draft.map((endpoint, idx) => (
          <li
            key={endpoint.id}
            className="border-border bg-surface-raised flex flex-col gap-2 rounded-md border p-3"
          >
            <input
              value={endpoint.label}
              onChange={(e) => updateAt(idx, { label: e.target.value })}
              placeholder="Label"
              className="border-border bg-surface text-text rounded-sm border px-2 py-1 text-xs"
            />
            <input
              value={endpoint.url}
              onChange={(e) => updateAt(idx, { url: e.target.value })}
              placeholder="https://hooks.slack.com/services/…"
              className="border-border bg-surface text-text rounded-sm border px-2 py-1 font-mono text-[11px]"
            />
            <textarea
              value={endpoint.template}
              onChange={(e) => updateAt(idx, { template: e.target.value })}
              spellCheck={false}
              rows={3}
              className="border-border bg-surface text-text rounded-sm border px-2 py-1 font-mono text-[11px]"
            />
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => void handleTest(endpoint)}
                disabled={!isDesktop}
                className="gap-1"
              >
                <Send className="size-3" />
                Send test
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => removeAt(idx)}
                className="text-destructive gap-1"
              >
                <Trash2 className="size-3" />
                Remove
              </Button>
            </div>
          </li>
        ))}
      </ul>

      <div className="flex gap-2">
        <Button variant="secondary" size="sm" onClick={handleAdd}>
          Add endpoint
        </Button>
        <Button variant="default" size="sm" onClick={() => void handleSave()} disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </Button>
      </div>

      {testStatus && <div className="text-text-muted text-[11px]">{testStatus}</div>}
      {error && (
        <div className="border-destructive/40 bg-destructive/10 text-destructive rounded-md border px-3 py-2 text-xs">
          {error}
        </div>
      )}
    </div>
  );
};
