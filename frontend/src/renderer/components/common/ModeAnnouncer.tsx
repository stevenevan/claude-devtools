import { JSX, useEffect, useRef } from 'react';

import { useUIMode } from '@renderer/hooks/useUIMode';

export const ModeAnnouncer = (): JSX.Element => {
  const mode = useUIMode();
  const previous = useRef(mode);

  useEffect(() => {
    previous.current = mode;
  }, [mode]);

  const announced = previous.current === mode ? '' : `Interface mode: ${mode === 'simple' ? 'Simple' : 'Nerd'}`;

  return (
    <div aria-live="polite" role="status" className="sr-only">
      {announced}
    </div>
  );
};
