import { JSX, useEffect, useRef } from 'react';

import { useStore } from '@renderer/store';

export const PaneAnnouncer = (): JSX.Element => {
  const paneCount = useStore((state) => state.paneLayout.panes.length);
  const focusedPaneId = useStore((state) => state.paneLayout.focusedPaneId);
  const previous = useRef({ count: paneCount, focused: focusedPaneId });

  useEffect(() => {
    previous.current = { count: paneCount, focused: focusedPaneId };
  }, [paneCount, focusedPaneId]);

  let announced = '';
  if (previous.current.count !== paneCount) {
    announced =
      paneCount > previous.current.count
        ? `Pane split. ${paneCount} panes open.`
        : `Pane closed. ${paneCount} ${paneCount === 1 ? 'pane' : 'panes'} open.`;
  } else if (previous.current.focused !== focusedPaneId) {
    announced = 'Focused pane changed.';
  }

  return (
    <div aria-live="polite" role="status" className="sr-only">
      {announced}
    </div>
  );
};
