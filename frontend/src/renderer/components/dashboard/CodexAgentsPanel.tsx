import { JSX, useCallback, useEffect, useState } from 'react';
import { api } from '@renderer/api';
import { MarkdownViewer } from '@renderer/components/chat/viewers/MarkdownViewer';
import { Button } from '@renderer/components/ui/button';
import { Pencil } from 'lucide-react';

import {
  codexScopeLabel,
  codexStateLabel,
  CodexDiagnostics,
} from './CodexInventorySource';
import { CodexTextEditor } from './CodexTextEditor';

import type {
  CodexAgentDetail,
  CodexAgentList,
  CodexAgentSummary,
  CodexInstructionDetail,
  CodexInstructionList,
  CodexInstructionSource,
  CodexInventoryScope,
} from '@shared/types/api';
import type { UIMode } from '@shared/types';

type CodexInventoryTab = 'agents' | 'instructions';
type EditingRecord = { kind: CodexInventoryTab; id: string } | null;

interface CodexAgentsPanelProps {
  readonly mode: UIMode;
  readonly scope: CodexInventoryScope;
  readonly projectName?: string;
  readonly canAct: boolean;
}

export const CodexAgentsPanel = ({
  mode,
  scope,
  projectName,
  canAct,
}: Readonly<CodexAgentsPanelProps>): JSX.Element => {
  const [tab, setTab] = useState<CodexInventoryTab>('agents');
  const [agents, setAgents] = useState<CodexAgentList | null>(null);
  const [instructions, setInstructions] = useState<CodexInstructionList | null>(null);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [selectedInstructionId, setSelectedInstructionId] = useState<string | null>(null);
  const [agentDetail, setAgentDetail] = useState<CodexAgentDetail | null>(null);
  const [instructionDetail, setInstructionDetail] = useState<CodexInstructionDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [editing, setEditing] = useState<EditingRecord>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const [instructionResult, agentResult] = await Promise.all([
        api.listCodexInstructions(scope),
        api.listCodexAgents(scope),
      ]);
      setInstructions(instructionResult);
      setAgents(agentResult);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLoading(false);
    }
  }, [scope]);

  useEffect(() => {
    setSelectedAgentId(null);
    setSelectedInstructionId(null);
    setAgentDetail(null);
    setInstructionDetail(null);
    setDetailError(null);
    setEditing(null);
    setSuccess(null);
    void refresh();
  }, [refresh]);

  const selectAgent = async (agent: CodexAgentSummary): Promise<void> => {
    setTab('agents');
    setSelectedAgentId(agent.identity.id);
    setSelectedInstructionId(null);
    setInstructionDetail(null);
    setAgentDetail(null);
    setDetailError(null);
    setSuccess(null);
    if (mode === 'simple') return;
    setDetailLoading(true);
    try {
      setAgentDetail(await api.readCodexAgent(scope, agent.identity.id));
    } catch (reason) {
      setDetailError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setDetailLoading(false);
    }
  };

  const selectInstruction = async (instruction: CodexInstructionSource): Promise<void> => {
    setTab('instructions');
    setSelectedInstructionId(instruction.identity.id);
    setSelectedAgentId(null);
    setAgentDetail(null);
    setInstructionDetail(null);
    setDetailError(null);
    setSuccess(null);
    if (mode === 'simple') return;
    setDetailLoading(true);
    try {
      setInstructionDetail(await api.readCodexInstruction(scope, instruction.identity.id));
    } catch (reason) {
      setDetailError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setDetailLoading(false);
    }
  };

  const handleApplied = async (kind: CodexInventoryTab): Promise<void> => {
    setEditing(null);
    setAgentDetail(null);
    setInstructionDetail(null);
    setSelectedAgentId(null);
    setSelectedInstructionId(null);
    setSuccess(`${kind === 'agents' ? 'Agent' : 'Instruction'} saved. Inventory refreshed.`);
    await refresh();
  };

  const scopeLabel = codexScopeLabel(scope, projectName);
  const selectedAgent = agents?.items.find((item) => item.identity.id === selectedAgentId) ?? null;
  const selectedInstruction =
    instructions?.items.find((item) => item.identity.id === selectedInstructionId) ?? null;

  return (
    <div className="bg-background flex flex-1 flex-col overflow-hidden">
      <div className="border-border/50 border-b px-4 py-3">
        <p className="text-foreground text-sm font-medium">Codex inventory</p>
        <p className="text-muted-foreground mt-0.5 text-xs">
          Inspect Codex instructions and custom agents from the {scopeLabel.toLowerCase()}.
          Local text is untrusted and is never executed by the inspector.
        </p>
      </div>

      {!canAct && (
        <div className="border-border/50 bg-card/50 text-muted-foreground border-b px-4 py-2 text-xs">
          Codex text edits operate on this local machine only.
        </div>
      )}
      {error && (
        <div className="border-border/50 bg-destructive/10 text-destructive border-b px-4 py-2 text-xs">
          {error}
        </div>
      )}
      {success && (
        <div className="border-border/50 bg-emerald-500/10 text-emerald-400 border-b px-4 py-2 text-xs">
          {success}
        </div>
      )}

      <div className="border-border/50 flex items-center gap-1 border-b px-4 py-2">
        <Button
          type="button"
          size="sm"
          variant={tab === 'agents' ? 'secondary' : 'ghost'}
          aria-pressed={tab === 'agents'}
          onClick={() => {
            setTab('agents');
            setSuccess(null);
          }}
        >
          Agents
        </Button>
        <Button
          type="button"
          size="sm"
          variant={tab === 'instructions' ? 'secondary' : 'ghost'}
          aria-pressed={tab === 'instructions'}
          onClick={() => {
            setTab('instructions');
            setSuccess(null);
          }}
        >
          Instructions
        </Button>
      </div>

      {loading ? (
        <p className="text-muted-foreground px-4 py-3 text-xs">Loading Codex inventory…</p>
      ) : mode === 'simple' ? (
        <SimpleCodexInventory
          tab={tab}
          agents={agents}
          instructions={instructions}
          selectedAgent={selectedAgent}
          selectedInstruction={selectedInstruction}
          onSelectAgent={(agent) => void selectAgent(agent)}
          onSelectInstruction={(instruction) => void selectInstruction(instruction)}
        />
      ) : (
        <div className="flex flex-1 overflow-hidden">
          <div className="border-border/50 flex w-80 shrink-0 flex-col gap-0.5 overflow-y-auto border-r p-2">
            {tab === 'agents' ? (
              agents && agents.items.length > 0 ? (
                agents.items.map((agent) => (
                  <InventoryRowButton
                    key={agent.identity.id}
                    selected={agent.identity.id === selectedAgentId}
                    title={agent.name}
                    description={agent.description || 'No description provided.'}
                    source={agent.identity.label}
                    state={codexStateLabel(agent.state)}
                    onClick={() => void selectAgent(agent)}
                  />
                ))
              ) : (
                <EmptyInventory message="No Codex agents were found in this scope." />
              )
            ) : instructions && instructions.items.length > 0 ? (
              instructions.items.map((instruction) => (
                <InventoryRowButton
                  key={instruction.identity.id}
                  selected={instruction.identity.id === selectedInstructionId}
                  title={instruction.identity.label}
                  description={instruction.active ? 'Active instruction layer.' : 'Available layer.'}
                  source={instruction.identity.relativePath}
                  state={codexStateLabel(instruction.state)}
                  onClick={() => void selectInstruction(instruction)}
                />
              ))
            ) : (
              <EmptyInventory message="No Codex instruction files were found in this scope." />
            )}
          </div>

          <div className="flex-1 overflow-y-auto">
            {detailLoading ? (
              <p className="text-muted-foreground px-4 py-3 text-xs">Loading selected record…</p>
            ) : detailError ? (
              <p className="text-destructive px-4 py-3 text-xs">{detailError}</p>
            ) : editing?.kind === 'agents' && agentDetail && selectedAgent ? (
              <CodexTextEditor
                key={`agent-editor-${agentDetail.exactRevision}`}
                title={`${selectedAgent.name} · developer instructions`}
                initialContent={agentDetail.developerInstructions ?? ''}
                expectedRevision={agentDetail.exactRevision}
                canAct={canAct && !agentDetail.truncated}
                onCancel={() => setEditing(null)}
                onPreview={(content, revision) =>
                  api.previewCodexAgent(scope, selectedAgent.identity.id, content, revision)
                }
                onApply={(content, revision) =>
                  api.applyCodexAgent(scope, selectedAgent.identity.id, content, revision)
                }
                onApplied={() => handleApplied('agents')}
              />
            ) : editing?.kind === 'instructions' && instructionDetail && selectedInstruction ? (
              <CodexTextEditor
                key={`instruction-editor-${instructionDetail.exactRevision}`}
                title={selectedInstruction.identity.relativePath}
                initialContent={instructionDetail.content}
                expectedRevision={instructionDetail.exactRevision}
                canAct={canAct && !instructionDetail.truncated}
                onCancel={() => setEditing(null)}
                onPreview={(content, revision) =>
                  api.previewCodexInstruction(scope, selectedInstruction.identity.id, content, revision)
                }
                onApply={(content, revision) =>
                  api.applyCodexInstruction(scope, selectedInstruction.identity.id, content, revision)
                }
                onApplied={() => handleApplied('instructions')}
              />
            ) : tab === 'agents' && selectedAgent && agentDetail ? (
              <AgentDetail
                detail={agentDetail}
                canEdit={canAct && !agentDetail.truncated}
                onEdit={() => setEditing({ kind: 'agents', id: selectedAgent.identity.id })}
              />
            ) : tab === 'instructions' && selectedInstruction && instructionDetail ? (
              <InstructionDetail
                detail={instructionDetail}
                canEdit={canAct && !instructionDetail.truncated}
                onEdit={() =>
                  setEditing({ kind: 'instructions', id: selectedInstruction.identity.id })
                }
              />
            ) : (
              <p className="text-muted-foreground px-4 py-3 text-xs">
                Select a record to inspect it. Nothing is selected automatically.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

interface SimpleCodexInventoryProps {
  readonly tab: CodexInventoryTab;
  readonly agents: CodexAgentList | null;
  readonly instructions: CodexInstructionList | null;
  readonly selectedAgent: CodexAgentSummary | null;
  readonly selectedInstruction: CodexInstructionSource | null;
  readonly onSelectAgent: (agent: CodexAgentSummary) => void;
  readonly onSelectInstruction: (instruction: CodexInstructionSource) => void;
}

const SimpleCodexInventory = ({
  tab,
  agents,
  instructions,
  selectedAgent,
  selectedInstruction,
  onSelectAgent,
  onSelectInstruction,
}: Readonly<SimpleCodexInventoryProps>): JSX.Element => (
  <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-6 py-6">
    <p className="text-muted-foreground max-w-2xl text-sm">
      {tab === 'agents'
        ? 'Codex agents provide focused ways of working. This view shows their purpose and truthful inventory state without exposing configuration text.'
        : 'Codex instructions describe local working rules. This view shows which layers are available without exposing their text.'}
    </p>
    <div className="flex flex-col gap-2">
      {tab === 'agents' ? (
        agents && agents.items.length > 0 ? (
          agents.items.map((agent) => (
            <SimpleInventoryButton
              key={agent.identity.id}
              title={agent.name}
              description={agent.description || 'No description provided.'}
              source={agent.identity.label}
              state={codexStateLabel(agent.state)}
              selected={agent.identity.id === selectedAgent?.identity.id}
              onClick={() => onSelectAgent(agent)}
            />
          ))
        ) : (
          <EmptyInventory message="No Codex agents were found in this scope." />
        )
      ) : instructions && instructions.items.length > 0 ? (
        instructions.items.map((instruction) => (
          <SimpleInventoryButton
            key={instruction.identity.id}
            title={instruction.identity.label}
            description={instruction.active ? 'Active instruction layer.' : 'Available layer.'}
            source={instruction.identity.relativePath}
            state={codexStateLabel(instruction.state)}
            selected={instruction.identity.id === selectedInstruction?.identity.id}
            onClick={() => onSelectInstruction(instruction)}
          />
        ))
      ) : (
        <EmptyInventory message="No Codex instruction files were found in this scope." />
      )}
    </div>
    {selectedAgent && tab === 'agents' && (
      <SummaryCard
        title={selectedAgent.name}
        description={selectedAgent.description || 'No description provided.'}
        source={selectedAgent.identity.label}
        state={codexStateLabel(selectedAgent.state)}
      />
    )}
    {selectedInstruction && tab === 'instructions' && (
      <SummaryCard
        title={selectedInstruction.identity.label}
        description={selectedInstruction.active ? 'Active instruction layer.' : 'Available layer.'}
        source={selectedInstruction.identity.relativePath}
        state={codexStateLabel(selectedInstruction.state)}
      />
    )}
  </div>
);

interface InventoryRowButtonProps {
  readonly selected: boolean;
  readonly title: string;
  readonly description: string;
  readonly source: string;
  readonly state: string;
  readonly onClick: () => void;
}

const InventoryRowButton = ({
  selected,
  title,
  description,
  source,
  state,
  onClick,
}: Readonly<InventoryRowButtonProps>): JSX.Element => (
  <Button
    type="button"
    variant={selected ? 'secondary' : 'ghost'}
    size="sm"
    className="h-auto flex-col items-start gap-1 py-2 text-left"
    onClick={onClick}
  >
    <span className="text-foreground w-full truncate text-xs font-medium">{title}</span>
    <span className="text-muted-foreground w-full truncate text-[10px]">{description}</span>
    <span className="flex w-full items-center gap-1.5 text-[10px]">
      <span className="text-muted-foreground truncate">{source}</span>
      <span className="text-muted-foreground ml-auto shrink-0 rounded-sm border border-border/60 px-1">
        {state}
      </span>
    </span>
  </Button>
);

const SimpleInventoryButton = ({
  selected,
  title,
  description,
  source,
  state,
  onClick,
}: InventoryRowButtonProps): JSX.Element => (
  <button
    type="button"
    className={`border-border bg-card/50 hover:bg-muted flex w-full items-start justify-between gap-4 rounded-md border px-4 py-3 text-left ${selected ? 'ring-ring/50 ring-1' : ''}`}
    onClick={onClick}
  >
    <span className="min-w-0">
      <span className="text-foreground block text-sm font-medium">{title}</span>
      <span className="text-muted-foreground mt-1 block text-xs leading-relaxed">{description}</span>
      <span className="text-muted-foreground mt-2 block text-xs">Source: {source}</span>
    </span>
    <span className="text-muted-foreground shrink-0 rounded-sm border border-border/60 px-2 py-1 text-xs">
      {state}
    </span>
  </button>
);

const SummaryCard = ({
  title,
  description,
  source,
  state,
}: Readonly<{ title: string; description: string; source: string; state: string }>): JSX.Element => (
  <div className="border-border/50 bg-card/50 rounded-md border px-4 py-3">
    <p className="text-foreground text-sm font-medium">{title}</p>
    <p className="text-muted-foreground mt-1 text-xs">{description}</p>
    <p className="text-muted-foreground mt-2 text-xs">Source: {source}</p>
    <p className="text-muted-foreground mt-1 text-xs">State: {state}</p>
  </div>
);

const AgentDetail = ({
  detail,
  canEdit,
  onEdit,
}: Readonly<{
  detail: CodexAgentDetail;
  canEdit: boolean;
  onEdit: () => void;
}>): JSX.Element => (
  <div className="flex flex-col gap-3 px-4 py-3">
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div>
        <p className="text-foreground text-sm font-medium">{detail.agent.name}</p>
        <p className="text-muted-foreground mt-1 text-xs">{detail.agent.identity.relativePath}</p>
      </div>
      <Button type="button" variant="outline" size="sm" disabled={!canEdit} onClick={onEdit}>
        <Pencil className="size-3.5" />
        Edit developer instructions
      </Button>
    </div>

    <p className="text-muted-foreground text-xs">
      All values below are untrusted local metadata. Declared tools, MCP servers, and skills are
      shown as unresolved names; nothing is loaded or run.
    </p>
    {detail.truncated && (
      <p className="text-amber-400 text-xs">The detail read was truncated, so editing is disabled.</p>
    )}
    <div className="grid gap-2 sm:grid-cols-3">
      <Metadata label="State" value={codexStateLabel(detail.agent.state)} />
      <Metadata label="Model" value={detail.agent.model ?? 'Unset'} />
      <Metadata label="Effort" value={detail.agent.effort ?? 'Unset'} />
      <Metadata label="Sandbox" value={detail.agent.sandboxMode ?? 'Unset'} />
      <Metadata label="Revision" value={detail.exactRevision} mono />
    </div>
    <CodexDiagnostics diagnostics={detail.agent.diagnostics} />
    {detail.agent.declaredCapabilities.length > 0 && (
      <div className="border-border/50 bg-card/50 rounded-md border px-3 py-2">
        <p className="text-muted-foreground text-[10px] font-medium uppercase tracking-wide">
          Unresolved declarations
        </p>
        <ul className="mt-1 space-y-1">
          {detail.agent.declaredCapabilities.map((capability, index) => (
            <li key={`${capability.kind}-${capability.name}-${index}`} className="text-muted-foreground text-xs">
              {capability.kind}: {capability.name}
            </li>
          ))}
        </ul>
      </div>
    )}
    {detail.developerInstructions ? (
      <MarkdownViewer
        content={detail.developerInstructions}
        label="Untrusted developer instructions"
        maxHeight="max-h-80"
      />
    ) : (
      <p className="text-muted-foreground text-xs">No developer instructions were found.</p>
    )}
  </div>
);

const InstructionDetail = ({
  detail,
  canEdit,
  onEdit,
}: Readonly<{
  detail: CodexInstructionDetail;
  canEdit: boolean;
  onEdit: () => void;
}>): JSX.Element => (
  <div className="flex flex-col gap-3 px-4 py-3">
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div>
        <p className="text-foreground text-sm font-medium">{detail.source.identity.label}</p>
        <p className="text-muted-foreground mt-1 text-xs">{detail.source.identity.relativePath}</p>
      </div>
      <Button type="button" variant="outline" size="sm" disabled={!canEdit} onClick={onEdit}>
        <Pencil className="size-3.5" />
        Edit instructions
      </Button>
    </div>
    {detail.truncated && (
      <p className="text-amber-400 text-xs">The detail read was truncated, so editing is disabled.</p>
    )}
    <div className="grid gap-2 sm:grid-cols-3">
      <Metadata label="State" value={codexStateLabel(detail.source.state)} />
      <Metadata label="Active" value={detail.source.active ? 'Yes' : 'No'} />
      <Metadata label="Priority" value={String(detail.source.priority)} />
      <Metadata label="Revision" value={detail.exactRevision} mono />
    </div>
    <CodexDiagnostics diagnostics={detail.source.diagnostics} />
    <MarkdownViewer
      content={detail.content}
      label="Untrusted instruction content"
      maxHeight="max-h-[32rem]"
    />
  </div>
);

const Metadata = ({
  label,
  value,
  mono = false,
}: Readonly<{ label: string; value: string; mono?: boolean }>): JSX.Element => (
  <div className="border-border/50 bg-card/50 rounded-md border px-3 py-2">
    <p className="text-muted-foreground text-[10px]">{label}</p>
    <p className={`text-foreground mt-1 break-all text-xs ${mono ? 'font-mono' : ''}`}>{value}</p>
  </div>
);

const EmptyInventory = ({ message }: Readonly<{ message: string }>): JSX.Element => (
  <p className="text-muted-foreground px-1 pt-1 text-xs">{message}</p>
);
