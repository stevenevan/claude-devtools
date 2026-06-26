import { isErrorPayload } from '@renderer/types/tabs';

import {
  calculateCenteredScrollTop,
  findAIGroupBySubagentId,
  findAIGroupByTimestamp,
  waitForElementStability,
  waitForScrollEnd,
} from './utils';

import type { NavigationContext } from './navigationContext';
import type { TabNavigationRequest } from '@renderer/types/tabs';

export async function executeErrorNavigation(
  request: TabNavigationRequest,
  ctx: NavigationContext,
  abortSignal: AbortSignal
): Promise<boolean> {
  if (!isErrorPayload(request) || !ctx.conversation) return false;
  const { errorTimestamp, toolUseId, subagentId } = request.payload;

  const checkAborted = (): boolean => abortSignal.aborted;

  // Find target AI group (subagent-aware lookup first, then timestamp fallback)
  let targetGroupId: string | null = null;
  if (subagentId) {
    targetGroupId = findAIGroupBySubagentId(ctx.conversation.items, subagentId);
  }
  if (!targetGroupId && errorTimestamp > 0) {
    targetGroupId = findAIGroupByTimestamp(ctx.conversation.items, errorTimestamp);
  }
  if (!targetGroupId) {
    // Fallback: last AI group
    const aiItems = ctx.conversation.items.filter((item) => item.type === 'ai');
    if (aiItems.length > 0) {
      targetGroupId = aiItems[aiItems.length - 1].group.id;
    }
  }
  if (!targetGroupId) return false;

  // Phase 1: Expanding
  ctx.setPhase('expanding');
  ctx.expandAIGroup(targetGroupId);
  // Persist subagent trace expansion so it survives highlight clearing
  if (subagentId) {
    ctx.expandSubagentTrace(subagentId);
  }
  await ctx.ensureGroupVisible?.(targetGroupId);
  if (checkAborted()) return false;

  // Set highlight early so it's visible even if scroll is imperfect
  ctx.setHighlightedGroupId(targetGroupId);
  ctx.setIsSearchHighlight(false);
  // Error navigation uses a TriggerColor (preset key or custom hex, defaulting to 'red')
  ctx.setHighlightColor(request.highlight === 'none' ? undefined : request.highlight);
  if (toolUseId) ctx.setCurrentToolUseId(toolUseId);

  // Wait for element to exist and stabilize
  let element: HTMLElement | undefined;
  const elementLookupStart = Date.now();
  while (Date.now() - elementLookupStart < 600) {
    element = ctx.aiGroupRefs.current.get(targetGroupId);
    if (element) break;
    await new Promise((resolve) => setTimeout(resolve, 50));
    if (checkAborted()) return false;
    await ctx.ensureGroupVisible?.(targetGroupId);
  }
  // If element not found, highlight is already set — return success
  if (!element) return true;
  await waitForElementStability(element, 250, 2);
  if (checkAborted()) return false;

  // Phase 2: Scrolling (best-effort — highlight already set)
  ctx.setPhase('scrolling');

  // Wait for tool item ref if needed (longer timeout for subagent cascading expansion)
  let toolElement: HTMLElement | undefined;
  if (toolUseId) {
    // Subagents need more time: AI group expand → display item expand → trace expand → tool render
    const toolLookupTimeout = subagentId ? 1200 : 300;
    const startTime = Date.now();
    while (Date.now() - startTime < toolLookupTimeout) {
      toolElement = ctx.toolItemRefs.current.get(toolUseId);
      if (toolElement) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
      if (checkAborted()) return true; // Highlight already set
    }
    if (toolElement) {
      await waitForElementStability(toolElement, 300, 2);
      if (checkAborted()) return true; // Highlight already set
    }
  }

  // Scroll to target (best-effort)
  const targetElement = toolElement ?? element;
  const container = ctx.scrollContainerRef.current;
  if (targetElement && container) {
    const targetScrollTop = calculateCenteredScrollTop(targetElement, container, ctx.stickyOffset);
    container.scrollTo({ top: targetScrollTop, behavior: 'smooth' });
    await waitForScrollEnd(container, 400);
  }
  if (checkAborted()) return false;

  // Phase 3: Highlight was set early, just update phase
  ctx.setPhase('highlighting');
  return true;
}
