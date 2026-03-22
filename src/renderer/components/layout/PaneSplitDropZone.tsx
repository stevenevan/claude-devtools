/**
 * PaneSplitDropZone - Half-pane drop zones for creating new panes via tab drag.
 * Covers the left or right half of the pane. When a tab is dragged over a half,
 * a semi-transparent accent overlay highlights the target area.
 */

import { useDroppable } from '@dnd-kit/core';
import { cn } from '@renderer/lib/utils';

interface PaneSplitDropZoneProps {
  paneId: string;
  side: 'left' | 'right';
  isActive: boolean;
}

export const PaneSplitDropZone = ({
  paneId,
  side,
  isActive,
}: PaneSplitDropZoneProps): React.JSX.Element => {
  const { setNodeRef, isOver } = useDroppable({
    id: `split-${side}-${paneId}`,
    data: {
      type: 'split-zone',
      paneId,
      side,
    },
  });

  return (
    <div
      ref={setNodeRef}
      className={cn(
        'absolute top-0 z-30 w-1/2 h-full',
        isActive ? 'pointer-events-auto' : 'pointer-events-none'
      )}
      style={{ [side]: 0 }}
    >
      {/* Semi-transparent overlay highlight when hovering */}
      {isOver && (
        <div
          className={cn(
            'absolute inset-0 opacity-[0.12] bg-indigo-500',
            side === 'right'
              ? 'border-l-2 border-indigo-500'
              : 'border-r-2 border-indigo-500'
          )}
        />
      )}
    </div>
  );
};
