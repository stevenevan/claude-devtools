import { JSX, useEffect, useState } from 'react';
import { api } from '@renderer/api';
import { Button } from '@renderer/components/ui/button';
import { useClipboard } from '@renderer/hooks/mantine';
import { Check, Copy, KeyRound, RefreshCw } from 'lucide-react';

import type { MCPServerRow, MCPStatusView } from '@shared/types/api';

const SOURCE_LABEL: Record<string, string> = {
  global: '~/.claude.json · global',
  'claudejson-project': '~/.claude.json · project',
  'project-mcpjson': '.mcp.json',
  'auth-cache': 'auth cache',
};

const CLI_LIST_COMMAND = 'claude mcp list';

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

// Read-only Week 22 MCP status dashboard. Aggregates MCP server state from
// ~/.claude.json (top-level + per-project), each project's .mcp.json, and the
// auth-needed connector cache. Every value is server-side masked; this panel
// writes nothing and renders in browser mode.
export const MCPStatusPanel = (): JSX.Element => {
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
            Read-only view of MCP servers the CLI knows about. Command lines and URLs are masked;
            auth state is point-in-time from the CLI&apos;s cache, never asserted as current. Manage
            servers with the CLI — nothing here writes.
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

      {loading && <p className="text-muted-foreground px-4 py-3 text-xs">Loading…</p>}

      {!loading && status && (
        <>
          {status.mcpServersEmpty ? (
            <EmptyState />
          ) : (
            <ServerSection servers={status.servers} />
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
      Add one with <span className="font-mono">claude mcp add</span>.
    </p>
  </div>
);

interface ServerSectionProps {
  servers: MCPServerRow[];
}

const ServerSection = ({ servers }: Readonly<ServerSectionProps>): JSX.Element => (
  <div className="border-border/50 border-b px-4 py-3">
    <p className="text-foreground mb-2 text-xs font-medium">Servers ({servers.length})</p>
    <div className="flex flex-col gap-1.5">
      {servers.map((server) => (
        <ServerRow key={`${server.sourceKind}:${server.sourcePath}:${server.name}`} server={server} />
      ))}
    </div>
  </div>
);

interface ServerRowProps {
  server: MCPServerRow;
}

const ServerRow = ({ server }: Readonly<ServerRowProps>): JSX.Element => (
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
      <span
        className="text-muted-foreground shrink-0 text-[10px]"
        title={server.sourcePath}
      >
        {sourceLabel(server.sourceKind)}
      </span>
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
  </div>
);

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
        This dashboard is read-only. Inspect, add, remove, and re-authenticate servers with the
        Claude Code CLI. To see live status and connection health, run:
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
