import { useCallback, useMemo, useState } from 'react';

import { cn } from '@renderer/lib/utils';
import { useStore } from '@renderer/store';
import { formatDuration, formatTokensCompact } from '@renderer/utils/formatters';
import {
  Bot,
  ChevronRight,
  Home,
  Loader2,
  Search,
  X,
} from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';

import { Button } from '../ui/button';

import type { SubagentDetail } from '@renderer/types/data';

/**
 * SubagentDetailPanel - Full-screen overlay for viewing subagent conversation details.
 * Shows breadcrumb navigation, search filter, and metrics summary.
 */
export const SubagentDetailPanel = (): React.JSX.Element | null => {
  const {
    drillDownStack,
    currentSubagentDetail,
    subagentDetailLoading,
    subagentDetailError,
    navigateToBreadcrumb,
    closeSubagentModal,
  } = useStore(
    useShallow((s) => ({
      drillDownStack: s.drillDownStack,
      currentSubagentDetail: s.currentSubagentDetail,
      subagentDetailLoading: s.subagentDetailLoading,
      subagentDetailError: s.subagentDetailError,
      navigateToBreadcrumb: s.navigateToBreadcrumb,
      closeSubagentModal: s.closeSubagentModal,
    }))
  );

  const [searchQuery, setSearchQuery] = useState('');

  const isOpen = drillDownStack.length > 0 || subagentDetailLoading;

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Subagent detail"
      className="bg-surface absolute inset-0 z-40 flex flex-col"
    >
      {/* Header */}
      <div className="border-border flex items-center gap-2 border-b px-4 py-2">
        {/* Breadcrumb */}
        <nav className="flex min-w-0 flex-1 items-center gap-1 text-xs">
          <button
            onClick={() => closeSubagentModal()}
            className="text-muted-foreground hover:text-foreground flex shrink-0 items-center gap-1 transition-colors"
          >
            <Home className="size-3" />
            <span>Main Session</span>
          </button>

          {drillDownStack.map((item, index) => (
            <span key={item.id} className="flex items-center gap-1">
              <ChevronRight className="text-muted-foreground/50 size-3 shrink-0" />
              {index < drillDownStack.length - 1 ? (
                <button
                  onClick={() => navigateToBreadcrumb(index + 1)}
                  className="text-muted-foreground hover:text-foreground truncate transition-colors"
                  title={item.description}
                >
                  {item.description}
                </button>
              ) : (
                <span className="text-foreground truncate font-medium" title={item.description}>
                  {item.description}
                </span>
              )}
            </span>
          ))}
        </nav>

        {/* Search */}
        <div className="border-border flex items-center gap-1.5 rounded-sm border px-2 py-1">
          <Search className="text-muted-foreground size-3" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Filter steps..."
            className="text-foreground placeholder:text-muted-foreground w-32 bg-transparent text-xs outline-hidden"
          />
          {searchQuery && (
            <button onClick={() => setSearchQuery('')} aria-label="Clear filter">
              <X className="text-muted-foreground size-3" />
            </button>
          )}
        </div>

        {/* Close */}
        <Button variant="ghost" size="icon-xs" onClick={closeSubagentModal} title="Close" aria-label="Close subagent panel">
          <X className="size-3.5" />
        </Button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto px-4 py-3">
        {subagentDetailLoading && (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="text-muted-foreground size-5 animate-spin" />
          </div>
        )}

        {subagentDetailError && (
          <div className="text-muted-foreground py-12 text-center text-sm">
            {subagentDetailError}
          </div>
        )}

        {currentSubagentDetail && !subagentDetailLoading && (
          <SubagentContent detail={currentSubagentDetail} searchQuery={searchQuery} />
        )}
      </div>
    </div>
  );
};

const SubagentContent = ({
  detail,
  searchQuery,
}: Readonly<{ detail: SubagentDetail; searchQuery: string }>): React.JSX.Element => {
  const query = searchQuery.toLowerCase().trim();

  const filteredGroups = useMemo(() => {
    if (!detail.semanticStepGroups || !query) return detail.semanticStepGroups ?? [];
    return detail.semanticStepGroups.filter(
      (g) =>
        g.label.toLowerCase().includes(query) ||
        g.steps.some(
          (s) =>
            s.type.toLowerCase().includes(query) ||
            (s.content.toolName && s.content.toolName.toLowerCase().includes(query)) ||
            (s.content.outputText && s.content.outputText.toLowerCase().includes(query)) ||
            (s.content.subagentDescription &&
              s.content.subagentDescription.toLowerCase().includes(query))
        )
    );
  }, [detail.semanticStepGroups, query]);

  return (
    <div className="space-y-4">
      {/* Metrics Summary */}
      <div className="border-border flex items-center gap-4 rounded-sm border px-3 py-2">
        <Bot className="text-muted-foreground size-4" />
        <div className="flex items-center gap-3 text-xs">
          <span className="text-foreground font-medium">
            {detail.description || detail.id}
          </span>
          <span className="text-muted-foreground">
            {formatTokensCompact(
              detail.metrics.inputTokens + detail.metrics.outputTokens
            )}{' '}
            tokens
          </span>
          <span className="text-muted-foreground">{formatDuration(detail.duration)}</span>
          <span className="text-muted-foreground">
            {detail.metrics.messageCount} messages
          </span>
        </div>
      </div>

      {/* Semantic Step Groups */}
      {filteredGroups.length > 0 ? (
        <div className="space-y-2">
          {filteredGroups.map((group) => (
            <SemanticGroupCard key={group.id} group={group} searchQuery={query} />
          ))}
        </div>
      ) : query ? (
        <div className="text-muted-foreground py-8 text-center text-xs">
          No steps matching &quot;{searchQuery}&quot;
        </div>
      ) : (
        <div className="text-muted-foreground py-8 text-center text-xs">
          {detail.chunks.length} chunks loaded
        </div>
      )}
    </div>
  );
};

function formatStepLabel(step: { type: string; content: Record<string, unknown> }): string {
  const c = step.content;
  if (c.toolName) return `${step.type}: ${c.toolName as string}`;
  if (c.subagentDescription) return `subagent: ${c.subagentDescription as string}`;
  return step.type;
}

const SemanticGroupCard = ({
  group,
  searchQuery,
}: Readonly<{
  group: NonNullable<SubagentDetail['semanticStepGroups']>[number];
  searchQuery: string;
}>): React.JSX.Element => {
  const [isExpanded, setIsExpanded] = useState(!!searchQuery);

  return (
    <div className="border-border rounded-sm border">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className={cn(
          'flex w-full items-center gap-2 px-3 py-1.5 text-xs transition-colors',
          'hover:bg-white/[0.02]'
        )}
      >
        <span className="text-foreground flex-1 truncate text-left font-medium">{group.label}</span>
        <span className="text-muted-foreground tabular-nums text-[10px]">
          {group.steps.length} steps
        </span>
        <span className="text-muted-foreground tabular-nums text-[10px]">
          {formatDuration(group.totalDuration)}
        </span>
      </button>
      {isExpanded && (
        <div className="border-border border-t px-3 py-1.5">
          {group.steps.map((step) => (
            <div key={step.id} className="text-muted-foreground py-0.5 text-[11px]">
              <span className="text-text-secondary">{formatStepLabel(step)}</span>
              {step.content.outputText && (
                <span className="text-muted-foreground ml-1.5 truncate">
                  — {(step.content.outputText as string).slice(0, 100)}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
