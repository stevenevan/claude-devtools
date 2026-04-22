import { describe, it, expect } from 'vitest';

import { buildFlameLayout, classifyTool } from '../../../src/renderer/utils/flameGraphLayout';

import type {
  AIChunk,
  Process,
  SessionMetrics,
  ToolExecution,
} from '../../../src/shared/types/chunks';
import type { ContentBlock } from '../../../src/shared/types/jsonl';
import type { ParsedMessage } from '../../../src/shared/types/messages';

function emptyMetrics(): SessionMetrics {
  return {
    totalTokens: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    durationMs: 0,
    costUsd: 0,
    toolCallCount: 0,
    assistantMessageCount: 0,
    userMessageCount: 0,
    errorCount: 0,
  };
}

function makeExec(
  id: string,
  name: string,
  startMs: number,
  endMs: number,
  isError = false
): ToolExecution {
  return {
    toolCall: { id, name, input: {}, isTask: name === 'Task' },
    result: { toolUseId: id, content: '', isError },
    startTime: new Date(startMs),
    endTime: new Date(endMs),
    durationMs: endMs - startMs,
  };
}

function makeProcess(
  id: string,
  startMs: number,
  endMs: number,
  messages: ParsedMessage[],
  parentTaskId?: string,
  subagentType = 'Explore'
): Process {
  return {
    id,
    filePath: `/tmp/${id}.jsonl`,
    messages,
    startTime: new Date(startMs),
    endTime: new Date(endMs),
    durationMs: endMs - startMs,
    metrics: emptyMetrics(),
    subagentType,
    isParallel: false,
    parentTaskId,
    isOngoing: false,
  };
}

function makeToolUseMsg(id: string, name: string, ts: number): ParsedMessage {
  const block: ContentBlock = { type: 'tool_use', id, name, input: {} };
  return {
    uuid: `use-${id}`,
    parentUuid: null,
    type: 'assistant',
    timestamp: new Date(ts),
    content: [block],
  };
}

function makeToolResultMsg(toolUseId: string, ts: number, isError = false): ParsedMessage {
  const block: ContentBlock = {
    type: 'tool_result',
    tool_use_id: toolUseId,
    content: '',
    is_error: isError,
  };
  return {
    uuid: `res-${toolUseId}`,
    parentUuid: null,
    type: 'user',
    timestamp: new Date(ts),
    content: [block],
  };
}

function makeAIChunk(toolExecutions: ToolExecution[], processes: Process[]): AIChunk {
  return {
    chunkType: 'ai',
    id: 'ai-1',
    startTime: new Date(0),
    endTime: new Date(1000),
    durationMs: 1000,
    metrics: emptyMetrics(),
    responses: [],
    processes,
    sidechainMessages: [],
    toolExecutions,
  };
}

describe('classifyTool', () => {
  it('classifies Bash as bash', () => {
    expect(classifyTool('Bash')).toBe('bash');
  });

  it('classifies Edit/Write as edit', () => {
    expect(classifyTool('Edit')).toBe('edit');
    expect(classifyTool('Write')).toBe('edit');
  });

  it('falls back to other for unknown tools', () => {
    expect(classifyTool('Unknown')).toBe('other');
  });
});

describe('buildFlameLayout', () => {
  it('returns empty layout when no AI chunks present', () => {
    const layout = buildFlameLayout({ chunks: [] });
    expect(layout.bars).toEqual([]);
    expect(layout.maxDepth).toBe(0);
    expect(layout.sessionStartMs).toBe(0);
  });

  it('emits depth 0 bars for tool executions, sorted by start', () => {
    const chunk = makeAIChunk(
      [makeExec('t2', 'Read', 300, 500), makeExec('t1', 'Bash', 100, 200)],
      []
    );
    const layout = buildFlameLayout({ chunks: [chunk] });
    expect(layout.bars).toHaveLength(2);
    expect(layout.bars[0].id).toBe('t1');
    expect(layout.bars[1].id).toBe('t2');
    expect(layout.sessionStartMs).toBe(100);
    expect(layout.sessionEndMs).toBe(500);
    expect(layout.maxDepth).toBe(0);
  });

  it('nests subagent-spawned tools at depth 1 with gaps handled', () => {
    const subagentMessages: ParsedMessage[] = [
      makeToolUseMsg('child-1', 'Read', 250),
      makeToolResultMsg('child-1', 280),
      // gap until next call
      makeToolUseMsg('child-2', 'Bash', 400),
      makeToolResultMsg('child-2', 420),
    ];
    const proc = makeProcess('proc-a', 200, 500, subagentMessages, 'task-1');
    const chunk = makeAIChunk(
      [makeExec('task-1', 'Task', 200, 500), makeExec('t-direct', 'Bash', 10, 30)],
      [proc]
    );
    const layout = buildFlameLayout({ chunks: [chunk] });

    const taskBars = layout.bars.filter((b) => b.category === 'task');
    expect(taskBars).toHaveLength(1); // the Task tool_use is deduped since proc links to it

    const depthOne = layout.bars.filter((b) => b.depth === 1);
    expect(depthOne).toHaveLength(2);
    expect(depthOne.map((b) => b.label).sort()).toEqual(['Bash', 'Read']);
    expect(depthOne.every((b) => b.parentId === 'task-1')).toBe(true);
    expect(layout.maxDepth).toBe(1);
  });

  it('keeps orphan Task calls when no matching subagent exists', () => {
    const chunk = makeAIChunk([makeExec('orphan-task', 'Task', 10, 20)], []);
    const layout = buildFlameLayout({ chunks: [chunk] });
    expect(layout.bars).toHaveLength(1);
    expect(layout.bars[0].category).toBe('task');
    expect(layout.bars[0].id).toBe('orphan-task');
  });

  it('emits open-ended child bars for unresolved tool_use calls', () => {
    const subagentMessages: ParsedMessage[] = [makeToolUseMsg('c-open', 'Read', 150)];
    const proc = makeProcess('proc-b', 100, 600, subagentMessages, 'task-2');
    const chunk = makeAIChunk([], [proc]);
    const layout = buildFlameLayout({ chunks: [chunk] });

    const child = layout.bars.find((b) => b.label === 'Read' && b.depth === 1);
    expect(child).toBeDefined();
    // endMs should fall back to process end (600)
    expect(child?.endMs).toBe(600);
  });
});
