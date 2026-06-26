// registerDashboardWidget is intentionally a no-op; the runtime registry lands in sprint 32.
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
