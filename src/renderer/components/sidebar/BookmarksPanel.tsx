import { useEffect } from 'react';

import { cn } from '@renderer/lib/utils';
import { useStore } from '@renderer/store';
import { formatDistanceToNowStrict } from 'date-fns';
import { Bookmark, BookmarkX, MessageSquare } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';

import { Button } from '../ui/button';

import type { BookmarkEntry } from '@renderer/store/slices/configSlice';

/**
 * BookmarksPanel - Lists all bookmarks with navigation to their AI groups.
 */
export const BookmarksPanel = (): React.JSX.Element => {
  const { bookmarks, bookmarksLoading, fetchBookmarks, removeBookmark, navigateToSession } =
    useStore(
      useShallow((s) => ({
        bookmarks: s.bookmarks,
        bookmarksLoading: s.bookmarksLoading,
        fetchBookmarks: s.fetchBookmarks,
        removeBookmark: s.removeBookmark,
        navigateToSession: s.navigateToSession,
      }))
    );

  useEffect(() => {
    void fetchBookmarks();
  }, [fetchBookmarks]);

  if (bookmarksLoading && bookmarks.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center px-4 py-12">
        <div className="text-muted-foreground text-xs">Loading bookmarks...</div>
      </div>
    );
  }

  if (bookmarks.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center px-4 py-12">
        <Bookmark className="text-muted-foreground mb-2 size-6" />
        <p className="text-muted-foreground mb-1 text-xs">No bookmarks yet</p>
        <p className="text-muted-foreground text-[10px]">
          Click the bookmark icon on any AI turn to save it
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-0.5 px-1 py-1">
      {bookmarks.map((bookmark) => (
        <BookmarkItem
          key={bookmark.id}
          bookmark={bookmark}
          onNavigate={() => navigateToSession(bookmark.projectId, bookmark.sessionId)}
          onRemove={() => void removeBookmark(bookmark.id)}
        />
      ))}
    </div>
  );
};

const BookmarkItem = ({
  bookmark,
  onNavigate,
  onRemove,
}: Readonly<{
  bookmark: BookmarkEntry;
  onNavigate: () => void;
  onRemove: () => void;
}>): React.JSX.Element => {
  const timeAgo = formatDistanceToNowStrict(new Date(bookmark.createdAt), { addSuffix: true });

  return (
    <div
      className={cn(
        'group flex items-center gap-2 rounded-sm px-2 py-1.5 transition-colors',
        'hover:bg-surface-raised cursor-pointer'
      )}
      onClick={onNavigate}
    >
      <MessageSquare className="text-amber-400/70 size-3.5 shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="text-foreground truncate text-xs">{bookmark.groupId}</div>
        <div className="text-muted-foreground text-[10px]">{timeAgo}</div>
      </div>
      <Button
        variant="ghost"
        size="icon-xs"
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
        className="text-muted-foreground hover:text-red-400 shrink-0 opacity-0 group-hover:opacity-100"
        title="Remove bookmark"
      >
        <BookmarkX className="size-3" />
      </Button>
    </div>
  );
};
