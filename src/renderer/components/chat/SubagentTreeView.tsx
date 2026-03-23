/**
 * SubagentTreeView - Collapsible tree showing subagent hierarchy.
 * Used within SubagentItem to visualize nested subagent relationships.
 */

import { useState } from 'react';

import { cn } from '@renderer/lib/utils';
import { formatDuration, formatTokensCompact } from '@renderer/utils/formatters';
import { parseModelString } from '@shared/utils/modelParser';
import {
  Bot,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Loader2,
  Users,
} from 'lucide-react';

import type { Process } from '@shared/types/chunks';

interface SubagentTreeViewProps {
  processes: Process[];
  className?: string;
}

interface TreeNodeProps {
  process: Process;
}

const TreeNode = ({ process }: Readonly<TreeNodeProps>): React.JSX.Element => {
  const [isOpen, setIsOpen] = useState(true);
  const isOngoing = process.isOngoing ?? false;
  const model = process.metrics.model ? parseModelString(process.metrics.model) : null;
  const description = process.description || process.subagentType || process.id;
  const shortId = process.id.length > 10 ? process.id.slice(0, 8) : process.id;

  return (
    <div>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          'flex w-full items-center gap-1.5 rounded-sm px-2 py-1 text-xs transition-colors',
          'hover:bg-white/[0.03]'
        )}
      >
        {isOpen ? (
          <ChevronDown className="text-muted-foreground size-3 shrink-0" />
        ) : (
          <ChevronRight className="text-muted-foreground size-3 shrink-0" />
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
        </span>
      </button>

      {isOpen && process.isParallel && (
        <div className="text-muted-foreground/50 pl-8 text-[10px] italic">
          Ran in parallel
        </div>
      )}
    </div>
  );
};

export const SubagentTreeView = ({
  processes,
  className,
}: Readonly<SubagentTreeViewProps>): React.JSX.Element | null => {
  if (processes.length === 0) return null;

  return (
    <div className={cn('border-border rounded-sm border', className)}>
      <div className="border-border flex items-center gap-2 border-b px-3 py-1.5">
        <Bot className="text-muted-foreground size-3" />
        <span className="text-muted-foreground text-[10px] font-medium uppercase tracking-wider">
          Subagents ({processes.length})
        </span>
      </div>
      <div className="py-1">
        {processes.map((p) => (
          <TreeNode key={p.id} process={p} />
        ))}
      </div>
    </div>
  );
};
