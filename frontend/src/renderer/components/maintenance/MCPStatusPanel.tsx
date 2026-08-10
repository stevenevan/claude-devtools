import { JSX, useEffect, useState } from 'react';
import { api, isDesktopMode } from '@renderer/api';
import { confirm } from '@renderer/components/common/ConfirmDialog';
import { Button } from '@renderer/components/ui/button';
import { Input } from '@renderer/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@renderer/components/ui/native-select';
import { Textarea } from '@renderer/components/ui/textarea';
import { useClipboard } from '@renderer/hooks/mantine';
import { useStore } from '@renderer/store';
import { Check, Copy, KeyRound, Loader2, Plus, RefreshCw } from 'lucide-react';

import type { MCPServerConfig, MCPServerRow, MCPStatusView } from '@shared/types/api';

const SOURCE_LABEL: Record<string, string> = {
  global: '~/.claude.json · global',
  'claudejson-project': '~/.claude.json · project',
  'project-mcpjson': '.mcp.json',
  'auth-cache': 'auth cache',
};

const CLI_LIST_COMMAND = 'claude mcp list';

const TRANSPORT_TYPES = ['stdio', 'http', 'streamable-http', 'sse', 'ws'] as const;
type TransportType = (typeof TRANSPORT_TYPES)[number];
const URL_TRANSPORT_TYPES: TransportType[] = ['http', 'streamable-http', 'sse', 'ws'];

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function sourceLabel(kind: string): string {
  return SOURCE_LABEL[kind] ?? kind;
}

function lastCheckedText(days: number): string {
  if (days <= 0) return 'last checked today';
  if (days === 1) return 'last checked 1 day ago';
  return `last checked ${days} days ago`;
}

function isTransportType(value: string): value is TransportType {
  return (TRANSPORT_TYPES as readonly string[]).includes(value);
}

// Splits on commas or newlines so either a one-liner or a one-arg-per-line
// paste works.
function parseArgsText(text: string): string[] {
  return text
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

// Parses "KEY=value" lines into an env/headers object; a line with no "="
// is skipped rather than rejected outright.
function parseKeyValueLines(text: string): Record<string, string> | undefined {
  const entries: [string, string][] = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    entries.push([trimmed.slice(0, eq).trim(), trimmed.slice(eq + 1).trim()]);
  }
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

// MCP status dashboard. Aggregates MCP server state from ~/.claude.json
// (top-level + per-project), each project's .mcp.json, and the auth-needed
// connector cache. Every existing value stays server-side masked; the only
// write path is add/edit/remove of GLOBAL (top-level ~/.claude.json) servers —
// project-scoped and .mcp.json entries stay read-only, managed via the CLI.
export const MCPStatusPanel = (): JSX.Element => {
  const connectionMode = useStore((s) => s.connectionMode);
  const canAct = isDesktopMode() && connectionMode === 'local';

  const [status, setStatus] = useState<MCPStatusView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      setStatus(await api.getMCPStatus());
    } catch (err) {
      setError(errText(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  return (
    <div className="flex flex-col">
      <div className="border-border/50 flex items-start justify-between gap-2 border-b px-4 py-3">
        <div>
          <p className="text-foreground text-sm font-medium">MCP Status</p>
          <p className="text-muted-foreground mt-0.5 text-xs">
            MCP servers the CLI knows about. Command lines and URLs are masked; auth state is
            point-in-time from the CLI&apos;s cache, never asserted as current. GLOBAL servers can
            be added, edited, and removed here; project-scoped and{' '}
            <span className="font-mono">.mcp.json</span> servers stay read-only — manage those with
            the CLI.
          </p>
        </div>
        <Button variant="outline" size="sm" disabled={loading} onClick={() => void load()}>
          <RefreshCw className="size-3.5" />
          Refresh
        </Button>
      </div>

      {error && (
        <div className="border-border/50 bg-destructive/10 text-destructive border-b px-4 py-2 text-xs">
          {error}
        </div>
      )}

      {!canAct && (
        <div className="border-border/50 bg-card/50 text-muted-foreground border-b px-4 py-2 text-xs">
          Adding, editing, and removing global servers is only available on this local machine.
        </div>
      )}

      <AddServerForm canAct={canAct} onAdded={load} />

      {loading && <p className="text-muted-foreground px-4 py-3 text-xs">Loading…</p>}

      {!loading && status && (
        <>
          {status.mcpServersEmpty ? (
            <EmptyState />
          ) : (
            <ServerSection servers={status.servers} canAct={canAct} onChanged={load} />
          )}
          <ConnectorsSection connectors={status.connectorsFromCache} />
          <GuidanceFooter />
        </>
      )}
    </div>
  );
};

const EmptyState = (): JSX.Element => (
  <div className="border-border/50 border-b px-4 py-6">
    <p className="text-foreground text-xs font-medium">No MCP servers configured</p>
    <p className="text-muted-foreground mt-1.5 max-w-prose text-xs leading-relaxed">
      MCP servers are defined in <span className="font-mono">~/.claude.json</span> (a global
      <span className="font-mono"> mcpServers</span> block or per-project under{' '}
      <span className="font-mono">projects[path].mcpServers</span>) or in a project&apos;s{' '}
      <span className="font-mono">.mcp.json</span> file. This panel lists servers for the project
      roots the CLI already knows about — a <span className="font-mono">.mcp.json</span> in a
      project the CLI has never opened won&apos;t appear here (and that config is inactive anyway).
      Add a global server above, or with <span className="font-mono">claude mcp add</span>.
    </p>
  </div>
);

interface AddServerFormProps {
  canAct: boolean;
  onAdded: () => Promise<void>;
}

const AddServerForm = ({ canAct, onAdded }: Readonly<AddServerFormProps>): JSX.Element => {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [type, setType] = useState<TransportType>('stdio');
  const [commandOrUrl, setCommandOrUrl] = useState('');
  const [argsText, setArgsText] = useState('');
  const [envText, setEnvText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isUrlTransport = URL_TRANSPORT_TYPES.includes(type);

  const reset = (): void => {
    setName('');
    setType('stdio');
    setCommandOrUrl('');
    setArgsText('');
    setEnvText('');
  };

  const handleSubmit = async (): Promise<void> => {
    const trimmedName = name.trim();
    const trimmedCommandOrUrl = commandOrUrl.trim();
    if (!trimmedName || !trimmedCommandOrUrl) {
      setError(isUrlTransport ? 'Name and URL are required.' : 'Name and command are required.');
      return;
    }
    setError(null);

    const config: MCPServerConfig = { type };
    if (isUrlTransport) config.url = trimmedCommandOrUrl;
    else config.command = trimmedCommandOrUrl;
    const args = parseArgsText(argsText);
    if (args.length > 0) config.args = args;
    const env = parseKeyValueLines(envText);
    if (env) config.env = env;

    setSubmitting(true);
    try {
      await api.addMCPServer(trimmedName, config);
      reset();
      setOpen(false);
      await onAdded();
    } catch (err) {
      setError(errText(err));
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) {
    return (
      <div className="border-border/50 border-b px-4 py-3">
        <Button variant="outline" size="sm" disabled={!canAct} onClick={() => setOpen(true)}>
          <Plus className="size-3.5" />
          Add global server
        </Button>
      </div>
    );
  }

  return (
    <div className="border-border/50 flex flex-col gap-2 border-b px-4 py-3">
      <p className="text-foreground text-xs font-medium">Add global MCP server</p>
      {error && <p className="text-destructive text-xs">{error}</p>}
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-muted-foreground flex flex-col gap-1 text-xs">
          Name
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. filesystem"
            className="border-border/50 bg-card/50 text-foreground min-w-40 rounded-sm border px-2 py-1 font-mono text-xs"
          />
        </label>
        <label className="text-muted-foreground flex flex-col gap-1 text-xs">
          Type
          <NativeSelect
            size="sm"
            value={type}
            onChange={(e) => setType(e.target.value as TransportType)}
            className="min-w-24"
          >
            {TRANSPORT_TYPES.map((t) => (
              <NativeSelectOption key={t} value={t}>
                {t}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </label>
        <label className="text-muted-foreground flex min-w-48 flex-1 flex-col gap-1 text-xs">
          {isUrlTransport ? 'URL' : 'Command'}
          <Input
            value={commandOrUrl}
            onChange={(e) => setCommandOrUrl(e.target.value)}
            placeholder={isUrlTransport ? 'https://…' : 'npx'}
            className="border-border/50 bg-card/50 text-foreground rounded-sm border px-2 py-1 font-mono text-xs"
          />
        </label>
      </div>
      <label className="text-muted-foreground flex flex-col gap-1 text-xs">
        Args (comma or newline separated)
        <Textarea
          value={argsText}
          onChange={(e) => setArgsText(e.target.value)}
          placeholder={'-y\n@modelcontextprotocol/server-filesystem'}
          rows={2}
          className="border-border/50 bg-card/50 text-foreground rounded-sm border px-2 py-1 font-mono text-xs"
        />
      </label>
      <label className="text-muted-foreground flex flex-col gap-1 text-xs">
        Env (KEY=value per line)
        <Textarea
          value={envText}
          onChange={(e) => setEnvText(e.target.value)}
          placeholder="API_KEY=…"
          rows={2}
          className="border-border/50 bg-card/50 text-foreground rounded-sm border px-2 py-1 font-mono text-xs"
        />
      </label>
      <div className="flex items-center gap-2">
        <Button
          variant="default"
          size="sm"
          disabled={!canAct || submitting}
          onClick={() => void handleSubmit()}
        >
          {submitting && <Loader2 className="size-3.5 animate-spin" />}
          Add server
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={submitting}
          onClick={() => {
            reset();
            setError(null);
            setOpen(false);
          }}
        >
          Cancel
        </Button>
      </div>
    </div>
  );
};

interface ServerSectionProps {
  servers: MCPServerRow[];
  canAct: boolean;
  onChanged: () => Promise<void>;
}

const ServerSection = ({ servers, canAct, onChanged }: Readonly<ServerSectionProps>): JSX.Element => (
  <div className="border-border/50 border-b px-4 py-3">
    <p className="text-foreground mb-2 text-xs font-medium">Servers ({servers.length})</p>
    <div className="flex flex-col gap-1.5">
      {servers.map((server) => (
        <ServerRow
          key={`${server.sourceKind}:${server.sourcePath}:${server.name}`}
          server={server}
          canAct={canAct}
          onChanged={onChanged}
        />
      ))}
    </div>
  </div>
);

interface ServerRowProps {
  server: MCPServerRow;
  canAct: boolean;
  onChanged: () => Promise<void>;
}

const ServerRow = ({ server, canAct, onChanged }: Readonly<ServerRowProps>): JSX.Element => {
  const isGlobal = server.sourceKind === 'global';
  const [editing, setEditing] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [rowError, setRowError] = useState<string | null>(null);

  const handleRemove = async (): Promise<void> => {
    const confirmed = await confirm({
      title: 'Remove MCP server?',
      message: `Remove MCP server "${server.name}"? This edits ~/.claude.json.`,
      confirmLabel: 'Remove',
      variant: 'danger',
    });
    if (!confirmed) return;
    setRowError(null);
    setRemoving(true);
    try {
      await api.removeMCPServer(server.name);
      await onChanged();
    } catch (err) {
      setRowError(errText(err));
    } finally {
      setRemoving(false);
    }
  };

  return (
    <div className="border-border/50 rounded-md border px-2.5 py-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="text-foreground truncate font-mono text-xs">{server.name}</span>
          {server.transport && (
            <span className="bg-card/50 text-muted-foreground rounded-sm px-1.5 py-px text-[10px] font-medium">
              {server.transport}
            </span>
          )}
          {server.authNeeded && (
            <span className="inline-flex items-center gap-1 rounded-sm bg-amber-500/15 px-1.5 py-px text-[10px] font-medium text-amber-500">
              <KeyRound className="size-2.5" />
              auth needed
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <span className="text-muted-foreground text-[10px]" title={server.sourcePath}>
            {sourceLabel(server.sourceKind)}
          </span>
          {isGlobal && !editing && (
            <>
              <Button variant="ghost" size="sm" disabled={!canAct} onClick={() => setEditing(true)}>
                Edit
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={!canAct || removing}
                onClick={() => void handleRemove()}
              >
                {removing && <Loader2 className="size-3.5 animate-spin" />}
                Remove
              </Button>
            </>
          )}
        </div>
      </div>
      {server.commandOrUrl && (
        <p className="text-muted-foreground mt-1 truncate font-mono text-[11px]" title={server.commandOrUrl}>
          {server.commandOrUrl}
        </p>
      )}
      {server.authNeeded && (
        <p className="mt-1 text-[10px] text-amber-500/90">
          {lastCheckedText(server.cacheAgeDays)} — re-authenticate via the CLI or claude.ai if it
          stops responding.
        </p>
      )}
      {rowError && <p className="text-destructive mt-1 text-[11px]">{rowError}</p>}
      {isGlobal && editing && (
        <EditServerForm
          name={server.name}
          initialType={server.transport}
          canAct={canAct}
          onCancel={() => setEditing(false)}
          onSaved={async () => {
            setEditing(false);
            await onChanged();
          }}
        />
      )}
    </div>
  );
};

interface EditServerFormProps {
  name: string;
  initialType: string;
  canAct: boolean;
  onCancel: () => void;
  onSaved: () => Promise<void>;
}

const EditServerForm = ({
  name,
  initialType,
  canAct,
  onCancel,
  onSaved,
}: Readonly<EditServerFormProps>): JSX.Element => {
  const [type, setType] = useState<TransportType>(isTransportType(initialType) ? initialType : 'stdio');
  const [commandOrUrl, setCommandOrUrl] = useState('');
  const [argsText, setArgsText] = useState('');
  const [envText, setEnvText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isUrlTransport = URL_TRANSPORT_TYPES.includes(type);

  const handleSave = async (): Promise<void> => {
    setError(null);
    const patch: MCPServerConfig = { type };
    const trimmedCommandOrUrl = commandOrUrl.trim();
    if (trimmedCommandOrUrl) {
      if (isUrlTransport) patch.url = trimmedCommandOrUrl;
      else patch.command = trimmedCommandOrUrl;
    }
    const args = parseArgsText(argsText);
    if (args.length > 0) patch.args = args;
    const env = parseKeyValueLines(envText);
    if (env) patch.env = env;

    setSubmitting(true);
    try {
      await api.updateMCPServer(name, patch);
      await onSaved();
    } catch (err) {
      setError(errText(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="border-border/50 mt-2 flex flex-col gap-2 border-t pt-2">
      {error && <p className="text-destructive text-[11px]">{error}</p>}
      <p className="text-muted-foreground text-[10px]">
        Blank fields keep their saved value; to change a var inside env, re-enter the whole env
        block.
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-muted-foreground flex flex-col gap-1 text-[11px]">
          Type
          <NativeSelect
            size="sm"
            value={type}
            onChange={(e) => setType(e.target.value as TransportType)}
            className="min-w-24"
          >
            {TRANSPORT_TYPES.map((t) => (
              <NativeSelectOption key={t} value={t}>
                {t}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </label>
        <label className="text-muted-foreground flex min-w-48 flex-1 flex-col gap-1 text-[11px]">
          {isUrlTransport ? 'URL' : 'Command'}
          <Input
            value={commandOrUrl}
            onChange={(e) => setCommandOrUrl(e.target.value)}
            placeholder="leave blank to keep current"
            className="border-border/50 bg-card/50 text-foreground rounded-sm border px-1.5 py-0.5 font-mono text-[11px]"
          />
        </label>
      </div>
      <label className="text-muted-foreground flex flex-col gap-1 text-[11px]">
        Args (comma or newline separated)
        <Textarea
          value={argsText}
          onChange={(e) => setArgsText(e.target.value)}
          placeholder="leave blank to keep current"
          rows={2}
          className="border-border/50 bg-card/50 text-foreground rounded-sm border px-1.5 py-0.5 font-mono text-[11px]"
        />
      </label>
      <label className="text-muted-foreground flex flex-col gap-1 text-[11px]">
        Env (KEY=value per line)
        <Textarea
          value={envText}
          onChange={(e) => setEnvText(e.target.value)}
          placeholder="leave blank to keep current"
          rows={2}
          className="border-border/50 bg-card/50 text-foreground rounded-sm border px-1.5 py-0.5 font-mono text-[11px]"
        />
      </label>
      <div className="flex items-center gap-2">
        <Button
          variant="default"
          size="sm"
          disabled={!canAct || submitting}
          onClick={() => void handleSave()}
        >
          {submitting && <Loader2 className="size-3.5 animate-spin" />}
          Save
        </Button>
        <Button variant="ghost" size="sm" disabled={submitting} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
};

interface ConnectorsSectionProps {
  connectors: MCPServerRow[];
}

const ConnectorsSection = ({ connectors }: Readonly<ConnectorsSectionProps>): JSX.Element | null => {
  if (connectors.length === 0) return null;
  return (
    <div className="border-border/50 border-b px-4 py-3">
      <p className="text-foreground mb-1 text-xs font-medium">
        Connectors needing auth ({connectors.length})
      </p>
      <p className="text-muted-foreground mb-2 text-[11px]">
        From the CLI&apos;s auth-needed cache. No matching server source — these are connector
        logins the CLI flagged. State is point-in-time.
      </p>
      <div className="flex flex-col gap-1.5">
        {connectors.map((connector) => (
          <div
            key={connector.name}
            className="border-border/50 flex items-center justify-between gap-2 rounded-md border px-2.5 py-1.5"
          >
            <span className="inline-flex min-w-0 items-center gap-1.5">
              <KeyRound className="size-3 shrink-0 text-amber-500" />
              <span className="text-foreground truncate font-mono text-xs">{connector.name}</span>
            </span>
            <span className="text-muted-foreground shrink-0 text-[10px]">
              {lastCheckedText(connector.cacheAgeDays)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};

const GuidanceFooter = (): JSX.Element => {
  const { copy, copied } = useClipboard({ timeout: 2000 });
  return (
    <div className="px-4 py-3">
      <p className="text-foreground mb-1.5 text-xs font-medium">Manage MCP servers</p>
      <p className="text-muted-foreground mb-2 max-w-prose text-[11px] leading-relaxed">
        Global servers can be added, edited, and removed above. Project-scoped and{' '}
        <span className="font-mono">.mcp.json</span> servers stay read-only here — manage those,
        re-authenticate a connector, and see live connection health with the Claude Code CLI:
      </p>
      <div className="flex items-center gap-2">
        <code className="bg-card/50 text-foreground rounded-sm px-2 py-1 font-mono text-[11px]">
          {CLI_LIST_COMMAND}
        </code>
        <Button
          variant="ghost"
          size="icon-sm"
          title="Copy command"
          onClick={() => copy(CLI_LIST_COMMAND)}
        >
          {copied ? <Check className="size-3 text-emerald-500" /> : <Copy className="size-3" />}
        </Button>
      </div>
      <p className="text-muted-foreground mt-2 text-[11px]">
        Re-authenticate a connector by running the CLI login flow or reconnecting the integration at
        claude.ai.
      </p>
    </div>
  );
};
