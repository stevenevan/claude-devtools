import { useStore } from '@renderer/store';

/**
 * Returns true when the given dashboard widget id is not hidden in the
 * persisted layout. Used by AnalyticsDashboard to gate panel rendering.
 */
export function useWidgetVisible(id: string): boolean {
  const hidden = useStore((s) => s.appConfig?.dashboard?.hiddenWidgets ?? []);
  return !hidden.includes(id);
}
