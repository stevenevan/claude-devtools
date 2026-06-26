import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { cn } from '@renderer/lib/utils';
import { ArrowDownWideNarrow, Calendar, CheckSquare, Eye, EyeOff } from 'lucide-react';

import type { Session, SessionSortMode } from '@renderer/types/data';

interface HeaderToolbarProps {
  sessions: Session[];
  sessionsHasMore: boolean;
  sessionSortMode: SessionSortMode;
  setSessionSortMode: (mode: SessionSortMode) => void;
  sidebarMultiSelectActive: boolean;
  toggleSidebarMultiSelect: () => void;
  hasHiddenSessions: boolean;
  showHiddenSessions: boolean;
  toggleShowHiddenSessions: () => void;
}

export const HeaderToolbar = ({
  sessions,
  sessionsHasMore,
  sessionSortMode,
  setSessionSortMode,
  sidebarMultiSelectActive,
  toggleSidebarMultiSelect,
  hasHiddenSessions,
  showHiddenSessions,
  toggleShowHiddenSessions,
}: HeaderToolbarProps): React.JSX.Element => {
  const countRef = useRef<HTMLSpanElement>(null);
  const [showCountTooltip, setShowCountTooltip] = useState(false);

  return (
    <div className="mt-2 flex items-center gap-2 px-4 py-3">
      <Calendar className="text-muted-foreground size-4" />
      <h2 className="text-muted-foreground text-xs tracking-wider uppercase">
        {sessionSortMode === 'most-context' ? 'By Context' : 'Sessions'}
      </h2>
      {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions -- tooltip trigger via hover, not interactive */}
      <span
        ref={countRef}
        className="text-muted-foreground text-xs opacity-60"
        onMouseEnter={() => setShowCountTooltip(true)}
        onMouseLeave={() => setShowCountTooltip(false)}
      >
        ({sessions.length}
        {sessionsHasMore ? '+' : ''})
      </span>
      {showCountTooltip &&
        sessionsHasMore &&
        countRef.current &&
        createPortal(
          <div
            className="border-border bg-popover text-muted-foreground pointer-events-none fixed z-50 w-48 rounded-md border px-2.5 py-1.5 text-[11px] leading-snug shadow-lg"
            style={{
              top: countRef.current.getBoundingClientRect().bottom + 6,
              left:
                countRef.current.getBoundingClientRect().left +
                countRef.current.getBoundingClientRect().width / 2 -
                96,
            }}
          >
            {sessions.length} loaded so far — scroll down to load more. Context sorting only ranks
            loaded sessions.
          </div>,
          document.body
        )}
      <div className="ml-auto flex items-center gap-0.5">
        <button
          onClick={toggleSidebarMultiSelect}
          className={cn(
            'rounded-sm p-1 transition-colors hover:bg-white/5',
            sidebarMultiSelectActive ? 'text-indigo-400' : 'text-muted-foreground'
          )}
          title={sidebarMultiSelectActive ? 'Exit selection mode' : 'Select sessions'}
        >
          <CheckSquare className="size-3.5" />
        </button>
        {hasHiddenSessions && (
          <button
            onClick={toggleShowHiddenSessions}
            className={cn(
              'rounded-sm p-1 transition-colors hover:bg-white/5',
              showHiddenSessions ? 'text-indigo-400' : 'text-muted-foreground'
            )}
            title={showHiddenSessions ? 'Hide hidden sessions' : 'Show hidden sessions'}
          >
            {showHiddenSessions ? <Eye className="size-3.5" /> : <EyeOff className="size-3.5" />}
          </button>
        )}
        <button
          onClick={() =>
            setSessionSortMode(sessionSortMode === 'recent' ? 'most-context' : 'recent')
          }
          className={cn(
            'rounded-sm p-1 transition-colors hover:bg-white/5',
            sessionSortMode === 'most-context' ? 'text-indigo-400' : 'text-muted-foreground'
          )}
          title={sessionSortMode === 'recent' ? 'Sort by context consumption' : 'Sort by recent'}
        >
          <ArrowDownWideNarrow className="size-3.5" />
        </button>
      </div>
    </div>
  );
};
