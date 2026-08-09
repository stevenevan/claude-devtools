import { JSX, RefObject, useEffect, useMemo, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Button } from '@renderer/components/ui/button';
import { conversationSubjectKey, useConversationSubjects } from '@renderer/hooks/useConversationSubjects';
import { useStore } from '@renderer/store';
import { Loader2 } from 'lucide-react';

import {
  appendConversationEndSentinel,
  buildConversationListItems,
  type ConversationListItem,
} from './conversationListHelpers';
import {
  formatApproximateConversationCost,
  formatConversationMessageCount,
  formatConversationTime,
} from './dashboardFormatters';

const VIRTUALIZATION_THRESHOLD = 100;
const CONVERSATION_HEIGHT = 72;
const HEADING_HEIGHT = 36;
const SENTINEL_HEIGHT = 48;
const VIRTUAL_OVERSCAN = 5;

interface ConversationListItemViewProps {
  item: ConversationListItem;
  isLoadingMore: boolean;
  conversationSubjects: ReadonlyMap<string, string>;
  onOpenConversation: (projectId: string, sessionId: string) => void;
  endSentinelRef: RefObject<HTMLDivElement | null>;
}

const ConversationListItemView = ({
  item,
  isLoadingMore,
  conversationSubjects,
  onOpenConversation,
  endSentinelRef,
}: Readonly<ConversationListItemViewProps>): JSX.Element => {
  if (item.type === 'heading') {
    return (
      <div className="border-border/60 bg-muted/30 flex min-h-9 items-center border-b px-6">
        <h2 className="text-muted-foreground text-[11px] font-semibold tracking-wide">{item.label}</h2>
      </div>
    );
  }

  if (item.type === 'end-sentinel') {
    return (
      <div
        ref={endSentinelRef}
        role="status"
        className="text-muted-foreground flex min-h-12 items-center justify-center gap-2 px-6 text-xs"
      >
        {isLoadingMore ? (
          <>
            <Loader2 className="size-3.5 animate-spin" />
            Loading more conversations
          </>
        ) : (
          'Scroll to load more conversations'
        )}
      </div>
    );
  }

  const { session } = item;
  const subject =
    conversationSubjects.get(
      conversationSubjectKey({ projectId: session.projectId, sessionId: session.id })
    ) ?? 'Untitled conversation';
  const relativeTime = formatConversationTime(session.createdAt);
  const messageCount = formatConversationMessageCount(session.messageCount);
  const cost = formatApproximateConversationCost(session.costUsd);

  return (
    <Button
      type="button"
      variant="ghost"
      onClick={() => onOpenConversation(session.projectId, session.id)}
      aria-label={`${subject}, ${relativeTime}, ${messageCount}, ${cost}`}
      className="h-auto min-h-[72px] w-full flex-col items-start gap-1 rounded-none border-b border-border/60 px-6 py-3 text-left hover:bg-muted/60"
    >
      <span className="text-foreground w-full truncate text-sm font-medium" title={subject}>
        {subject}
      </span>
      <span className="text-muted-foreground flex w-full flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
        <time dateTime={new Date(session.createdAt).toISOString()}>{relativeTime}</time>
        <span aria-hidden="true">·</span>
        <span>{messageCount}</span>
        <span aria-hidden="true">·</span>
        <span>{cost}</span>
      </span>
    </Button>
  );
};

export const ConversationList = (): JSX.Element => {
  const conversationFeedRows = useStore((state) => state.conversationFeedRows);
  const conversationFeedHasMore = useStore((state) => state.conversationFeedHasMore);
  const conversationFeedLoading = useStore((state) => state.conversationFeedLoading);
  const conversationFeedLoadingMore = useStore((state) => state.conversationFeedLoadingMore);
  const conversationFeedError = useStore((state) => state.conversationFeedError);
  const fetchConversationFeed = useStore((state) => state.fetchConversationFeed);
  const fetchMoreConversationFeed = useStore((state) => state.fetchMoreConversationFeed);
  const navigateToSession = useStore((state) => state.navigateToSession);
  const parentRef = useRef<HTMLDivElement>(null);
  const endSentinelRef = useRef<HTMLDivElement>(null);
  const conversationSubjectIdentities = useMemo(
    () =>
      conversationFeedRows.map(({ projectId, id }) => ({
        projectId,
        sessionId: id,
      })),
    [conversationFeedRows]
  );
  const conversationSubjects = useConversationSubjects(conversationSubjectIdentities);

  useEffect(() => {
    void fetchConversationFeed();
  }, [fetchConversationFeed]);

  const flattenedItems = useMemo(
    () => buildConversationListItems(conversationFeedRows),
    [conversationFeedRows]
  );
  const items = useMemo(
    () => appendConversationEndSentinel(flattenedItems, conversationFeedHasMore),
    [flattenedItems, conversationFeedHasMore]
  );
  const isVirtualized = items.length > VIRTUALIZATION_THRESHOLD;

  // eslint-disable-next-line react-hooks/incompatible-library -- TanStack Virtual API limitation, not fixable in user code
  const rowVirtualizer = useVirtualizer({
    count: isVirtualized ? items.length : 0,
    getScrollElement: () => parentRef.current,
    estimateSize: (index) => {
      const item = items[index];
      if (item?.type === 'heading') return HEADING_HEIGHT;
      if (item?.type === 'end-sentinel') return SENTINEL_HEIGHT;
      return CONVERSATION_HEIGHT;
    },
    getItemKey: (index) => items[index]?.id ?? index,
    measureElement: (element) => element.getBoundingClientRect().height,
    overscan: VIRTUAL_OVERSCAN,
  });
  const virtualRows = rowVirtualizer.getVirtualItems();
  const lastVirtualIndex = virtualRows[virtualRows.length - 1]?.index;
  const isEndSentinelVisible =
    lastVirtualIndex === items.length - 1 && items[items.length - 1]?.type === 'end-sentinel';

  useEffect(() => {
    if (
      !isVirtualized ||
      !isEndSentinelVisible ||
      !conversationFeedHasMore ||
      conversationFeedLoadingMore ||
      conversationFeedError
    ) {
      return;
    }

    void fetchMoreConversationFeed();
  }, [
    isVirtualized,
    isEndSentinelVisible,
    conversationFeedHasMore,
    conversationFeedLoadingMore,
    conversationFeedError,
    fetchMoreConversationFeed,
  ]);

  useEffect(() => {
    if (
      isVirtualized ||
      !conversationFeedHasMore ||
      conversationFeedLoadingMore ||
      conversationFeedError
    ) {
      return;
    }

    const sentinel = endSentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          void fetchMoreConversationFeed();
        }
      },
      { root: parentRef.current, rootMargin: '200px' }
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [
    isVirtualized,
    conversationFeedHasMore,
    conversationFeedLoadingMore,
    conversationFeedError,
    fetchMoreConversationFeed,
    items.length,
  ]);

  const openConversation = (projectId: string, sessionId: string): void => {
    navigateToSession(projectId, sessionId);
  };

  const renderItem = (item: ConversationListItem): JSX.Element => (
    <ConversationListItemView
      item={item}
      isLoadingMore={conversationFeedLoadingMore}
      conversationSubjects={conversationSubjects}
      onOpenConversation={openConversation}
      endSentinelRef={endSentinelRef}
    />
  );

  const hasRows = conversationFeedRows.length > 0;
  const canRetryAppend = hasRows && conversationFeedHasMore;

  return (
    <section
      aria-labelledby="conversation-list-heading"
      className="bg-background flex h-full flex-1 flex-col overflow-hidden"
    >
      <header className="border-border/60 shrink-0 border-b px-6 py-5">
        <h1 id="conversation-list-heading" className="text-foreground text-lg font-semibold tracking-tight">
          Conversations
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Recent conversations across your projects.
        </p>
      </header>

      {conversationFeedError && (
        <div role="alert" className="border-destructive/30 bg-destructive/10 flex items-center justify-between gap-4 border-b px-6 py-3 text-sm">
          <span className="text-destructive">Could not load conversations.</span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() =>
              void (canRetryAppend ? fetchMoreConversationFeed() : fetchConversationFeed(true))
            }
          >
            Retry
          </Button>
        </div>
      )}

      {conversationFeedLoading && !hasRows ? (
        <div role="status" className="text-muted-foreground flex flex-1 items-center justify-center px-6 text-sm">
          <Loader2 className="mr-2 size-4 animate-spin" />
          Loading conversations
        </div>
      ) : conversationFeedError && !hasRows ? (
        <div className="flex flex-1 items-center justify-center px-6 text-center">
          <p className="text-muted-foreground text-sm">Retry to load your conversations.</p>
        </div>
      ) : !hasRows ? (
        <div className="flex flex-1 items-center justify-center px-6 text-center">
          <div className="max-w-sm">
            <p className="text-foreground text-sm font-medium">No conversations yet</p>
            <p className="text-muted-foreground mt-1 text-sm">
              Start a conversation in Claude Code and it will appear here.
            </p>
          </div>
        </div>
      ) : isVirtualized ? (
        <div
          ref={parentRef}
          role="list"
          aria-label="Conversation list"
          className="flex-1 overflow-y-auto"
        >
          <div className="relative w-full" style={{ height: `${rowVirtualizer.getTotalSize()}px` }}>
            {virtualRows.map((virtualRow) => {
              const item = items[virtualRow.index];
              if (!item) return null;

              return (
                <div
                  key={item.id}
                  ref={rowVirtualizer.measureElement}
                  data-index={virtualRow.index}
                  role={item.type === 'conversation' ? 'listitem' : undefined}
                  className="absolute top-0 left-0 w-full"
                  style={{ transform: `translateY(${virtualRow.start}px)` }}
                >
                  {renderItem(item)}
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div
          ref={parentRef}
          role="list"
          aria-label="Conversation list"
          className="flex-1 overflow-y-auto"
        >
          {items.map((item) => (
            <div key={item.id} role={item.type === 'conversation' ? 'listitem' : undefined}>
              {renderItem(item)}
            </div>
          ))}
        </div>
      )}
    </section>
  );
};
