import { JSX } from 'react';
import { sanitizeSimpleText } from '@renderer/utils/simpleTextSanitizer';

import type { TaskNode } from '@shared/types/api';

export type TaskOutlineAnomalyType =
  | 'cycle'
  | 'missing-reference'
  | 'depth-cap'
  | 'duplicate-id';

export interface TaskOutlineAnomaly {
  type: TaskOutlineAnomalyType;
}

export interface TaskOutlineItem {
  node: TaskNode;
  depth: number;
  children: TaskOutlineItem[];
  alternateParents: string[];
}

export interface TaskOutlineResult {
  roots: TaskOutlineItem[];
  other: TaskOutlineItem[];
  anomalies: TaskOutlineAnomaly[];
}

interface EdgeMaps {
  children: Map<string, Set<string>>;
  parents: Map<string, Set<string>>;
}

function addAnomaly(
  anomalies: Set<TaskOutlineAnomalyType>,
  type: TaskOutlineAnomalyType
): void {
  anomalies.add(type);
}

function canonicalEdges(nodes: readonly TaskNode[], anomalies: Set<TaskOutlineAnomalyType>): EdgeMaps {
  const ids = new Set(nodes.map((node) => node.id));
  const children = new Map<string, Set<string>>();
  const parents = new Map<string, Set<string>>();

  for (const node of nodes) {
    children.set(node.id, new Set());
    parents.set(node.id, new Set());
  }

  const addEdge = (parentId: string, childId: string): void => {
    if (!ids.has(parentId) || !ids.has(childId)) {
      addAnomaly(anomalies, 'missing-reference');
      return;
    }
    children.get(parentId)?.add(childId);
    parents.get(childId)?.add(parentId);
  };

  for (const node of nodes) {
    for (const childId of node.blocks) addEdge(node.id, childId);
    for (const parentId of node.blockedBy) addEdge(parentId, node.id);
  }

  return { children, parents };
}

function findCycle(
  ids: readonly string[],
  children: ReadonlyMap<string, ReadonlySet<string>>
): boolean {
  const remaining = new Set(ids);
  const indegree = new Map<string, number>(ids.map((id) => [id, 0]));

  for (const parentId of remaining) {
    for (const childId of children.get(parentId) ?? []) {
      if (remaining.has(childId)) indegree.set(childId, (indegree.get(childId) ?? 0) + 1);
    }
  }

  const queue = ids.filter((id) => remaining.has(id) && indegree.get(id) === 0);
  let queueIndex = 0;
  let processed = 0;
  while (queueIndex < queue.length) {
    const parentId = queue[queueIndex++];
    if (parentId === undefined) continue;
    processed += 1;
    for (const childId of children.get(parentId) ?? []) {
      if (!remaining.has(childId)) continue;
      const next = (indegree.get(childId) ?? 0) - 1;
      indegree.set(childId, next);
      if (next === 0) queue.push(childId);
    }
  }

  return processed < remaining.size;
}

export function buildTaskOutline(nodes: readonly TaskNode[]): TaskOutlineResult {
  const anomalies = new Set<TaskOutlineAnomalyType>();
  const nodeById = new Map<string, TaskNode>();
  const order = new Map<string, number>();

  nodes.forEach((node, index) => {
    if (nodeById.has(node.id)) {
      addAnomaly(anomalies, 'duplicate-id');
      return;
    }
    nodeById.set(node.id, node);
    order.set(node.id, index);
  });

  const ids = [...nodeById.keys()];
  const { children, parents } = canonicalEdges([...nodeById.values()], anomalies);
  const roots = ids.filter(
    (id) =>
      (parents.get(id)?.size ?? 0) === 0 &&
      (children.get(id)?.size ?? 0) > 0
  );
  const depth = new Map<string, number>();
  const primaryParents = new Map<string, string>();
  const alternateParentsById = new Map<string, string[]>();
  const queue = [...roots];
  let queueIndex = 0;
  const maxDepth = Math.max(ids.length, 1);

  roots.forEach((id) => depth.set(id, 0));
  while (queueIndex < queue.length) {
    const parentId = queue[queueIndex++];
    if (parentId === undefined) continue;
    const parentDepth = depth.get(parentId) ?? 0;
    const childIds = [...(children.get(parentId) ?? [])].sort(
      (a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0)
    );

    for (const childId of childIds) {
      const candidateDepth = parentDepth + 1;
      if (candidateDepth > maxDepth) {
        addAnomaly(anomalies, 'depth-cap');
        continue;
      }
      const currentDepth = depth.get(childId);
      if (currentDepth === undefined || candidateDepth < currentDepth) {
        depth.set(childId, candidateDepth);
        primaryParents.set(childId, parentId);
        queue.push(childId);
      }
    }
  }

  const unreachableIds = ids.filter((id) => !depth.has(id));
  if (unreachableIds.length > 0 && findCycle(unreachableIds, children)) {
    addAnomaly(anomalies, 'cycle');
  }

  for (const id of depth.keys()) {
    const candidateParents = [...(parents.get(id) ?? [])]
      .filter((parentId) => depth.has(parentId) && parentId !== primaryParents.get(id))
      .sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
    if (candidateParents.length > 0) {
      alternateParentsById.set(id, candidateParents);
    }
  }

  const buildItem = (id: string, seen: Set<string>): TaskOutlineItem => {
    const node = nodeById.get(id);
    if (!node) {
      throw new Error(`task outline: missing node ${id}`);
    }
    seen.add(id);
    const alternateParents = alternateParentsById.get(id) ?? [];
    const childIds = [...(children.get(id) ?? [])]
      .filter((childId) => primaryParents.get(childId) === id && !seen.has(childId))
      .sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));

    return {
      node,
      depth: depth.get(id) ?? 0,
      alternateParents,
      children: childIds.map((childId) => buildItem(childId, new Set(seen))),
    };
  };

  const reachableRoots = roots.filter((id) => depth.has(id));
  const reachable = new Set<string>();
  const rootItems = reachableRoots.map((id) => buildItem(id, reachable));
  const otherItems = unreachableIds.map((id) => ({
    node: nodeById.get(id) as TaskNode,
    depth: 0,
    children: [],
    alternateParents: [],
  }));

  return {
    roots: rootItems,
    other: otherItems,
    anomalies: [...anomalies].map((type) => ({ type })),
  };
}

function taskLabel(node: TaskNode, index: number, simple: boolean): string {
  const raw = node.subject.trim() || node.description.trim();
  if (!simple) return raw || node.id || `Step ${index + 1}`;
  return sanitizeSimpleText(raw) || `Step ${index + 1}`;
}

function taskDescription(node: TaskNode, simple: boolean): string | null {
  const description = node.description.trim();
  if (!description) return null;
  return simple ? sanitizeSimpleText(description) : description;
}

function statusLabel(status: string, simple: boolean): string {
  if (status === 'completed') return simple ? 'Done' : 'Completed';
  if (status === 'in_progress') return 'Running';
  if (status === 'pending') return simple ? 'Waiting' : 'Pending';
  return simple ? sanitizeSimpleText(status) || 'Unknown' : status || 'Unknown';
}

function anomalyLabel(type: TaskOutlineAnomalyType, simple: boolean): string {
  if (type === 'cycle') return 'A cycle was found; affected steps are listed under Other steps.';
  if (type === 'missing-reference') return 'Some task links are missing; the remaining steps are shown.';
  if (type === 'depth-cap') return 'The outline reached its safety limit; remaining steps are shown separately.';
  return simple ? 'Some duplicate task records were combined.' : 'Duplicate task records were combined.';
}

interface TaskOutlineBranchProps {
  item: TaskOutlineItem;
  simple: boolean;
  index: number;
}

const TaskOutlineBranch = ({ item, simple, index }: Readonly<TaskOutlineBranchProps>): JSX.Element => {
  const description = taskDescription(item.node, simple);
  return (
    <li>
      <div className="flex items-start justify-between gap-3">
        <span className="text-foreground text-xs font-medium">
          {taskLabel(item.node, index, simple)}
        </span>
        <span className="text-muted-foreground shrink-0 text-[10px]">
          {statusLabel(item.node.status, simple)}
        </span>
      </div>
      {description && <p className="text-muted-foreground mt-0.5 text-[10px]">{description}</p>}
      {!simple && item.alternateParents.length > 0 && (
        <p className="text-muted-foreground mt-0.5 text-[10px]">
          Also needed by: {item.alternateParents.join(', ')}
        </p>
      )}
      {item.children.length > 0 && (
        <ul className="border-border/60 mt-2 ml-3 flex flex-col gap-2 border-l pl-3">
          {item.children.map((child, childIndex) => (
            <TaskOutlineBranch
              key={`${child.node.id}-${child.depth}`}
              item={child}
              simple={simple}
              index={childIndex}
            />
          ))}
        </ul>
      )}
    </li>
  );
};

export const TaskOutline = ({
  nodes,
  simple,
}: Readonly<{ nodes: readonly TaskNode[]; simple: boolean }>): JSX.Element => {
  const result = buildTaskOutline(nodes);
  const branches = [...result.roots, ...result.other];
  return (
    <div className="flex flex-col gap-3">
      {result.anomalies.length > 0 && (
        <div role="status" className="border-border/60 bg-muted/30 rounded-md border px-3 py-2">
          {result.anomalies.map((anomaly) => (
            <p key={anomaly.type} className="text-muted-foreground text-[10px]">
              {anomalyLabel(anomaly.type, simple)}
            </p>
          ))}
        </div>
      )}
      {branches.length > 0 ? (
        <>
          {result.roots.length > 0 && (
            <ul aria-label="Task outline" className="flex flex-col gap-2">
              {result.roots.map((item, index) => (
                <TaskOutlineBranch
                  key={`${item.node.id}-${index}`}
                  item={item}
                  simple={simple}
                  index={index}
                />
              ))}
            </ul>
          )}
          {result.other.length > 0 && (
            <section aria-labelledby="task-outline-other">
              <h3 id="task-outline-other" className="text-muted-foreground mb-2 text-xs font-medium">
                Other steps
              </h3>
              <ul aria-label="Other task steps" className="flex flex-col gap-2">
                {result.other.map((item, index) => (
                  <TaskOutlineBranch
                    key={`${item.node.id}-other-${index}`}
                    item={item}
                    simple={simple}
                    index={index}
                  />
                ))}
              </ul>
            </section>
          )}
        </>
      ) : (
        <p className="text-muted-foreground text-xs">No task steps to outline.</p>
      )}
    </div>
  );
};
