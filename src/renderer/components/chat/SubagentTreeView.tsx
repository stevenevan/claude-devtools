/**
 * SubagentTreeView - Collapsible N-level tree showing subagent spawn hierarchy.
 * Sprint 31: handles arbitrary nesting depth via subagentTreeLayout; offers a
 * header filter to hide subagents with zero tool calls.
 */

import { useMemo, useState } from 'react';

import { cn } from '@renderer/lib/utils';
import { useStore } from '@renderer/store';
import { formatDuration, formatTokensCompact } from '@renderer/utils/formatters';
import { buildSubagentTree } from '@renderer/utils/subagentTreeLayout';
import { parseModelString } from '@shared/utils/modelParser';
import {
  Bot,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Filter,
  Loader2,
  Users,
} from 'lucide-react';

import type { SubagentTreeNode } from '@renderer/utils/subagentTreeLayout';
import type { Process } from '@shared/types/chunks';

interface SubagentTreeViewProps {
  processes: Process[];
  className?: string;
}

interface TreeNodeProps {
  node: SubagentTreeNode;
  depth: number;
  collapsed: Set<string>;
  onToggle: (id: string) => void;
}

const TreeNode = ({
  node,
  depth,
  collapsed,
  onToggle,
}: Readonly<TreeNodeProps>): React.JSX.Element => {
  const drillDownSubagent = useStore((s) => s.drillDownSubagent);
  const selectedProjectId = useStore((s) => s.selectedProjectId);
  const selectedSessionId = useStore((s) => s.selectedSessionId);

  const { process, toolUseCount, children } = node;
  const hasChildren = children.length > 0;
  const isCollapsed = collapsed.has(process.id);
  const isOngoing = process.isOngoing ?? false;
  const model = process.metrics.model ? parseModelString(process.metrics.model) : null;
  const description = process.description || process.subagentType || process.id;
  const shortId = process.id.length > 10 ? process.id.slice(0, 8) : process.id;

  return (
    <div>
      <button
        onClick={() => hasChildren && onToggle(process.id)}
        className={cn(
          'flex w-full items-center gap-1.5 rounded-sm px-2 py-1 text-xs transition-colors',
          hasChildren ? 'hover:bg-white/[0.03]' : 'cursor-default'
        )}
        style={{ paddingLeft: `${depth * 14 + 8}px` }}
      >
        {hasChildren ? (
          isCollapsed ? (
            <ChevronRight className="text-muted-foreground size-3 shrink-0" />
          ) : (
            <ChevronDown className="text-muted-foreground size-3 shrink-0" />
          )
        ) : (
          <span className="size-3 shrink-0" />
        )}

        {process.team ? (
          <Users className="size-3 shrink-0 text-indigo-400" />
        ) : (
          <Bot className="text-muted-foreground size-3 shrink-0" />
        )}

        <span className="text-foreground truncate font-medium">{description}</span>
        <span className="text-muted-foreground/60 shrink-0 text-[10px]">{shortId}</span>
        {model && (
          <span className="text-muted-foreground shrink-0 text-[10px]">{model.name}</span>
        )}

        <span className="ml-auto flex shrink-0 items-center gap-1.5">
          <span className="text-muted-foreground tabular-nums text-[10px]">
            {toolUseCount} tools
          </span>
          <span className="text-muted-foreground tabular-nums text-[10px]">
            {formatTokensCompact(process.metrics.totalTokens)}
          </span>
          <span className="text-muted-foreground tabular-nums text-[10px]">
            {formatDuration(process.durationMs)}
          </span>
          {isOngoing ? (
            <Loader2 className="size-3 animate-spin text-green-400" />
          ) : (
            <CheckCircle2 className="text-muted-foreground/40 size-3" />
          )}
          {selectedProjectId && selectedSessionId && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                void drillDownSubagent(
                  selectedProjectId,
                  selectedSessionId,
                  process.id,
                  description
                );
              }}
              className="text-muted-foreground hover:text-foreground flex items-center gap-0.5 text-[10px] transition-colors"
              title="View subagent details"
            >
              <ExternalLink className="size-2.5" />
            </button>
          )}
        </span>
      </button>

      {!isCollapsed && hasChildren && (
        <div>
          {children.map((child) => (
            <TreeNode
              key={child.process.id}
              node={child}
              depth={depth + 1}
              collapsed={collapsed}
              onToggle={onToggle}
            />
          ))}
        </div>
      )}
    </div>
  );
};

export const SubagentTreeView = ({
  processes,
  className,
}: Readonly<SubagentTreeViewProps>): React.JSX.Element | null => {
  const [hideEmpty, setHideEmpty] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const tree = useMemo(
    () => buildSubagentTree(processes, { hideEmpty }),
    [processes, hideEmpty]
  );

  if (processes.length === 0) return null;

  const handleToggle = (id: string): void => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className={cn('border-border rounded-sm border', className)}>
      <div className="border-border flex items-center gap-2 border-b px-3 py-1.5">
        <Bot className="text-muted-foreground size-3" />
        <span className="text-muted-foreground text-[10px] font-medium uppercase tracking-wider">
          Subagents ({processes.length})
        </span>
        <button
          onClick={() => setHideEmpty((v) => !v)}
          className={cn(
            'ml-auto flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-[10px] transition-colors',
            hideEmpty
              ? 'bg-sky-500/20 text-sky-200'
              : 'text-muted-foreground hover:bg-white/[0.03]'
          )}
          title={hideEmpty ? 'Show empty subagents' : 'Hide subagents with 0 tool calls'}
        >
          <Filter className="size-2.5" />
          <span>Hide empty</span>
        </button>
      </div>
      <div className="py-1">
        {tree.length === 0 ? (
          <div className="text-muted-foreground px-3 py-2 text-[10px]">
            All subagents filtered out.
          </div>
        ) : (
          tree.map((node) => (
            <TreeNode
              key={node.process.id}
              node={node}
              depth={0}
              collapsed={collapsed}
              onToggle={handleToggle}
            />
          ))
        )}
      </div>
    </div>
  );
};
