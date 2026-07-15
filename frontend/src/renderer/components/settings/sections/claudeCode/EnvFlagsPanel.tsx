import { JSX, useState } from 'react';
import { Button } from '@renderer/components/ui/button';
import { Input } from '@renderer/components/ui/input';
import { Switch } from '@renderer/components/ui/switch';
import { Eye, EyeOff, Plus, Trash2 } from 'lucide-react';

import { ENV_FLAG_CATALOG } from './envFlagCatalog';
import { mergeEnv } from './envMerge';
import { isSecretKey } from './envSecretMatcher';

const inputClass = 'border-border bg-surface text-text rounded-sm border px-2 py-1 text-xs';
const KNOWN_KEYS = new Set(ENV_FLAG_CATALOG.map((flag) => flag.key));

interface RawRow {
  id: string;
  key: string;
  value: string;
}

function envToRawRows(env: Record<string, string>): RawRow[] {
  return Object.entries(env)
    .filter(([key]) => !KNOWN_KEYS.has(key))
    .map(([key, value]) => ({ id: crypto.randomUUID(), key, value }));
}

function knownValuesOf(env: Record<string, string>): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const flag of ENV_FLAG_CATALOG) {
    out[flag.key] = env[flag.key];
  }
  return out;
}

interface EnvFlagsPanelProps {
  readonly env: Record<string, string>;
  readonly onChange: (next: Record<string, string>) => void;
  readonly disabled: boolean;
}

export const EnvFlagsPanel = ({ env, onChange, disabled }: EnvFlagsPanelProps): JSX.Element => {
  // Lazy-init once: raw row identity (ids) is local UI state so typing
  // doesn't get remounted by the onChange -> parent -> prop echo loop.
  const [rawRows, setRawRows] = useState<RawRow[]>(() => envToRawRows(env));
  const [revealedIds, setRevealedIds] = useState<Set<string>>(new Set());

  const emitRawRows = (rows: RawRow[]): void => {
    setRawRows(rows);
    onChange(mergeEnv(knownValuesOf(env), rows));
  };

  const toggleReveal = (id: string): void => {
    setRevealedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleBoolChange = (key: string, checked: boolean): void => {
    const known = knownValuesOf(env);
    known[key] = checked ? '1' : undefined;
    onChange(mergeEnv(known, rawRows));
  };

  const handleIntChange = (key: string, value: string): void => {
    const known = knownValuesOf(env);
    known[key] = value.trim() === '' ? undefined : value;
    onChange(mergeEnv(known, rawRows));
  };

  const updateRawRow = (idx: number, patch: Partial<Pick<RawRow, 'key' | 'value'>>): void => {
    emitRawRows(rawRows.map((row, i) => (i === idx ? { ...row, ...patch } : row)));
  };

  const removeRawRow = (idx: number): void => {
    emitRawRows(rawRows.filter((_, i) => i !== idx));
  };

  const addRawRow = (): void => {
    setRawRows((rows) => [...rows, { id: crypto.randomUUID(), key: '', value: '' }]);
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="border-border bg-surface-raised divide-border-subtle divide-y rounded-md border">
        {ENV_FLAG_CATALOG.map((flag) => (
          <div key={flag.key} className="flex items-center justify-between gap-3 px-3 py-2">
            <div className="min-w-0">
              <div className="text-text font-mono text-xs">{flag.key}</div>
              <div className="text-text-muted text-xs">{flag.description}</div>
            </div>
            {flag.kind === 'bool' ? (
              <Switch
                checked={env[flag.key] === '1'}
                onCheckedChange={(checked) => handleBoolChange(flag.key, checked)}
                disabled={disabled}
              />
            ) : (
              <Input
                type="number"
                value={env[flag.key] ?? ''}
                disabled={disabled}
                onChange={(e) => handleIntChange(flag.key, e.target.value)}
                placeholder="default"
                className="w-24"
              />
            )}
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-2">
        {rawRows.length === 0 && (
          <div className="text-text-muted border-border bg-surface-raised rounded-md border px-3 py-2 text-xs">
            No other environment variables set
          </div>
        )}
        {rawRows.map((row, idx) => {
          const isSecret = isSecretKey(row.key);
          const revealed = revealedIds.has(row.id);
          const masked = isSecret && !revealed;
          return (
            <div key={row.id} className="flex items-center gap-2">
              <input
                value={row.key}
                disabled={disabled}
                onChange={(e) => updateRawRow(idx, { key: e.target.value })}
                placeholder="KEY"
                className={`${inputClass} w-48 font-mono`}
              />
              <input
                type="text"
                value={masked ? '••••' : row.value}
                readOnly={masked}
                disabled={disabled}
                onChange={(e) => {
                  if (masked) return;
                  updateRawRow(idx, { value: e.target.value });
                }}
                placeholder="value"
                className={`${inputClass} flex-1 font-mono`}
              />
              {isSecret && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  disabled={disabled}
                  onClick={() => toggleReveal(row.id)}
                  aria-label={revealed ? `Hide ${row.key || 'value'}` : `Reveal ${row.key || 'value'}`}
                >
                  {revealed ? (
                    <EyeOff className="text-text-muted size-3" />
                  ) : (
                    <Eye className="text-text-muted size-3" />
                  )}
                </Button>
              )}
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                disabled={disabled}
                onClick={() => removeRawRow(idx)}
                aria-label={`Remove ${row.key || 'variable'}`}
              >
                <Trash2 className="text-text-muted size-3" />
              </Button>
            </div>
          );
        })}
      </div>
      <Button type="button" variant="secondary" size="sm" disabled={disabled} onClick={addRawRow}>
        <Plus className="size-3" />
        Add variable
      </Button>
    </div>
  );
};
