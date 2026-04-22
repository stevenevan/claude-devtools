import { ContextHeatmap } from '@renderer/components/chat/ContextHeatmap';

import type { ContextStats } from '@renderer/types/contextInjection';
import type { ChatItem } from '@renderer/types/groups';

import { registerDashboardWidget } from './widgetContract';

registerDashboardWidget({
  id: 'context-heatmap',
  title: 'Context Heatmap',
  category: 'session',
  defaultSize: { cols: 4, rows: 1 },
  minSize: { cols: 2, rows: 1 },
  maxSize: { cols: 8, rows: 2 },
  defaultVisible: false,
});

interface ContextHeatmapTileProps {
  items: ChatItem[];
  statsMap: Map<string, ContextStats>;
  onSelectTurn?: (aiGroupId: string, turnIndex: number) => void;
}

/**
 * Dashboard-tile wrapper around the presentational `ContextHeatmap`.
 * Owns widget registration only; no presentational logic.
 */
export const ContextHeatmapTile = ({
  items,
  statsMap,
  onSelectTurn,
}: Readonly<ContextHeatmapTileProps>): React.JSX.Element => (
  <div className="border-border bg-background/50 rounded-xs border p-4">
    <div className="mb-3">
      <h3 className="text-text text-sm font-medium">Context Heatmap</h3>
      <p className="text-text-muted mt-0.5 text-[10px]">
        Per-turn context fill, coloured by dominant category
      </p>
    </div>
    <ContextHeatmap items={items} statsMap={statsMap} onSelectTurn={onSelectTurn} />
  </div>
);
