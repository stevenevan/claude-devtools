import { isSearchPayload } from '@renderer/types/tabs';

import {
  calculateCenteredScrollTop,
  findChatItemByTimestamp,
  findCurrentSearchResultInContainer,
  waitForScrollEnd,
} from './utils';

import type { NavigationContext } from './navigationContext';
import type { TabNavigationRequest } from '@renderer/types/tabs';

export async function executeSearchNavigation(
  request: TabNavigationRequest,
  ctx: NavigationContext,
  abortSignal: AbortSignal
): Promise<boolean> {
  if (!isSearchPayload(request) || !ctx.conversation) return false;
  const { query, messageTimestamp, targetGroupId, targetMatchIndexInItem } = request.payload;

  const checkAborted = (): boolean => abortSignal.aborted;

  // Find target chat item (prefer exact group ID when provided)
  const exactTargetItem =
    targetGroupId !== undefined
      ? ctx.conversation.items.find((item) => item.group.id === targetGroupId)
      : undefined;
  const targetItem =
    exactTargetItem &&
    (exactTargetItem.type === 'user' ||
      exactTargetItem.type === 'system' ||
      exactTargetItem.type === 'ai' ||
      exactTargetItem.type === 'compact')
      ? { groupId: exactTargetItem.group.id, type: exactTargetItem.type }
      : findChatItemByTimestamp(ctx.conversation.items, messageTimestamp);
  if (!targetItem) return false;

  // Phase 1: Expanding
  ctx.setPhase('expanding');
  ctx.setSearchQuery(query);
  if (targetGroupId !== undefined && targetMatchIndexInItem !== undefined) {
    ctx.selectSearchMatch(targetGroupId, targetMatchIndexInItem);
  }
  ctx.setHighlightedGroupId(targetItem.groupId);
  ctx.setIsSearchHighlight(true);
  await ctx.ensureGroupVisible?.(targetItem.groupId);
  if (checkAborted()) return false;

  // Wait for element to appear
  const startedAt = Date.now();
  let targetEl: Element | null = null;

  while (!checkAborted() && Date.now() - startedAt < 600) {
    targetEl = findCurrentSearchResultInContainer(
      ctx.scrollContainerRef.current,
      targetGroupId,
      targetMatchIndexInItem
    );
    if (!targetEl) {
      targetEl =
        ctx.chatItemRefs.current.get(targetItem.groupId) ??
        ctx.aiGroupRefs.current.get(targetItem.groupId) ??
        null;
    }
    if (targetEl) break;
    await new Promise((resolve) => setTimeout(resolve, 50));
    await ctx.ensureGroupVisible?.(targetItem.groupId);
  }

  if (checkAborted()) return false;
  // If element not found, highlight is already set — return success
  if (!targetEl) return true;

  // Phase 2: Scrolling (best-effort — highlight already set)
  ctx.setPhase('scrolling');
  const container = ctx.scrollContainerRef.current;
  if (container && targetEl instanceof HTMLElement) {
    const targetScrollTop = calculateCenteredScrollTop(targetEl, container, ctx.stickyOffset);
    container.scrollTo({ top: targetScrollTop, behavior: 'smooth' });
    await waitForScrollEnd(container, 400);
  } else if (targetEl instanceof HTMLElement) {
    targetEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    await new Promise((resolve) => setTimeout(resolve, 350));
  }

  if (checkAborted()) return false;

  // Phase 3: Highlighting (yellow for search)
  ctx.setPhase('highlighting');
  // highlightedGroupId and isSearchHighlight already set above

  return true;
}
