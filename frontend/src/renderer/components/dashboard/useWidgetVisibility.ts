import { useStore } from '@renderer/store';

export function useWidgetVisible(id: string): boolean {
  const hidden = useStore((s) => s.appConfig?.dashboard?.hiddenWidgets ?? []);
  return !hidden.includes(id);
}
