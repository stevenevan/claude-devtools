import { JSX, useCallback } from 'react';
import { cn } from '@renderer/lib/utils';
import { useStore } from '@renderer/store';
import { Bookmark, BookmarkCheck } from 'lucide-react';

export const BookmarkToggle = ({ groupId }: Readonly<{ groupId: string }>): JSX.Element => {
  const isBookmarked = useStore(
    useCallback((s) => s.bookmarks.some((b) => b.groupId === groupId), [groupId])
  );
  const toggleBookmark = useStore((s) => s.toggleBookmark);
  const sessionId = useStore((s) => s.selectedSessionId);
  const projectId = useStore((s) => s.selectedProjectId);

  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        if (sessionId && projectId) {
          void toggleBookmark(sessionId, projectId, groupId);
        }
      }}
      className={cn(
        'shrink-0 transition-opacity',
        isBookmarked
          ? 'text-amber-400 opacity-100'
          : 'text-muted-foreground hover:text-amber-400 opacity-0 group-hover:opacity-100'
      )}
      title={isBookmarked ? 'Remove bookmark' : 'Bookmark this turn'}
    >
      {isBookmarked ? <BookmarkCheck className="size-3.5" /> : <Bookmark className="size-3.5" />}
    </button>
  );
};
