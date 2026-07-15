import { JSX, useEffect, useRef } from 'react';
import { api } from '@renderer/api';
import { Button } from '@renderer/components/ui/button';
import { Trash2 } from 'lucide-react';

import { ConfigEditorShell } from '../maintenance/ConfigEditorShell';
import { useFileBackedEditor } from '../maintenance/useFileBackedEditor';

import type { AgentPatch } from '@shared/types/api';

// Model aliases/IDs seen in the wild — mirrors the Go KnownAgentModels list (a
// Go var isn't reachable through bindings). An unknown model is a non-blocking
// warning, never a hard block: new models appear over time.
const KNOWN_AGENT_MODELS = [
  'opus',
  'sonnet',
  'haiku',
  'inherit',
  'claude-opus-4-8',
  'claude-sonnet-5',
  'claude-haiku-4-5',
];

interface AgentFields {
  name: string;
  description: string;
  tools: string;
  model: string;
  body: string;
}

const EMPTY_FIELDS: AgentFields = { name: '', description: '', tools: '', model: '', body: '' };

function fileBaseOf(filePath: string): string {
  const base = filePath.split('/').pop() ?? filePath;
  return base.endsWith('.md') ? base.slice(0, -3) : base;
}

function unquote(value: string): string {
  return value.length >= 2 && value.startsWith('"') && value.endsWith('"')
    ? value.slice(1, -1)
    : value;
}

// Mirrors the backend's CreateAgent escaping so a changed description round-
// trips through the naive line-level frontmatter writer.
function quoteDescription(value: string): string {
  const escaped = value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return `"${escaped}"`;
}

// Splits an agent .md into typed frontmatter fields + body using the same fence
// boundary the Go parser uses (leading whitespace, "---", first "\n---" close).
function parseAgentContent(content: string): AgentFields {
  let lead = 0;
  while (lead < content.length && /\s/.test(content[lead])) lead++;
  const afterLead = content.slice(lead);
  if (!afterLead.startsWith('---')) return { ...EMPTY_FIELDS, body: content };

  const rest = afterLead.slice(3);
  const end = rest.indexOf('\n---');
  if (end < 0) return { ...EMPTY_FIELDS, body: content };

  const block = rest.slice(0, end);
  const closeAndAfter = rest.slice(end);
  const afterFence = closeAndAfter.slice('\n---'.length);
  const nl = afterFence.indexOf('\n');
  const body = nl < 0 ? '' : afterFence.slice(nl + 1);

  const fields: AgentFields = { ...EMPTY_FIELDS, body };
  for (const line of block.split('\n')) {
    const trimmed = line.trim();
    const ci = trimmed.indexOf(':');
    if (ci < 0) continue;
    const key = trimmed.slice(0, ci).trim();
    const val = trimmed.slice(ci + 1).trim();
    if (key === 'name') fields.name = val;
    else if (key === 'description') fields.description = unquote(val);
    else if (key === 'tools') fields.tools = val;
    else if (key === 'model') fields.model = val;
  }
  return fields;
}

function serialize(fields: AgentFields): string {
  return JSON.stringify({
    name: fields.name,
    description: fields.description,
    tools: fields.tools,
    model: fields.model,
    body: fields.body,
  });
}

function deserialize(value: string): AgentFields {
  try {
    return { ...EMPTY_FIELDS, ...(JSON.parse(value) as Partial<AgentFields>) };
  } catch {
    return { ...EMPTY_FIELDS };
  }
}

function buildPatch(baseline: AgentFields, current: AgentFields): AgentPatch {
  const patch: AgentPatch = {};
  if (current.name !== baseline.name) patch.name = current.name;
  if (current.description !== baseline.description) {
    patch.description = quoteDescription(current.description);
  }
  if (current.tools !== baseline.tools) patch.tools = current.tools;
  if (current.model !== baseline.model) patch.model = current.model;
  if (current.body !== baseline.body) patch.body = current.body;
  return patch;
}

interface AgentDetailEditorProps {
  fileBase: string;
  canAct: boolean;
  onSaved: () => void;
  onDirtyChange: (dirty: boolean) => void;
  onRequestDelete: () => void;
}

// Bound to one agent via the parent's key={fileBase} — remounts (and reloads
// fresh) on every selection change, mirroring InstructionFileEditor. The multi-
// field form is packed into useFileBackedEditor's single string buffer as JSON
// so dirty-tracking, save, and error surfacing come for free.
export const AgentDetailEditor = ({
  fileBase,
  canAct,
  onSaved,
  onDirtyChange,
  onRequestDelete,
}: Readonly<AgentDetailEditorProps>): JSX.Element => {
  const baselineRef = useRef<AgentFields>(EMPTY_FIELDS);

  const { value, setValue, dirty, error, saving, loading, save, discard } = useFileBackedEditor({
    load: async () => {
      const agents = await api.maintenance.listManagedAgents();
      const agent = agents.find((a) => fileBaseOf(a.filePath) === fileBase);
      if (!agent) throw new Error(`Agent "${fileBase}" not found`);
      const fields = parseAgentContent(agent.content);
      baselineRef.current = fields;
      return serialize(fields);
    },
    save: async (v) => {
      const patch = buildPatch(baselineRef.current, deserialize(v));
      await api.maintenance.patchAgentFrontmatter(fileBase, patch);
    },
  });

  useEffect(() => {
    onDirtyChange(dirty);
  }, [dirty, onDirtyChange]);

  if (loading) {
    return <p className="text-muted-foreground px-4 py-3 text-xs">Loading…</p>;
  }

  const fields = deserialize(value);
  const update = (patch: Partial<AgentFields>): void => setValue(serialize({ ...fields, ...patch }));
  const modelKnown = fields.model === '' || KNOWN_AGENT_MODELS.includes(fields.model);
  const modelOptions = modelKnown ? KNOWN_AGENT_MODELS : [...KNOWN_AGENT_MODELS, fields.model];

  const handleSave = async (): Promise<void> => {
    await save();
    onSaved();
  };

  return (
    <ConfigEditorShell
      title={`${fileBase}.md`}
      dirty={dirty}
      saving={saving}
      error={error}
      onSave={() => void handleSave()}
      onDiscard={discard}
      canAct={canAct}
    >
      <div className="flex flex-col gap-3 px-4 py-3">
        <div className="flex justify-end">
          <Button variant="destructive" size="sm" disabled={!canAct} onClick={onRequestDelete}>
            <Trash2 className="size-3.5" />
            Delete
          </Button>
        </div>

        <label className="flex flex-col gap-1">
          <span className="text-muted-foreground text-xs">name</span>
          <input
            value={fields.name}
            disabled={!canAct}
            onChange={(e) => update({ name: e.target.value })}
            className="border-border/50 bg-card/50 text-foreground rounded-md border px-2 py-1 text-xs"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-muted-foreground text-xs">description</span>
          <input
            value={fields.description}
            disabled={!canAct}
            onChange={(e) => update({ description: e.target.value })}
            className="border-border/50 bg-card/50 text-foreground rounded-md border px-2 py-1 text-xs"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-muted-foreground text-xs">
            tools <span className="text-muted-foreground/70">(comma-separated, blank = unset)</span>
          </span>
          <input
            value={fields.tools}
            disabled={!canAct}
            placeholder="unset"
            onChange={(e) => update({ tools: e.target.value })}
            className="border-border/50 bg-card/50 text-foreground rounded-md border px-2 py-1 font-mono text-xs"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-muted-foreground text-xs">model</span>
          <select
            value={fields.model}
            disabled={!canAct}
            onChange={(e) => update({ model: e.target.value })}
            className="border-border/50 bg-card/50 text-foreground rounded-md border px-2 py-1 text-xs"
          >
            <option value="">unset</option>
            {modelOptions.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
          {!modelKnown && (
            <span className="text-[11px] text-amber-500">
              Unknown model &quot;{fields.model}&quot; — saved as-is; verify it is a valid Claude
              Code model.
            </span>
          )}
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-muted-foreground text-xs">system prompt (body)</span>
          <textarea
            value={fields.body}
            disabled={!canAct}
            spellCheck={false}
            onChange={(e) => update({ body: e.target.value })}
            className="border-border/50 bg-card/50 text-foreground min-h-[300px] w-full rounded-md border p-3 font-mono text-xs leading-relaxed"
          />
        </label>
      </div>
    </ConfigEditorShell>
  );
};
