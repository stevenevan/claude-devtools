import { JSX } from 'react';
import { Eye, EyeOff, Pin, Tag, X } from 'lucide-react';

interface BulkActionBarProps {
  selectedCount: number;
  someSelectedAreHidden: boolean;
  showHiddenSessions: boolean;
  onPin: () => void;
  onTag: () => void;
  onHide: () => void;
  onUnhide: () => void;
  onClear: () => void;
}

export const BulkActionBar = ({
  selectedCount,
  someSelectedAreHidden,
  showHiddenSessions,
  onPin,
  onTag,
  onHide,
  onUnhide,
  onClear,
}: BulkActionBarProps): JSX.Element => {
  return (
    <div className="border-border bg-card flex items-center gap-1.5 border-b px-3 py-1.5">
      <span className="text-muted-foreground text-[11px] font-medium">
        {selectedCount} selected
      </span>
      <div className="ml-auto flex items-center gap-1">
        <button
          onClick={onPin}
          className="text-muted-foreground rounded-sm px-1.5 py-0.5 text-[10px] font-medium transition-colors hover:bg-white/5"
          title="Pin selected sessions"
        >
          <Pin className="inline-block size-3" /> Pin
        </button>
        <button
          onClick={onTag}
          className="text-muted-foreground rounded-sm px-1.5 py-0.5 text-[10px] font-medium transition-colors hover:bg-white/5"
          title="Add tag to selected sessions"
        >
          <Tag className="inline-block size-3" /> Tag
        </button>
        <button
          onClick={onHide}
          className="text-muted-foreground rounded-sm px-1.5 py-0.5 text-[10px] font-medium transition-colors hover:bg-white/5"
          title="Hide selected sessions"
        >
          <EyeOff className="inline-block size-3" /> Hide
        </button>
        {showHiddenSessions && someSelectedAreHidden && (
          <button
            onClick={onUnhide}
            className="text-muted-foreground rounded-sm px-1.5 py-0.5 text-[10px] font-medium transition-colors hover:bg-white/5"
            title="Unhide selected sessions"
          >
            <Eye className="inline-block size-3" /> Unhide
          </button>
        )}
        <button
          onClick={onClear}
          className="text-muted-foreground rounded-sm p-0.5 transition-colors hover:bg-white/5"
          title="Cancel selection"
        >
          <X className="size-3.5" />
        </button>
      </div>
    </div>
  );
};
