/**
 * DashboardWidget contract — stable seam shared across sprints 18–25 & 32.
 *
 * Sprint 18 ships the full-shape contract (not a minimal stub) so that downstream
 * sprints registering panels don't need retroactive field additions when sprint 32
 * turns this registry into a runtime. The `registerDashboardWidget` implementation
 * is intentionally a no-op here — the runtime lands in sprint 32.
 */

export type DashboardWidgetCategory = 'analytics' | 'session' | 'tools' | 'custom';

export interface DashboardWidgetSize {
  cols: number;
  rows: number;
}

export interface DashboardWidgetMeta {
  id: string;
  title: string;
  category: DashboardWidgetCategory;
  defaultSize: DashboardWidgetSize;
  minSize: DashboardWidgetSize;
  maxSize: DashboardWidgetSize;
  defaultVisible: boolean;
  onMount?: () => void;
  onUnmount?: () => void;
}

const registry = new Map<string, DashboardWidgetMeta>();

export function registerDashboardWidget(meta: DashboardWidgetMeta): void {
  registry.set(meta.id, meta);
}

export function getRegisteredWidgets(): DashboardWidgetMeta[] {
  return Array.from(registry.values());
}
