import { JSX, useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '@renderer/api';
import { Button } from '@renderer/components/ui/button';
import { cn } from '@renderer/lib/utils';
import { RefreshCw, Server } from 'lucide-react';

import type {
  CodexInventoryScope,
  CodexMcpCheckState,
  CodexMcpEnabledState,
  CodexMcpServerSummary,
  CodexMcpStatusView,
  CodexMcpTransport,
} from '@shared/types/api';
import type { UIMode } from '@shared/types';

import {
  CodexDiagnostics,
  codexScopeLabel,
  getCodexInspectionContext,
} from '../dashboard/CodexInventorySource';
import { InstallableList, type InstallableListItem } from '../dashboard/InstallableList';

interface CodexMcpPanelProps {
  readonly mode: UIMode;
  readonly scope: CodexInventoryScope;
  readonly projectName?: string;
}

function errorText(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

function enabledLabel(state: CodexMcpEnabledState): string {
  switch (state) {
    case 'enabled':
      return 'Enabled';
    case 'disabled':
      return 'Disabled';
    default:
      return 'Unknown';
  }
}

function checkLabel(state: CodexMcpCheckState): string {
  switch (state) {
    case 'yes':
      return 'Yes';
    case 'no':
      return 'No';
    default:
      return 'Not checked';
  }
}

function transportLabel(transport: CodexMcpTransport): string {
  switch (transport) {
    case 'stdio':
      return 'stdio';
    case 'http':
      return 'HTTP';
    default:
      return 'Unknown transport';
  }
}

function statusTone(state: CodexMcpEnabledState): string {
  return state === 'enabled'
    ? 'bg-emerald-500/10 text-emerald-400'
    : state === 'disabled'
      ? 'bg-zinc-500/10 text-zinc-500'
      : 'bg-amber-500/10 text-amber-400';
}

export const CodexMcpPanel = ({
  mode,
  scope,
  projectName,
}: Readonly<CodexMcpPanelProps>): JSX.Element => {
  const context = useMemo(() => getCodexInspectionContext(scope), [scope]);
  const [status, setStatus] = useState<CodexMcpStatusView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      setStatus(await api.getCodexMcpStatus(context));
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setLoading(false);
    }
  }, [context]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const servers = status?.servers ?? [];
  const enabledCount = servers.filter((server) => server.enabled === 'enabled').length;
  const unknownCount = servers.filter((server) => server.enabled === 'unknown').length;
  const scopeLabel = codexScopeLabel(scope, projectName);

  return (
    <div className="bg-background flex flex-1 flex-col overflow-hidden">
      <div className="border-border/50 flex shrink-0 items-start justify-between gap-3 border-b px-4 py-3">
        <div className="min-w-0">
          <p className="text-foreground text-sm font-medium">Codex MCP policy</p>
          <p className="text-muted-foreground mt-0.5 max-w-2xl text-xs">
            Read-only configuration for the {scopeLabel.toLowerCase()}. This view never launches
            servers, probes reachability, or exposes endpoints and credentials.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={loading}
          onClick={() => void refresh()}
        >
          <RefreshCw className={cn('size-3.5', loading && 'animate-spin')} />
          Refresh
        </Button>
      </div>

      {error && (
        <div className="border-border/50 bg-destructive/10 text-destructive border-b px-4 py-2 text-xs">
          {error}
        </div>
      )}

      {loading ? (
        <p role="status" className="text-muted-foreground px-4 py-3 text-xs">
          Inspecting local MCP policy…
        </p>
      ) : status ? (
        <>
          <PolicySummary status={status} />
          <div className="border-border/50 grid shrink-0 grid-cols-3 divide-x border-b">
            <SummaryMetric label="Servers" value={servers.length} />
            <SummaryMetric label="Enabled" value={enabledCount} />
            <SummaryMetric label="Enablement unknown" value={unknownCount} />
          </div>
          {mode === 'simple' ? (
            <SimpleServerList servers={servers} />
          ) : (
            <div className="flex-1 overflow-y-auto p-4">
              {servers.length === 0 ? <EmptyServers /> : <ServerCards servers={servers} />}
            </div>
          )}
          <CodexDiagnostics diagnostics={status.summary.diagnostics} />
        </>
      ) : null}
    </div>
  );
};

const SummaryMetric = ({ label, value }: Readonly<{ label: string; value: number }>): JSX.Element => (
  <div className="px-4 py-2.5">
    <p className="text-muted-foreground text-[10px] font-medium uppercase tracking-wide">{label}</p>
    <p className="text-foreground mt-0.5 text-lg font-semibold tabular-nums">{value}</p>
  </div>
);

const PolicySummary = ({ status }: Readonly<{ status: CodexMcpStatusView }>): JSX.Element => (
  <section className="border-border/50 shrink-0 border-b px-4 py-3">
    <div className="mb-2 flex items-center gap-2">
      <span className="border-border bg-popover flex size-7 items-center justify-center rounded-md border">
        <Server className="text-muted-foreground size-3.5" />
      </span>
      <div>
        <p className="text-foreground text-xs font-medium">Effective policy signals</p>
        <p className="text-muted-foreground text-[10px]">
          Values are read from active local configuration layers.
        </p>
      </div>
    </div>
    <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
      <PolicyValue label="Approval" value={status.policy.approvalMode ?? 'Unknown'} />
      <PolicyValue label="Sandbox" value={status.policy.sandboxMode ?? 'Unknown'} />
      <PolicyValue label="Hooks" value={status.policy.hooksConfigured ? 'Configured' : 'Not configured'} />
      <PolicyValue
        label="Layers"
        value={status.policy.sourceLabels.length === 0 ? 'None' : String(status.policy.sourceLabels.length)}
      />
    </div>
  </section>
);

const PolicyValue = ({ label, value }: Readonly<{ label: string; value: string }>): JSX.Element => (
  <div className="bg-card/50 rounded-md px-2.5 py-2">
    <p className="text-muted-foreground text-[10px] uppercase tracking-wide">{label}</p>
    <p className="text-foreground mt-1 truncate text-xs">{value}</p>
  </div>
);

const SimpleServerList = ({
  servers,
}: Readonly<{ servers: readonly CodexMcpServerSummary[] }>): JSX.Element => {
  const items: InstallableListItem[] = servers.map((server) => ({
    id: server.id,
    name: server.name,
    detail:
      transportLabel(server.transport) +
      ' · Reachability not checked · Observed: ' +
      checkLabel(server.observed),
    source: server.sourceLabel,
    stateLabel: enabledLabel(server.enabled),
  }));

  return (
    <div className="flex-1 overflow-y-auto px-4 py-4">
      <InstallableList
        items={items}
        ariaLabel="Codex MCP servers"
        emptyMessage="No Codex MCP servers were found in this scope."
      />
    </div>
  );
};

const ServerCards = ({
  servers,
}: Readonly<{ servers: readonly CodexMcpServerSummary[] }>): JSX.Element => (
  <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
    {servers.map((server) => (
      <ServerCard key={server.id} server={server} />
    ))}
  </div>
);

const ServerCard = ({ server }: Readonly<{ server: CodexMcpServerSummary }>): JSX.Element => (
  <article className="border-border bg-card/40 rounded-md border p-4">
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-1.5">
          <h3 className="text-foreground truncate text-sm font-medium">{server.name}</h3>
          <span className={cn('rounded-sm px-1.5 py-0.5 text-[10px] font-medium', statusTone(server.enabled))}>
            {enabledLabel(server.enabled)}
          </span>
        </div>
        <p className="text-muted-foreground mt-1 truncate text-[10px]">{server.sourceLabel}</p>
      </div>
      <span className="border-border/60 text-muted-foreground shrink-0 rounded-sm border px-1.5 py-0.5 text-[10px]">
        {transportLabel(server.transport)}
      </span>
    </div>

    <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
      <ServerFact label="Configured" value={server.configured ? 'Yes' : 'No'} />
      <ServerFact label="Reachable" value={checkLabel(server.reachable)} />
      <ServerFact label="Approval observed" value={checkLabel(server.approvalObserved)} />
      <ServerFact label="Runtime observed" value={checkLabel(server.observed)} />
      <ServerFact label="Command" value={server.commandConfigured ? 'Configured' : 'None'} />
      <ServerFact label="Endpoint" value={server.endpointConfigured ? 'Configured' : 'None'} />
      <ServerFact label="Credentials" value={server.credentialsConfigured ? 'Configured' : 'None'} />
      <ServerFact label="Advertised tools" value={String(server.advertisedToolCount)} />
    </div>

    <div className="border-border/50 mt-4 border-t pt-3">
      <ServerFact label="Approval mode" value={server.approvalMode ?? 'Unknown'} />
      {(server.enabledTools.length > 0 || server.disabledTools.length > 0) && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {server.enabledTools.map((tool) => (
            <span key={'enabled-' + tool} className="rounded-sm bg-emerald-500/10 px-1.5 py-0.5 text-[10px] text-emerald-400">
              Allow · {tool}
            </span>
          ))}
          {server.disabledTools.map((tool) => (
            <span key={'disabled-' + tool} className="rounded-sm bg-zinc-500/10 px-1.5 py-0.5 text-[10px] text-zinc-400">
              Block · {tool}
            </span>
          ))}
        </div>
      )}
    </div>

    <CodexDiagnostics diagnostics={server.diagnostics} />
  </article>
);

const ServerFact = ({ label, value }: Readonly<{ label: string; value: string }>): JSX.Element => (
  <div className="min-w-0">
    <span className="text-muted-foreground">{label}</span>
    <span className="text-foreground ml-1 truncate">{value}</span>
  </div>
);

const EmptyServers = (): JSX.Element => (
  <div className="flex min-h-48 flex-col items-center justify-center rounded-md border border-dashed border-border px-8 py-12 text-center">
    <Server className="text-muted-foreground mb-3 size-6" />
    <p className="text-muted-foreground text-sm">No Codex MCP servers were found.</p>
    <p className="text-muted-foreground mt-1 max-w-md text-xs">
      Server configuration appears here after it is declared in an active Codex layer or plugin.
    </p>
  </div>
);
