/**
 * SessionItem - Compact session row in the session list.
 * Shows title, message count, and time ago.
 * Supports right-click context menu for pane management.
 */

import React, { useCallback } from 'react';

import { ContextMenu, ContextMenuTrigger } from '@renderer/components/ui/context-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/components/ui/tooltip';
import { cn } from '@renderer/lib/utils';
import { useStore } from '@renderer/store';
import { formatTokensCompact } from '@shared/utils/tokenFormatting';
import { formatDistanceToNowStrict } from 'date-fns';
import { EyeOff, MessageSquare, Pin } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';

import { OngoingIndicator } from '../common/OngoingIndicator';

import { SessionContextMenu } from './SessionContextMenu';

import type { PhaseTokenBreakdown, Session } from '@renderer/types/data';

interface SessionItemProps {
  session: Session;
  isActive?: boolean;
  isPinned?: boolean;
  isHidden?: boolean;
  multiSelectActive?: boolean;
  isSelected?: boolean;
  onToggleSelect?: () => void;
}

/**
 * Format time distance in short form (e.g., "4m", "2h", "1d")
 */
function formatShortTime(date: Date): string {
  const distance = formatDistanceToNowStrict(date, { addSuffix: false });
  return distance
    .replace(' seconds', 's')
    .replace(' second', 's')
    .replace(' minutes', 'm')
    .replace(' minute', 'm')
    .replace(' hours', 'h')
    .replace(' hour', 'h')
    .replace(' days', 'd')
    .replace(' day', 'd')
    .replace(' weeks', 'w')
    .replace(' week', 'w')
    .replace(' months', 'mo')
    .replace(' month', 'mo')
    .replace(' years', 'y')
    .replace(' year', 'y');
}

/**
 * Consumption badge with hover tooltip showing phase breakdown.
 */
const ConsumptionBadge = ({
  contextConsumption,
  phaseBreakdown,
}: Readonly<{
  contextConsumption: number;
  phaseBreakdown?: PhaseTokenBreakdown[];
}>): React.JSX.Element => {
  const isHigh = contextConsumption > 150_000;
  const hasBreakdown = phaseBreakdown && phaseBreakdown.length > 0;

  const badge = (
    <span className={cn('tabular-nums', isHigh && 'text-amber-400')}>
      {formatTokensCompact(contextConsumption)}
    </span>
  );

  if (!hasBreakdown) return badge;

  return (
    <Tooltip>
      <TooltipTrigger render={<span className={cn('tabular-nums', isHigh && 'text-amber-400')} />}>
        {formatTokensCompact(contextConsumption)}
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-xs text-[10px]">
        <div className="mb-1 font-medium">
          Total Context: {formatTokensCompact(contextConsumption)} tokens
        </div>
        {phaseBreakdown.length === 1 ? (
          <div>Context: {formatTokensCompact(phaseBreakdown[0].peakTokens)}</div>
        ) : (
          phaseBreakdown.map((phase) => (
            <div key={phase.phaseNumber} className="flex items-center gap-1">
              <span className="text-muted-foreground">Phase {phase.phaseNumber}:</span>
              <span className="tabular-nums">{formatTokensCompact(phase.contribution)}</span>
              {phase.postCompaction != null && (
                <span className="text-muted-foreground">
                  (compacted to {formatTokensCompact(phase.postCompaction)})
                </span>
              )}
            </div>
          ))
        )}
      </TooltipContent>
    </Tooltip>
  );
};

export const SessionItem = React.memo(function SessionItem({
  session,
  isActive,
  isPinned,
  isHidden,
  multiSelectActive,
  isSelected,
  onToggleSelect,
}: Readonly<SessionItemProps>): React.JSX.Element {
  const {
    openTab,
    activeProjectId,
    selectSession,
    paneCount,
    splitPane,
    togglePinSession,
    toggleHideSession,
  } = useStore(
    useShallow((s) => ({
      openTab: s.openTab,
      activeProjectId: s.activeProjectId,
      selectSession: s.selectSession,
      paneCount: s.paneLayout.panes.length,
      splitPane: s.splitPane,
      togglePinSession: s.togglePinSession,
      toggleHideSession: s.toggleHideSession,
    }))
  );

  const handleClick = (event: React.MouseEvent): void => {
    if (!activeProjectId) return;

    // In multi-select mode, clicks toggle selection
    if (multiSelectActive && onToggleSelect) {
      onToggleSelect();
      return;
    }

    // Cmd/Ctrl+click: open in new tab; plain click: replace current tab
    const forceNewTab = event.ctrlKey || event.metaKey;

    openTab(
      {
        type: 'session',
        sessionId: session.id,
        projectId: activeProjectId,
        label: session.customTitle ?? session.firstMessage?.slice(0, 50) ?? 'Session',
      },
      forceNewTab ? { forceNewTab } : { replaceActiveTab: true }
    );

    selectSession(session.id);
  };

  const sessionLabel = session.customTitle ?? session.firstMessage?.slice(0, 50) ?? 'Session';

  const handleOpenInCurrentPane = useCallback(() => {
    if (!activeProjectId) return;
    openTab(
      {
        type: 'session',
        sessionId: session.id,
        projectId: activeProjectId,
        label: sessionLabel,
      },
      { replaceActiveTab: true }
    );
    selectSession(session.id);
  }, [activeProjectId, openTab, selectSession, session.id, sessionLabel]);

  const handleOpenInNewTab = useCallback(() => {
    if (!activeProjectId) return;
    openTab(
      {
        type: 'session',
        sessionId: session.id,
        projectId: activeProjectId,
        label: sessionLabel,
      },
      { forceNewTab: true }
    );
    selectSession(session.id);
  }, [activeProjectId, openTab, selectSession, session.id, sessionLabel]);

  const handleSplitRightAndOpen = useCallback(() => {
    if (!activeProjectId) return;
    // First open the tab in the focused pane
    openTab({
      type: 'session',
      sessionId: session.id,
      projectId: activeProjectId,
      label: sessionLabel,
    });
    selectSession(session.id);
    // Then split it to the right
    const state = useStore.getState();
    const focusedPaneId = state.paneLayout.focusedPaneId;
    const activeTabId = state.activeTabId;
    if (activeTabId) {
      splitPane(focusedPaneId, activeTabId, 'right');
    }
  }, [activeProjectId, openTab, selectSession, session.id, sessionLabel, splitPane]);

  // Height must match SESSION_HEIGHT (48px) in DateGroupedSessions.tsx for virtual scroll
  return (
    <ContextMenu>
      <ContextMenuTrigger
        render={
          <button
            onClick={handleClick}
            className={cn(
              'h-[48px] w-full overflow-hidden border-b border-border py-2 text-left transition-all duration-150 border-l-2 focus-visible:ring-1 focus-visible:ring-[var(--color-accent)] focus-visible:ring-inset',
              isActive
                ? 'bg-surface-raised border-l-[var(--color-accent)] pl-[10px]'
                : 'bg-transparent border-l-transparent pl-3 hover:bg-white/[0.03]',
              isHidden && 'opacity-50'
            )}
          />
        }
      >
        {/* First line: title + ongoing indicator + pin/hidden icons */}
        <div className="flex items-center gap-1.5">
          {multiSelectActive && (
            <input
              type="checkbox"
              checked={isSelected ?? false}
              onChange={() => onToggleSelect?.()}
              onClick={(e) => e.stopPropagation()}
              className="size-3.5 shrink-0 accent-blue-500"
            />
          )}
          {session.isOngoing && <OngoingIndicator />}
          {isPinned && <Pin className="size-2.5 shrink-0 text-blue-400" />}
          {isHidden && <EyeOff className="size-2.5 shrink-0 text-zinc-500" />}
          <span
            className={cn(
              'truncate text-[13px] leading-tight font-medium',
              isActive ? 'text-text' : 'text-text-muted'
            )}
          >
            {session.customTitle ?? session.firstMessage ?? 'Untitled'}
          </span>
        </div>

        {/* Second line: message count + time + context consumption */}
        <div className="text-text-muted mt-0.5 flex items-center gap-2 text-[10px] leading-tight">
          <span className="flex items-center gap-0.5">
            <MessageSquare className="size-2.5" />
            {session.messageCount}
          </span>
          <span className="opacity-50">·</span>
          <span className="tabular-nums">{formatShortTime(new Date(session.createdAt))}</span>
          {session.contextConsumption != null && session.contextConsumption > 0 && (
            <>
              <span className="opacity-50">·</span>
              <ConsumptionBadge
                contextConsumption={session.contextConsumption}
                phaseBreakdown={session.phaseBreakdown}
              />
            </>
          )}
        </div>
      </ContextMenuTrigger>

      {activeProjectId && (
        <SessionContextMenu
          sessionId={session.id}
          paneCount={paneCount}
          isPinned={isPinned ?? false}
          isHidden={isHidden ?? false}
          onOpenInCurrentPane={handleOpenInCurrentPane}
          onOpenInNewTab={handleOpenInNewTab}
          onSplitRightAndOpen={handleSplitRightAndOpen}
          onTogglePin={() => void togglePinSession(session.id)}
          onToggleHide={() => void toggleHideSession(session.id)}
        />
      )}
    </ContextMenu>
  );
});
