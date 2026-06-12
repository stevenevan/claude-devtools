import type { JSX } from 'react';
import { ChevronsDown } from 'lucide-react';

interface ScrollToBottomButtonProps {
  onClick: () => void;
  rightOffset: string;
}

export const ScrollToBottomButton = ({
  onClick,
  rightOffset,
}: ScrollToBottomButtonProps): JSX.Element => {
  return (
    <button
      onClick={onClick}
      className="text-muted-foreground border-border bg-muted absolute bottom-5 z-20 flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs shadow-lg backdrop-blur-md transition-all"
      style={{ right: rightOffset }}
      title="Scroll to bottom"
    >
      <ChevronsDown className="size-3.5" />
      <span>Bottom</span>
    </button>
  );
};
