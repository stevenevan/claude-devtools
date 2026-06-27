import { JSX, memo, useMemo } from 'react';
import { useTabUI } from '@renderer/hooks/useTabUI';
import { cn } from '@renderer/lib/utils';
import { useStore } from '@renderer/store';
import { enhanceAIGroup } from '@renderer/utils/aiGroupEnhancer';
import { getModelColorClass } from '@shared/utils/modelParser';
import { format } from 'date-fns';
import { Bot, ChevronDown, Clock, Copy } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';

import { TokenUsageDisplay } from '../../common/TokenUsageDisplay';
import { AnnotationBadge } from '../AnnotationBadge';
import { ContextBadge } from '../ContextBadge';
import { DisplayItemList } from '../DisplayItemList';
import { LastOutputDisplay } from '../LastOutputDisplay';

import { BookmarkToggle } from './BookmarkToggle';
import { containsToolUseId, extractPrecedingSlashInfo, formatDuration } from './helpers';
import { useAIGroupExpansion } from './useAIGroupExpansion';
import { useAIGroupTokens } from './useAIGroupTokens';

import type { ContextStats } from '@renderer/types/contextInjection';
import type { AIGroup, EnhancedAIGroup } from '@renderer/types/groups';
import type { TriggerColor } from '@shared/constants/triggerColors';

interface AIChatGroupProps {
  aiGroup: AIGroup;

  highlightToolUseId?: string;

  highlightColor?: TriggerColor;

  registerToolRef?: (toolId: string, el: HTMLElement | null) => void;
}

const AIChatGroupInner = ({
  aiGroup,
  highlightToolUseId,
  highlightColor,
  registerToolRef,
}: Readonly<AIChatGroupProps>): JSX.Element => {
  // Per-tab UI state for expansion (completely isolated per tab)
  const {
    tabId,
    isAIGroupExpanded: isAIGroupExpandedForTab,
    toggleAIGroupExpansion,
    getExpandedDisplayItemIds,
    toggleDisplayItemExpansion,
    expandDisplayItem,
  } = useTabUI();

  // Per-tab session data, falling back to global state
  const projectRoot = useStore((s) => {
    const td = tabId ? s.tabSessionData[tabId] : null;
    return (td?.sessionDetail ?? s.sessionDetail)?.session?.projectPath;
  });
  const isSessionOngoing = useStore((s) => {
    const id = s.selectedSessionId;
    if (!id) return false;
    return s.sessions.find((sess) => sess.id === id)?.isOngoing ?? false;
  });

  // Per-tab session data subscriptions, falling back to global state
  const {
    sessionClaudeMdStats,
    sessionContextStats,
    sessionPhaseInfo,
    conversation,
    searchExpandedAIGroupIds,
    searchExpandedSubagentIds,
    searchCurrentDisplayItemId,
  } = useStore(
    useShallow((s) => {
      const td = tabId ? s.tabSessionData[tabId] : null;
      return {
        sessionClaudeMdStats: td?.sessionClaudeMdStats ?? s.sessionClaudeMdStats,
        sessionContextStats: td?.sessionContextStats ?? s.sessionContextStats,
        sessionPhaseInfo: td?.sessionPhaseInfo ?? s.sessionPhaseInfo,
        conversation: td?.conversation ?? s.conversation,
        searchExpandedAIGroupIds: s.searchExpandedAIGroupIds,
        searchExpandedSubagentIds: s.searchExpandedSubagentIds,
        searchCurrentDisplayItemId: s.searchCurrentDisplayItemId,
      };
    })
  );

  // Notification color map for tool item dots
  const notifications = useStore((s) => s.notifications);
  const notificationColorMap = useMemo(() => {
    const map = new Map<string, TriggerColor>();
    for (const n of notifications) {
      if (n.toolUseId && n.triggerColor) {
        map.set(n.toolUseId, n.triggerColor);
      }
    }
    return map;
  }, [notifications]);

  // Derived state from store values
  const claudeMdStats = sessionClaudeMdStats?.get(aiGroup.id);
  const contextStats: ContextStats | undefined = sessionContextStats?.get(aiGroup.id);

  // Phase data for this AI group
  const phaseNumber = sessionPhaseInfo?.aiGroupPhaseMap.get(aiGroup.id);
  const totalPhases = sessionPhaseInfo?.phases.length ?? 0;

  // Find the preceding UserGroup for this AIGroup to extract slash info
  // eslint-disable-next-line react-hooks/preserve-manual-memoization -- React Compiler can't preserve this; manual memo needed for O(n) traversal
  const precedingSlash = useMemo(() => {
    if (!conversation?.items) return undefined;

    // Find the index of this AIGroup in the conversation
    const aiGroupIndex = conversation.items.findIndex(
      (item) => item.type === 'ai' && item.group.id === aiGroup.id
    );

    if (aiGroupIndex <= 0) return undefined;

    // Look backwards for the nearest UserGroup
    for (let i = aiGroupIndex - 1; i >= 0; i--) {
      const item = conversation.items[i];
      if (item.type === 'user') {
        return extractPrecedingSlashInfo(item.group);
      }
      // Stop if we hit another AI group (shouldn't happen in normal flow)
      if (item.type === 'ai') break;
    }

    return undefined;
  }, [conversation?.items, aiGroup.id]);

  // Enhance the AI group to get display-ready data
  const enhanced: EnhancedAIGroup = useMemo(
    () => enhanceAIGroup(aiGroup, claudeMdStats, precedingSlash),
    [aiGroup, claudeMdStats, precedingSlash]
  );

  // Check if this group should be expanded for search results
  const shouldExpandForSearch = searchExpandedAIGroupIds.has(aiGroup.id);

  // Check if this group contains the highlighted error tool
  const containsHighlightedError = useMemo(() => {
    if (!highlightToolUseId) return false;
    return containsToolUseId(enhanced.displayItems, highlightToolUseId);
  }, [enhanced.displayItems, highlightToolUseId]);

  const { lastUsage, thinkingTokens, textOutputTokens } = useAIGroupTokens(aiGroup.responses);

  // Auto-expand if contains error or search result, or if manually expanded
  const isExpanded =
    isAIGroupExpandedForTab(aiGroup.id) || containsHighlightedError || shouldExpandForSearch;

  useAIGroupExpansion({
    aiGroupId: aiGroup.id,
    displayItems: enhanced.displayItems,
    highlightToolUseId,
    containsHighlightedError,
    shouldExpandForSearch,
    searchCurrentDisplayItemId,
    searchExpandedSubagentIds,
    expandDisplayItem,
  });

  // Get expanded item IDs for this AI group (per-tab)
  const expandedItemIds = useMemo(
    () => getExpandedDisplayItemIds(aiGroup.id),
    [getExpandedDisplayItemIds, aiGroup.id]
  );

  // Determine if there's content to toggle
  const hasToggleContent = enhanced.displayItems.length > 0;

  // Handle item click - toggle inline expansion using store action
  const handleItemClick = (itemId: string): void => {
    toggleDisplayItemExpansion(aiGroup.id, itemId);
  };

  return (
    <div className="space-y-3 border-l-2 border-indigo-500/20 pl-3">
      {/* Header Row */}
      {hasToggleContent && (
        <div className="flex items-center gap-2">
          {/* Clickable toggle area */}
          <div
            role="button"
            tabIndex={0}
            aria-expanded={isExpanded}
            aria-label="Toggle AI response details"
            className="group flex min-w-0 flex-1 cursor-pointer items-center gap-2 overflow-hidden"
            onClick={() => toggleAIGroupExpansion(aiGroup.id)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                toggleAIGroupExpansion(aiGroup.id);
              }
            }}
          >
            <Bot className="text-muted-foreground size-4 shrink-0" />
            <span className="text-muted-foreground shrink-0 text-xs font-semibold">Claude</span>

            {/* Main agent model */}
            {enhanced.mainModel && (
              <span
                className={cn('shrink-0 text-xs', getModelColorClass(enhanced.mainModel.family))}
              >
                {enhanced.mainModel.name}
              </span>
            )}

            {/* Subagent models if different */}
            {enhanced.subagentModels.length > 0 && (
              <>
                <span className="text-muted-foreground shrink-0">→</span>
                <span className="text-muted-foreground shrink-0 text-xs">
                  {enhanced.subagentModels.map((m, i) => (
                    <span key={m.name}>
                      {i > 0 && ', '}
                      <span className={getModelColorClass(m.family)}>{m.name}</span>
                    </span>
                  ))}
                </span>
              </>
            )}

            <span className="text-muted-foreground shrink-0 text-xs">·</span>
            <span className="text-muted-foreground truncate text-xs">
              {enhanced.itemsSummary}
              {aiGroup.progressCount != null && aiGroup.progressCount > 0 && (
                <span
                  className="ml-1 opacity-60"
                  title={
                    aiGroup.progressTexts?.length ? aiGroup.progressTexts.join('\n') : undefined
                  }
                >
                  ({aiGroup.progressCount} progress)
                </span>
              )}
            </span>
            <ChevronDown
              className={cn(
                'size-3.5 shrink-0 transition-transform group-hover:opacity-80 text-muted-foreground',
                isExpanded && 'rotate-180'
              )}
            />
          </div>

          {/* Right side: Context badge, Token usage, Timestamp (non-clickable) */}
          <div className="flex shrink-0 items-center gap-2">
            {/* Context injection badge (CLAUDE.md, mentioned files, tool outputs) */}
            {contextStats && <ContextBadge stats={contextStats} projectRoot={projectRoot} />}

            {/* Token usage - show last assistant message's usage (context window snapshot) */}
            {lastUsage && (
              <TokenUsageDisplay
                inputTokens={lastUsage.input_tokens}
                outputTokens={lastUsage.output_tokens}
                cacheReadTokens={lastUsage.cache_read_input_tokens ?? 0}
                cacheCreationTokens={lastUsage.cache_creation_input_tokens ?? 0}
                thinkingTokens={thinkingTokens}
                textOutputTokens={textOutputTokens}
                modelName={enhanced.mainModel?.name}
                modelFamily={enhanced.mainModel?.family}
                size="sm"
                claudeMdStats={enhanced.claudeMdStats ?? undefined}
                contextStats={contextStats}
                phaseNumber={phaseNumber}
                totalPhases={totalPhases}
              />
            )}

            {/* Duration */}
            {aiGroup.durationMs > 0 && (
              <span className="text-muted-foreground inline-flex shrink-0 items-center gap-1 text-xs whitespace-nowrap">
                <Clock className="size-3" />
                {formatDuration(aiGroup.durationMs)}
              </span>
            )}

            {/* Timestamp - receded for visual hierarchy */}
            {enhanced.lastOutput?.timestamp && (
              <span className="text-muted-foreground shrink-0 text-[10px] whitespace-nowrap">
                {format(enhanced.lastOutput.timestamp, 'h:mm:ss a')}
              </span>
            )}

            {/* Copy as Markdown */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                const text = enhanced.lastOutput?.text ?? '';
                if (text) void navigator.clipboard.writeText(text);
              }}
              className="text-muted-foreground hover:text-foreground shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
              title="Copy response as text"
            >
              <Copy className="size-3.5" />
            </button>

            {/* Annotation badge */}
            <AnnotationBadge targetId={aiGroup.id} />

            {/* Bookmark toggle */}
            <BookmarkToggle groupId={aiGroup.id} />
          </div>
        </div>
      )}

      {/* Expandable Content */}
      {hasToggleContent && isExpanded && (
        <div className="py-2 pl-2">
          <DisplayItemList
            items={enhanced.displayItems}
            onItemClick={handleItemClick}
            expandedItemIds={expandedItemIds}
            aiGroupId={aiGroup.id}
            highlightToolUseId={highlightToolUseId}
            highlightColor={highlightColor}
            notificationColorMap={notificationColorMap}
            registerToolRef={registerToolRef}
          />
        </div>
      )}

      {/* Always-visible Output */}
      <div>
        <LastOutputDisplay
          lastOutput={enhanced.lastOutput}
          aiGroupId={aiGroup.id}
          isLastGroup={aiGroup.isOngoing ?? false}
          isSessionOngoing={isSessionOngoing}
          lastStep={aiGroup.steps.length > 0 ? aiGroup.steps[aiGroup.steps.length - 1] : null}
        />
      </div>
    </div>
  );
};

// ponytail: memo kept — virtualized row
export const AIChatGroup = memo(AIChatGroupInner);
