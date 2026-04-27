/**
 * Dashboard widget registry helpers — sprint 32 makes the seam introduced in
 * sprint 18 a live runtime. Provides ordering, hide/show, and reset-to-defaults
 * operations over the static `registerDashboardWidget` registry.
 */

import { getRegisteredWidgets, type DashboardWidgetMeta } from './widgetContract';

export interface DashboardLayoutState {
  widgetOrder: string[];
  hiddenWidgets: string[];
}

export const defaultDashboardLayout = (): DashboardLayoutState => ({
  widgetOrder: [],
  hiddenWidgets: [],
});

/**
 * Merge user-saved layout state with the registry so widgets added after the
 * last save still appear. Returns an ordered list of visible + hidden widgets
 * for rendering.
 */
export function applyLayoutToRegistry(
  layout: DashboardLayoutState
): { visible: DashboardWidgetMeta[]; hidden: DashboardWidgetMeta[] } {
  const widgets = getRegisteredWidgets();
  const byId = new Map(widgets.map((w) => [w.id, w]));
  const hiddenSet = new Set(layout.hiddenWidgets);

  const ordered: DashboardWidgetMeta[] = [];
  const seen = new Set<string>();
  for (const id of layout.widgetOrder) {
    const widget = byId.get(id);
    if (widget) {
      ordered.push(widget);
      seen.add(id);
    }
  }
  // Append any widgets not in the user's saved order (new panels since last save).
  for (const w of widgets) {
    if (!seen.has(w.id)) ordered.push(w);
  }

  const visible = ordered.filter((w) => !hiddenSet.has(w.id));
  const hidden = ordered.filter((w) => hiddenSet.has(w.id));
  return { visible, hidden };
}

/**
 * Pure layout reducer — used by the customize menu and unit tests to avoid
 * coupling to Zustand.
 */
export function layoutReduce(
  layout: DashboardLayoutState,
  action:
    | { type: 'move'; id: string; direction: 'up' | 'down' }
    | { type: 'toggle-hidden'; id: string }
    | { type: 'reset' }
): DashboardLayoutState {
  if (action.type === 'reset') {
    return defaultDashboardLayout();
  }
  if (action.type === 'toggle-hidden') {
    const hiddenSet = new Set(layout.hiddenWidgets);
    if (hiddenSet.has(action.id)) hiddenSet.delete(action.id);
    else hiddenSet.add(action.id);
    return { ...layout, hiddenWidgets: Array.from(hiddenSet) };
  }
  // move
  const widgetIds =
    layout.widgetOrder.length > 0
      ? [...layout.widgetOrder]
      : getRegisteredWidgets().map((w) => w.id);
  const idx = widgetIds.indexOf(action.id);
  if (idx === -1) {
    widgetIds.push(action.id);
  }
  const currentIdx = idx === -1 ? widgetIds.length - 1 : idx;
  const swapWith = action.direction === 'up' ? currentIdx - 1 : currentIdx + 1;
  if (swapWith < 0 || swapWith >= widgetIds.length) return layout;
  const next = [...widgetIds];
  [next[currentIdx], next[swapWith]] = [next[swapWith], next[currentIdx]];
  return { ...layout, widgetOrder: next };
}
