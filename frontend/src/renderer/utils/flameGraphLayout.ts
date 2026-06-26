import type { AIChunk, Chunk, Process, ToolExecution } from '@shared/types/chunks';

export type ToolCategory = 'bash' | 'edit' | 'read' | 'search' | 'task' | 'fetch' | 'other';

export interface FlameBar {
  id: string;
  label: string;
  category: ToolCategory;
  depth: number;
  startMs: number;
  endMs: number;
  durationMs: number;
  isError: boolean;
  /** Parent task-tool id for subagent-spawned tools. */
  parentId?: string;
}

export interface FlameGraphLayout {
  bars: FlameBar[];
  sessionStartMs: number;
  sessionEndMs: number;
  maxDepth: number;
}

const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
const READ_TOOLS = new Set(['Read', 'NotebookRead']);
const SEARCH_TOOLS = new Set(['Grep', 'Glob']);
const FETCH_TOOLS = new Set(['WebFetch', 'WebSearch']);

export function classifyTool(name: string): ToolCategory {
  if (name === 'Bash') return 'bash';
  if (EDIT_TOOLS.has(name)) return 'edit';
  if (READ_TOOLS.has(name)) return 'read';
  if (SEARCH_TOOLS.has(name)) return 'search';
  if (FETCH_TOOLS.has(name)) return 'fetch';
  if (name === 'Task') return 'task';
  return 'other';
}

function toMs(date: Date | number): number {
  return date instanceof Date ? date.getTime() : date;
}

function execEndMs(exec: ToolExecution): number {
  if (exec.endTime) return toMs(exec.endTime);
  const dur = exec.durationMs ?? 0;
  return toMs(exec.startTime) + dur;
}

function execToBar(exec: ToolExecution, depth: number, parentId?: string): FlameBar {
  const start = toMs(exec.startTime);
  const end = execEndMs(exec);
  return {
    id: exec.toolCall.id,
    label: exec.toolCall.name,
    category: classifyTool(exec.toolCall.name),
    depth,
    startMs: start,
    endMs: Math.max(end, start + 1),
    durationMs: Math.max(end - start, 0),
    isError: exec.result?.isError ?? false,
    parentId,
  };
}

/**
 * Walk a subagent Process, pulling tool_use/tool_result pairs from its message
 * stream into FlameBars nested under `depth`. Unresolved tool_use calls are
 * emitted as open-ended bars ending at the process end.
 */
function subagentBars(process: Process, depth: number, parentId: string): FlameBar[] {
  const bars: FlameBar[] = [];
  const pending = new Map<string, { name: string; startMs: number }>();

  for (const msg of process.messages) {
    const ts = msg.timestamp instanceof Date ? msg.timestamp.getTime() : null;
    if (ts === null) continue;

    if (!Array.isArray(msg.content)) continue;

    for (const block of msg.content) {
      if (!block || typeof block !== 'object' || !('type' in block)) continue;
      const typedBlock = block as {
        type: string;
        id?: string;
        name?: string;
        tool_use_id?: string;
        is_error?: boolean;
      };

      if (typedBlock.type === 'tool_use' && typedBlock.id && typedBlock.name) {
        pending.set(typedBlock.id, { name: typedBlock.name, startMs: ts });
      } else if (typedBlock.type === 'tool_result' && typedBlock.tool_use_id) {
        const pend = pending.get(typedBlock.tool_use_id);
        if (pend) {
          bars.push({
            id: `${process.id}-${typedBlock.tool_use_id}`,
            label: pend.name,
            category: classifyTool(pend.name),
            depth,
            startMs: pend.startMs,
            endMs: Math.max(ts, pend.startMs + 1),
            durationMs: Math.max(ts - pend.startMs, 0),
            isError: typedBlock.is_error ?? false,
            parentId,
          });
          pending.delete(typedBlock.tool_use_id);
        }
      }
    }
  }

  const endFallback = process.endTime instanceof Date ? process.endTime.getTime() : Date.now();
  for (const [id, pend] of pending) {
    bars.push({
      id: `${process.id}-${id}`,
      label: pend.name,
      category: classifyTool(pend.name),
      depth,
      startMs: pend.startMs,
      endMs: Math.max(endFallback, pend.startMs + 1),
      durationMs: Math.max(endFallback - pend.startMs, 0),
      isError: false,
      parentId,
    });
  }

  return bars;
}

export interface BuildFlameLayoutInput {
  chunks: Chunk[];
}

function isAIChunk(chunk: Chunk): chunk is AIChunk {
  return chunk.chunkType === 'ai';
}

/**
 * Flatten tool executions and subagent-spawned tool calls into depth-layered
 * flame bars. Depth 0 = main-session tools + Task tool_use; depth 1 = tools
 * spawned inside a subagent.
 */
export function buildFlameLayout({ chunks }: BuildFlameLayoutInput): FlameGraphLayout {
  const bars: FlameBar[] = [];
  let minStart = Number.POSITIVE_INFINITY;
  let maxEnd = Number.NEGATIVE_INFINITY;

  for (const chunk of chunks) {
    if (!isAIChunk(chunk)) continue;

    // Build set of Task tool_use ids that have matching processes so we can
    // dedup them — processes carry the authoritative subagent duration.
    const resolvedTaskIds = new Set<string>();
    for (const proc of chunk.processes) {
      if (proc.parentTaskId) resolvedTaskIds.add(proc.parentTaskId);
    }

    for (const exec of chunk.toolExecutions) {
      if (exec.toolCall.name === 'Task' && resolvedTaskIds.has(exec.toolCall.id)) continue;
      const bar = execToBar(exec, 0);
      bars.push(bar);
      if (bar.startMs < minStart) minStart = bar.startMs;
      if (bar.endMs > maxEnd) maxEnd = bar.endMs;
    }

    for (const proc of chunk.processes) {
      const start = toMs(proc.startTime);
      const end = Math.max(toMs(proc.endTime), start + 1);
      const parentId = proc.parentTaskId ?? proc.id;
      const parentBar: FlameBar = {
        id: parentId,
        label: `Task: ${proc.subagentType ?? 'subagent'}`,
        category: 'task',
        depth: 0,
        startMs: start,
        endMs: end,
        durationMs: proc.durationMs,
        isError: false,
      };
      bars.push(parentBar);
      if (parentBar.startMs < minStart) minStart = parentBar.startMs;
      if (parentBar.endMs > maxEnd) maxEnd = parentBar.endMs;

      for (const child of subagentBars(proc, 1, parentBar.id)) {
        bars.push(child);
        if (child.startMs < minStart) minStart = child.startMs;
        if (child.endMs > maxEnd) maxEnd = child.endMs;
      }
    }
  }

  if (!Number.isFinite(minStart) || !Number.isFinite(maxEnd)) {
    return { bars: [], sessionStartMs: 0, sessionEndMs: 0, maxDepth: 0 };
  }

  bars.sort((a, b) => a.startMs - b.startMs || a.depth - b.depth);

  let maxDepth = 0;
  for (const bar of bars) {
    if (bar.depth > maxDepth) maxDepth = bar.depth;
  }

  return {
    bars,
    sessionStartMs: minStart,
    sessionEndMs: maxEnd,
    maxDepth,
  };
}
