import type { JSX } from 'react';
import { cn } from '@renderer/lib/utils';

interface ChatHistoryToolbarProps {
  showHeatmapButton: boolean;
  contextHeatmapVisible: boolean;
  onToggleHeatmap: () => void;
  hasTodoData: boolean;
  isTodoPanelVisible: boolean;
  onToggleTodo: () => void;
  todoPendingCount: number;
  contextInjectionCount: number;
  isContextPanelVisible: boolean;
  onToggleContext: () => void;
  isContextButtonHovered: boolean;
  setIsContextButtonHovered: (hovered: boolean) => void;
}

export const ChatHistoryToolbar = ({
  showHeatmapButton,
  contextHeatmapVisible,
  onToggleHeatmap,
  hasTodoData,
  isTodoPanelVisible,
  onToggleTodo,
  todoPendingCount,
  contextInjectionCount,
  isContextPanelVisible,
  onToggleContext,
  isContextButtonHovered,
  setIsContextButtonHovered,
}: ChatHistoryToolbarProps): JSX.Element => {
  return (
    <div className="pointer-events-none sticky top-0 z-10 flex justify-end gap-1.5 px-4 pt-3 pb-0">
      {showHeatmapButton && (
        <button
          onClick={onToggleHeatmap}
          className={cn(
            'pointer-events-auto flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs shadow-lg backdrop-blur-md transition-colors',
            contextHeatmapVisible
              ? 'bg-violet-500/45 text-violet-100'
              : 'bg-muted text-muted-foreground hover:bg-accent'
          )}
          title={contextHeatmapVisible ? 'Hide context heatmap' : 'Show context heatmap'}
          aria-pressed={contextHeatmapVisible}
        >
          Heatmap
        </button>
      )}
      {hasTodoData && (
        <button
          onClick={onToggleTodo}
          className={cn(
            'pointer-events-auto flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs shadow-lg backdrop-blur-md transition-colors',
            isTodoPanelVisible
              ? 'bg-emerald-500/45 text-emerald-100'
              : 'bg-muted text-muted-foreground hover:bg-accent'
          )}
          aria-pressed={isTodoPanelVisible}
        >
          Tasks ({todoPendingCount})
        </button>
      )}
      {contextInjectionCount > 0 && (
        <button
          onClick={onToggleContext}
          onMouseEnter={() => setIsContextButtonHovered(true)}
          onMouseLeave={() => setIsContextButtonHovered(false)}
          className={cn(
            'pointer-events-auto flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs shadow-lg backdrop-blur-md transition-colors',
            isContextPanelVisible
              ? 'bg-indigo-500/45 text-indigo-100'
              : isContextButtonHovered
                ? 'hover:bg-accent text-muted-foreground'
                : 'bg-muted text-muted-foreground'
          )}
          aria-pressed={isContextPanelVisible}
        >
          Context ({contextInjectionCount})
        </button>
      )}
    </div>
  );
};
