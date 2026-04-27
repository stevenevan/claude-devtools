/**
 * Build a hierarchical team tree from a flat Process list.
 *
 * Each team becomes a root node with its members as children. Nested subagent
 * spawns (Process.parentTaskId pointing to another process's Task call) hang
 * off the originating member. Orphan processes (no team, no parent) are
 * emitted as top-level `solo` nodes so the tree is a complete view of
 * session-level coordination.
 */

import type { Process } from '@shared/types/chunks';

export type TeamNodeKind = 'team' | 'member' | 'solo';

export interface TeamTreeNode {
  id: string;
  kind: TeamNodeKind;
  /** Display label (team name for team, member name / subagentType for member). */
  label: string;
  /** Process backing this node, if any. Team root nodes have no process. */
  process?: Process;
  /** Dot color (hex or CSS colour token). */
  color?: string;
  status: 'active' | 'completed';
  toolCount: number;
  children: TeamTreeNode[];
}

function countToolUses(p: Process): number {
  let count = 0;
  for (const msg of p.messages) {
    if (Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if ((block as { type?: string })?.type === 'tool_use') count++;
      }
    }
  }
  return count;
}

function processStatus(p: Process): 'active' | 'completed' {
  return p.isOngoing ? 'active' : 'completed';
}

export function buildTeamTree(processes: Process[]): TeamTreeNode[] {
  // Group processes: (a) by team name if present; (b) leftover soloists.
  const teams = new Map<string, Process[]>();
  const soloists: Process[] = [];
  for (const p of processes) {
    if (p.team?.teamName) {
      const list = teams.get(p.team.teamName) ?? [];
      list.push(p);
      teams.set(p.team.teamName, list);
    } else {
      soloists.push(p);
    }
  }

  const allRoots: TeamTreeNode[] = [];

  // For each team, build members and attach nested subagents.
  for (const [teamName, members] of teams.entries()) {
    const memberNodes: TeamTreeNode[] = members.map((m) => ({
      id: `member:${m.id}`,
      kind: 'member',
      label: m.team?.memberName ?? m.subagentType ?? m.id.slice(0, 8),
      process: m,
      color: m.team?.memberColor,
      status: processStatus(m),
      toolCount: countToolUses(m),
      children: [],
    }));

    // Attach nested child processes to their parent task owner.
    attachNested(members, memberNodes);

    allRoots.push({
      id: `team:${teamName}`,
      kind: 'team',
      label: teamName,
      status: memberNodes.some((m) => m.status === 'active') ? 'active' : 'completed',
      toolCount: memberNodes.reduce((s, m) => s + m.toolCount, 0),
      children: memberNodes,
    });
  }

  for (const p of soloists) {
    allRoots.push({
      id: `solo:${p.id}`,
      kind: 'solo',
      label: p.subagentType ?? p.description ?? p.id.slice(0, 8),
      process: p,
      status: processStatus(p),
      toolCount: countToolUses(p),
      children: [],
    });
  }

  return allRoots;
}

/**
 * For processes that have `parentTaskId` matching some tool_use inside another
 * process's message stream, attach them as children of that owning member
 * node.
 */
function attachNested(processes: Process[], memberNodes: TeamTreeNode[]): void {
  const nodeByProcessId = new Map<string, TeamTreeNode>();
  for (const node of memberNodes) {
    if (node.process) nodeByProcessId.set(node.process.id, node);
  }

  // Build a reverse index: tool_use id → owning process id.
  const toolUseOwner = new Map<string, string>();
  for (const p of processes) {
    for (const msg of p.messages) {
      if (Array.isArray(msg.content)) {
        for (const block of msg.content) {
          const b = block as { type?: string; id?: string };
          if (b.type === 'tool_use' && b.id) {
            toolUseOwner.set(b.id, p.id);
          }
        }
      }
    }
  }

  // Move nested nodes under their parent member.
  for (const p of processes) {
    if (!p.parentTaskId) continue;
    const ownerProcessId = toolUseOwner.get(p.parentTaskId);
    if (!ownerProcessId || ownerProcessId === p.id) continue;
    const parentNode = nodeByProcessId.get(ownerProcessId);
    const childNode = nodeByProcessId.get(p.id);
    if (!parentNode || !childNode) continue;
    // Remove from the top-level list by marking (caller still has all of them in
    // memberNodes; we only mutate .children here. To avoid duplicates we also
    // drop from the current parent if it accidentally had them.)
    if (!parentNode.children.includes(childNode)) {
      parentNode.children.push(childNode);
    }
  }
}
