import { useEffect, useMemo } from 'react';

import { api } from '@renderer/api';
import { Skeleton } from '@renderer/components/ui/skeleton';
import { cn } from '@renderer/lib/utils';
import { useStore } from '@renderer/store';
import { Bot, Search } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';

import type { GlobalAgent } from '@shared/types/api';

// Helpers

/** Convert "backend-developer" → "Backend Developer" */
function formatAgentName(name: string): string {
  return name
    .split(/[-_]/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

// Agent Card

interface AgentCardProps {
  agent: GlobalAgent;
  isHighlighted?: boolean;
}

const AgentCard = ({ agent, isHighlighted }: Readonly<AgentCardProps>): React.JSX.Element => {
  const displayName = formatAgentName(agent.name);
  const toolsList = agent.tools ? agent.tools.split(',').map((t) => t.trim()) : [];
  const maxTools = 4;
  const visibleTools = toolsList.slice(0, maxTools);
  const extraCount = toolsList.length - maxTools;

  return (
    <button
      onClick={() => void api.openPath(agent.filePath)}
      className={cn(
        'group relative flex min-h-[120px] flex-col overflow-hidden rounded-xs border p-4 text-left transition-all duration-300',
        isHighlighted ? 'border-border bg-card' : 'bg-background/50 border-border hover:bg-card'
      )}
    >
      <div className="border-border bg-popover mb-3 flex size-8 items-center justify-center rounded-xs border transition-colors duration-300">
        <Bot className="text-muted-foreground group-hover:text-foreground size-4 transition-colors" />
      </div>

      <h3 className="text-foreground mb-1 truncate text-sm font-medium transition-colors duration-200">
        {displayName}
      </h3>

      <p className="text-muted-foreground mb-auto line-clamp-2 text-[10px]">{agent.description}</p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {agent.model && (
          <span className="border-border bg-popover rounded-sm border px-1.5 py-0.5 text-[10px] text-indigo-400">
            {agent.model}
          </span>
        )}
        {visibleTools.map((tool) => (
          <span key={tool} className="text-muted-foreground text-[10px]">
            {tool}
          </span>
        ))}
        {extraCount > 0 && (
          <span className="text-muted-foreground text-[10px]">+{extraCount} more</span>
        )}
      </div>
    </button>
  );
};

// Skeleton

const AgentsGridSkeleton = (): React.JSX.Element => {
  const titleWidths = [60, 50, 70, 55, 65, 45];
  const descWidths = [85, 75, 80, 90, 70, 85];

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-4">
      {Array.from({ length: 6 }).map((_, i) => (
        <Skeleton
          key={i}
          className="border-border flex min-h-[120px] flex-col rounded-xs border p-4"
          style={{ animationDelay: `${i * 80}ms` }}
        >
          <div className="bg-muted-foreground/10 mb-3 size-8 rounded-xs" />
          <div
            className="bg-muted-foreground/10 mb-2 h-3.5 rounded-xs"
            style={{ width: `${titleWidths[i]}%` }}
          />
          <div
            className="bg-muted-foreground/5 mb-auto h-2.5 rounded-xs"
            style={{ width: `${descWidths[i]}%` }}
          />
          <div className="mt-3 flex gap-2">
            <div className="bg-muted-foreground/5 h-2.5 w-12 rounded-xs" />
          </div>
        </Skeleton>
      ))}
    </div>
  );
};

// Agents Grid

interface AgentsGridProps {
  searchQuery: string;
}

export const AgentsGrid = ({ searchQuery }: Readonly<AgentsGridProps>): React.JSX.Element => {
  const { globalAgents, globalAgentsLoading, fetchGlobalAgents } = useStore(
    useShallow((s) => ({
      globalAgents: s.globalAgents,
      globalAgentsLoading: s.globalAgentsLoading,
      fetchGlobalAgents: s.fetchGlobalAgents,
    }))
  );

  useEffect(() => {
    if (globalAgents.length === 0 && !globalAgentsLoading) {
      void fetchGlobalAgents();
    }
  }, [globalAgents.length, globalAgentsLoading, fetchGlobalAgents]);

  const filtered = useMemo(() => {
    if (!searchQuery.trim()) return globalAgents;
    const query = searchQuery.toLowerCase().trim();
    return globalAgents.filter(
      (a) => a.name.toLowerCase().includes(query) || a.description.toLowerCase().includes(query)
    );
  }, [globalAgents, searchQuery]);

  if (globalAgentsLoading) return <AgentsGridSkeleton />;

  if (filtered.length === 0 && searchQuery.trim()) {
    return (
      <div className="border-border flex flex-col items-center justify-center rounded-xs border border-dashed px-8 py-16">
        <div className="border-border bg-card mb-4 flex size-12 items-center justify-center rounded-xs border">
          <Search className="text-muted-foreground size-6" />
        </div>
        <p className="text-muted-foreground mb-1 text-sm">No agents found</p>
        <p className="text-muted-foreground text-xs">No matches for &quot;{searchQuery}&quot;</p>
      </div>
    );
  }

  if (globalAgents.length === 0) {
    return (
      <div className="border-border flex flex-col items-center justify-center rounded-xs border border-dashed px-8 py-16">
        <div className="border-border bg-card mb-4 flex size-12 items-center justify-center rounded-xs border">
          <Bot className="text-muted-foreground size-6" />
        </div>
        <p className="text-muted-foreground mb-1 text-sm">No agents found</p>
        <p className="text-muted-foreground font-mono text-xs">~/.claude/agents/</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-4">
      {filtered.map((agent) => (
        <AgentCard key={agent.name} agent={agent} isHighlighted={!!searchQuery.trim()} />
      ))}
    </div>
  );
};
