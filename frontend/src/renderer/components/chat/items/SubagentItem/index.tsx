import { useCallback, useState, FC } from 'react';

import { cn } from '@renderer/lib/utils';
import { formatDuration } from '@renderer/utils/formatters';
import { getModelColorClass } from '@shared/utils/modelParser';
import { Bot, CheckCircle2, ChevronRight, Loader2, Terminal } from 'lucide-react';

import { ExecutionTrace } from '../ExecutionTrace';
import { MetricsPill } from '../MetricsPill';

import { ContextUsageRows } from './ContextUsageRows';
import { ShutdownOnlyRow } from './ShutdownOnlyRow';
import { useSubagentData } from './useSubagentData';

import type { Process, SemanticStep } from '@renderer/types/data';
import type { TriggerColor } from '@shared/constants/triggerColors';

interface SubagentItemProps {
  step: SemanticStep;
  subagent: Process;
  onClick: () => void;
  isExpanded: boolean;
  aiGroupId: string;

  highlightToolUseId?: string;

  highlightColor?: TriggerColor;

  notificationColorMap?: Map<string, TriggerColor>;

  registerToolRef?: (toolId: string, el: HTMLDivElement | null) => void;
}

export const SubagentItem: FC<SubagentItemProps> = ({
  step,
  subagent,
  onClick,
  isExpanded,
  aiGroupId,
  highlightToolUseId,
  highlightColor,
  notificationColorMap,
  registerToolRef,
}) => {
  const {
    subagentType,
    truncatedDesc,
    teamColors,
    typeColors,
    isShutdownOnly,
    toggleSubagentTraceExpansion,
    displayItems,
    itemsSummary,
    modelInfo,
    lastUsage,
    phaseData,
    searchCurrentSubagentItemId,
    shouldExpandForSearch,
    isTraceExpanded,
    outerHighlight,
    cumulativeMetrics,
    hasMainImpact,
    hasIsolated,
    isMultiPhase,
    isolatedTotal,
  } = useSubagentData({ step, subagent, isExpanded, highlightToolUseId, highlightColor });

  const [isTraceHeaderHovered, setIsTraceHeaderHovered] = useState(false);

  // Register outer card as a tool ref target for the parent Task tool_use ID
  // so the navigation controller can scroll directly to this SubagentItem
  // ponytail: useCallback required — callback ref; new fn on every render would re-trigger DOM attachment
  const outerCardRef = useCallback(
    (el: HTMLDivElement | null) => {
      if (subagent.parentTaskId && registerToolRef) {
        registerToolRef(subagent.parentTaskId, el);
      }
    },
    [subagent.parentTaskId, registerToolRef]
  );

  // Shutdown-only team activations: minimal inline row (no metrics, no expand)
  if (isShutdownOnly && teamColors && subagent.team) {
    return (
      <ShutdownOnlyRow
        team={subagent.team}
        teamColors={teamColors}
        durationMs={subagent.durationMs}
      />
    );
  }

  return (
    <div
      ref={outerCardRef}
      className={cn(
        'overflow-hidden rounded-md border border-border bg-card transition-all duration-300',
        outerHighlight.className
      )}
      style={outerHighlight.style}
    >
      {/* ========== Level 1: Clickable Header ========== */}
      <div
        role="button"
        tabIndex={0}
        onClick={onClick}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onClick();
          }
        }}
        className={cn(
          'flex cursor-pointer items-center gap-2 px-3 py-2 transition-colors',
          isExpanded ? 'border-b border-border bg-muted/50' : 'bg-transparent'
        )}
      >
        {/* Expand chevron */}
        <ChevronRight
          className={cn(
            'size-3.5 shrink-0 transition-transform text-muted-foreground',
            isExpanded && 'rotate-90'
          )}
        />

        {/* Icon - colored dot for team members/typed subagents, Bot icon for generic */}
        {teamColors || typeColors ? (
          <span
            className="size-3.5 shrink-0 rounded-full"
            style={{ backgroundColor: (teamColors ?? typeColors)!.border }}
          />
        ) : (
          <Bot
            className={cn(
              'size-4 shrink-0',
              subagent.isOngoing ? 'text-blue-500' : 'text-muted-foreground'
            )}
          />
        )}

        {/* Type badge - team member name or typed subagent */}
        {teamColors && subagent.team ? (
          <span
            className="rounded-sm px-1.5 py-0.5 text-[10px] font-medium tracking-wide"
            style={{
              backgroundColor: teamColors.badge,
              color: teamColors.text,
              border: `1px solid ${teamColors.border}40`,
            }}
          >
            {subagent.team.memberName}
          </span>
        ) : (
          <span
            className="rounded-sm px-1.5 py-0.5 text-[10px] font-medium tracking-wide uppercase"
            style={{
              backgroundColor: typeColors!.badge,
              color: typeColors!.text,
              border: `1px solid ${typeColors!.border}40`,
            }}
          >
            {subagentType}
          </span>
        )}

        {/* Model */}
        {modelInfo && (
          <span className={cn('text-[11px]', getModelColorClass(modelInfo.family))}>
            {modelInfo.name}
          </span>
        )}

        {/* Description */}
        <span className="text-foreground flex-1 truncate text-xs">{truncatedDesc}</span>

        {/* Status indicator */}
        {subagent.isOngoing ? (
          <Loader2 className="size-3.5 shrink-0 animate-spin text-blue-500" />
        ) : (
          <CheckCircle2 className="size-3.5 shrink-0 text-green-500" />
        )}

        {/* Unified Metrics Pill — team members don't show mainSessionImpact
            (spawn cost only; real main impact comes from teammate messages) */}
        <MetricsPill
          mainSessionImpact={subagent.team ? undefined : subagent.mainSessionImpact}
          lastUsage={lastUsage ?? undefined}
          isolatedLabel={subagent.team ? 'Context Window' : undefined}
          isolatedOverride={
            phaseData && phaseData.compactionCount > 0 ? phaseData.totalConsumption : undefined
          }
          phaseBreakdown={phaseData?.phases}
        />

        {/* Duration */}
        <span className="text-muted-foreground shrink-0 font-mono text-[11px] tabular-nums">
          {formatDuration(subagent.durationMs)}
        </span>
      </div>

      {/* ========== Level 1 Expanded: Dashboard Content ========== */}
      {isExpanded && (
        <div className="space-y-3 p-3">
          {/* ========== Row 1: Meta Info (Horizontal Flow) ========== */}
          <div className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
            <span>
              <span className="text-muted-foreground">Type</span>{' '}
              <span className="text-foreground font-mono">{subagentType}</span>
            </span>
            <span className="text-muted-foreground">•</span>
            <span>
              <span className="text-muted-foreground">Duration</span>{' '}
              <span className="text-foreground font-mono tabular-nums">
                {formatDuration(subagent.durationMs)}
              </span>
            </span>
            {modelInfo && (
              <>
                <span className="text-muted-foreground">•</span>
                <span>
                  <span className="text-muted-foreground">Model</span>{' '}
                  <span className={cn('font-mono', getModelColorClass(modelInfo.family))}>
                    {modelInfo.name}
                  </span>
                </span>
              </>
            )}
            <span className="text-muted-foreground">•</span>
            <span>
              <span className="text-muted-foreground">ID</span>{' '}
              <span
                className="text-muted-foreground inline-block max-w-[120px] truncate align-bottom font-mono"
                title={subagent.id}
              >
                {subagent.id.slice(0, 8)}
              </span>
            </span>
          </div>

          {/* ========== Row 2: Context Usage (Clean List) ========== */}
          <ContextUsageRows
            subagent={subagent}
            hasMainImpact={hasMainImpact}
            hasIsolated={hasIsolated}
            cumulativeMetrics={cumulativeMetrics}
            isMultiPhase={isMultiPhase}
            isolatedTotal={isolatedTotal}
            phaseData={phaseData}
          />

          {/* ========== Level 2: Execution Trace Toggle ========== */}
          {displayItems.length > 0 && (
            <div className="border-border bg-muted/50 overflow-hidden rounded-md border">
              {/* Trace Header (clickable) */}
              <div
                role="button"
                tabIndex={0}
                onClick={(e) => {
                  e.stopPropagation();
                  toggleSubagentTraceExpansion(subagent.id);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    e.stopPropagation();
                    toggleSubagentTraceExpansion(subagent.id);
                  }
                }}
                className={cn(
                  'flex cursor-pointer items-center gap-2 px-3 py-2 transition-colors',
                  isTraceExpanded && 'border-b border-border',
                  isTraceHeaderHovered ? 'bg-accent/50' : 'bg-transparent'
                )}
                onMouseEnter={() => setIsTraceHeaderHovered(true)}
                onMouseLeave={() => setIsTraceHeaderHovered(false)}
              >
                <ChevronRight
                  className={cn(
                    'size-3 shrink-0 transition-transform text-muted-foreground',
                    isTraceExpanded && 'rotate-90'
                  )}
                />
                <Terminal className="text-muted-foreground size-3.5" />
                <span className="text-muted-foreground text-xs">Execution Trace</span>
                <span className="text-muted-foreground text-[11px]">· {itemsSummary}</span>
              </div>

              {/* Trace Content */}
              {isTraceExpanded && (
                <div className="p-2">
                  <ExecutionTrace
                    items={displayItems}
                    aiGroupId={aiGroupId}
                    highlightToolUseId={highlightToolUseId}
                    highlightColor={highlightColor}
                    notificationColorMap={notificationColorMap}
                    searchExpandedItemId={
                      shouldExpandForSearch ? searchCurrentSubagentItemId : null
                    }
                    registerToolRef={registerToolRef}
                  />
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
