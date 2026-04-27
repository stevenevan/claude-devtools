import { useMemo } from 'react';

import { cn } from '@renderer/lib/utils';
import { buildTeamTree } from '@renderer/utils/teamTreeBuilder';
import { ChevronRight, Users } from 'lucide-react';

import type { TeamTreeNode } from '@renderer/utils/teamTreeBuilder';
import type { Process } from '@shared/types/chunks';

interface TeamTreeViewProps {
  processes: Process[];
  onSelectProcess?: (process: Process) => void;
  className?: string;
}

interface TeamTreeNodeRowProps {
  node: TeamTreeNode;
  depth: number;
  onSelect?: (process: Process) => void;
}

const TeamTreeNodeRow = ({
  node,
  depth,
  onSelect,
}: Readonly<TeamTreeNodeRowProps>): React.JSX.Element => (
  <div className="flex flex-col">
    <button
      onClick={() => node.process && onSelect?.(node.process)}
      disabled={!node.process}
      className={cn(
        'hover:bg-surface-raised flex items-center gap-2 rounded-sm px-2 py-1 text-left text-[11px] transition-colors',
        !node.process && 'cursor-default'
      )}
      style={{ paddingLeft: `${depth * 14 + 8}px` }}
    >
      {node.kind === 'team' ? (
        <Users className="size-3 shrink-0 text-indigo-300" />
      ) : (
        <ChevronRight className="text-text-muted size-3 shrink-0" />
      )}
      {node.color && (
        <span
          aria-hidden
          className="size-2 shrink-0 rounded-full"
          style={{ backgroundColor: node.color }}
        />
      )}
      <span className="text-text truncate">{node.label}</span>
      <span
        className={cn(
          'shrink-0 rounded-sm border px-1 text-[9px]',
          node.status === 'active'
            ? 'border-emerald-400/40 bg-emerald-400/10 text-emerald-300'
            : 'border-border/50 text-text-muted'
        )}
      >
        {node.status}
      </span>
      {node.toolCount > 0 && (
        <span className="text-text-muted ml-auto shrink-0 font-mono text-[9px]">
          {node.toolCount} tools
        </span>
      )}
    </button>
    {node.children.map((child) => (
      <TeamTreeNodeRow
        key={child.id}
        node={child}
        depth={depth + 1}
        onSelect={onSelect}
      />
    ))}
  </div>
);

export const TeamTreeView = ({
  processes,
  onSelectProcess,
  className,
}: Readonly<TeamTreeViewProps>): React.JSX.Element => {
  const tree = useMemo(() => buildTeamTree(processes), [processes]);

  if (tree.length === 0) {
    return (
      <div
        className={cn(
          'border-border bg-background/50 text-text-muted rounded-xs border p-4 text-center text-xs',
          className
        )}
      >
        No team coordination in this session.
      </div>
    );
  }

  return (
    <div
      className={cn(
        'border-border bg-background/50 flex flex-col gap-1 rounded-xs border p-3',
        className
      )}
    >
      <div className="text-text-muted mb-1 text-[10px] uppercase tracking-wider">
        Agent Teams
      </div>
      {tree.map((node) => (
        <TeamTreeNodeRow key={node.id} node={node} depth={0} onSelect={onSelectProcess} />
      ))}
    </div>
  );
};
