/**
 * subagentTreeLayout — builds an N-level nested process tree from a flat
 * Process list using `parentTaskId` → owning tool_use id on a parent
 * process. Used by the spawn-tree explorer (sprint 31) to replace the old
 * 2-level rendering.
 */

import type { Process } from '@shared/types/chunks';

export interface SubagentTreeNode {
  process: Process;
  toolUseCount: number;
  children: SubagentTreeNode[];
}

function countToolUses(p: Process): number {
  let total = 0;
  for (const msg of p.messages) {
    if (!Array.isArray(msg.content)) continue;
    for (const block of msg.content) {
      if ((block as { type?: string }).type === 'tool_use') total++;
    }
  }
  return total;
}

/** Build a reverse index: tool_use id → owning process id. */
function buildToolUseOwnerIndex(processes: Process[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const p of processes) {
    for (const msg of p.messages) {
      if (!Array.isArray(msg.content)) continue;
      for (const block of msg.content) {
        const b = block as { type?: string; id?: string };
        if (b.type === 'tool_use' && b.id) {
          map.set(b.id, p.id);
        }
      }
    }
  }
  return map;
}

export interface BuildOptions {
  /** When true, hide subagents with zero tool calls from the returned tree. */
  hideEmpty?: boolean;
}

export function buildSubagentTree(
  processes: Process[],
  options: BuildOptions = {}
): SubagentTreeNode[] {
  const nodes = new Map<string, SubagentTreeNode>();
  for (const p of processes) {
    nodes.set(p.id, { process: p, toolUseCount: countToolUses(p), children: [] });
  }

  const toolUseOwner = buildToolUseOwnerIndex(processes);

  const roots: SubagentTreeNode[] = [];
  for (const p of processes) {
    const node = nodes.get(p.id);
    if (!node) continue;

    if (p.parentTaskId) {
      const ownerProcessId = toolUseOwner.get(p.parentTaskId);
      if (ownerProcessId && ownerProcessId !== p.id) {
        const parent = nodes.get(ownerProcessId);
        if (parent) {
          parent.children.push(node);
          continue;
        }
      }
    }
    roots.push(node);
  }

  // Stable sort within each level by start time (oldest first).
  function sortRec(list: SubagentTreeNode[]): void {
    list.sort(
      (a, b) =>
        new Date(a.process.startTime).getTime() - new Date(b.process.startTime).getTime()
    );
    for (const n of list) sortRec(n.children);
  }
  sortRec(roots);

  if (options.hideEmpty) {
    return filterEmpty(roots);
  }
  return roots;
}

/** Drop nodes with zero tool uses and no surviving descendants. */
function filterEmpty(nodes: SubagentTreeNode[]): SubagentTreeNode[] {
  const out: SubagentTreeNode[] = [];
  for (const node of nodes) {
    const filteredChildren = filterEmpty(node.children);
    if (node.toolUseCount > 0 || filteredChildren.length > 0) {
      out.push({ ...node, children: filteredChildren });
    }
  }
  return out;
}

/** Walk tree counting total nodes (for tests + display). */
export function totalNodes(nodes: SubagentTreeNode[]): number {
  let count = 0;
  for (const n of nodes) {
    count += 1 + totalNodes(n.children);
  }
  return count;
}

/** Compute max depth of the tree (0 when empty, 1 for single-level). */
export function maxDepth(nodes: SubagentTreeNode[]): number {
  if (nodes.length === 0) return 0;
  let max = 0;
  for (const n of nodes) {
    const childDepth = maxDepth(n.children);
    if (childDepth + 1 > max) max = childDepth + 1;
  }
  return max;
}
