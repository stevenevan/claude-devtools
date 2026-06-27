import { FC } from 'react';

import { useStore } from '@renderer/store';

export const ContextSwitchOverlay: FC = () => {
  const isContextSwitching = useStore((state) => state.isContextSwitching);
  const targetContextId = useStore((state) => state.targetContextId);

  if (!isContextSwitching) {
    return null;
  }

  const contextLabel =
    targetContextId === 'local' ? 'Local' : (targetContextId?.replace(/^ssh-/, '') ?? 'Unknown');

  return (
    <div className="bg-background fixed inset-0 z-[9999] flex items-center justify-center">
      <div className="flex flex-col items-center gap-4">
        <div className="border-text size-8 animate-spin rounded-full border-4 border-t-transparent" />

        <div className="flex flex-col items-center gap-1">
          <p className="text-foreground">Switching to {contextLabel}...</p>
          <p className="text-muted-foreground text-sm">Loading workspace</p>
        </div>
      </div>
    </div>
  );
};
