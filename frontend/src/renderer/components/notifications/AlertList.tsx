import { JSX, type RefObject, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@renderer/components/ui/button';
import { useConversationSubjects } from '@renderer/hooks/useConversationSubjects';
import { useVirtualizer } from '@tanstack/react-virtual';
import { CheckCheck, Inbox, Loader2 } from 'lucide-react';

import {
  getSimpleAlertEmptyState,
  orderAlerts,
  presentSimpleAlert,
} from './alertPresentation';

import type { ConversationSubjectLookup } from '@renderer/hooks/useConversationSubjects';
import type { DetectedError } from '@renderer/types/data';

const VIRTUALIZATION_THRESHOLD = 100;
const ALERT_HEIGHT = 96;
const SENTINEL_HEIGHT = 48;
const VIRTUAL_OVERSCAN = 5;

interface AlertListProps {
  readonly alerts: readonly DetectedError[];
  readonly unreadCount: number;
  readonly loading: boolean;
  readonly initialError: string | null;
  readonly appendError: string | null;
  readonly hasMore: boolean;
  readonly loadingMore: boolean;
  readonly hasEnabledTriggers: boolean;
  readonly onLoad: () => Promise<void>;
  readonly onLoadMore: () => Promise<void>;
  readonly onMarkAllRead: () => Promise<void>;
  readonly onOpenConversation: (alert: DetectedError) => void;
  readonly onOpenSettings: () => void;
}

type AlertListItem =
  | { type: 'alert'; id: string; alert: DetectedError }
  | { type: 'end-sentinel'; id: 'alerts-end-sentinel' };

interface AlertEndSentinelProps {
  readonly isLoadingMore: boolean;
  readonly appendError: string | null;
  readonly sentinelRef: RefObject<HTMLDivElement | null>;
}

function AlertEndSentinel({
  isLoadingMore,
  appendError,
  sentinelRef,
}: AlertEndSentinelProps): JSX.Element {
  return (
    <div
      ref={sentinelRef}
      role="status"
      className="text-muted-foreground flex min-h-12 items-center justify-center gap-2 px-6 text-xs"
    >
      {isLoadingMore ? (
        <>
          <Loader2 aria-hidden="true" className="size-3.5 animate-spin" />
          Loading earlier alerts
        </>
      ) : appendError ? (
        'Earlier alerts could not be loaded'
      ) : (
        'Scroll to load earlier alerts'
      )}
    </div>
  );
}

interface AlertRowProps {
  readonly alert: DetectedError;
  readonly conversationSubjects: ConversationSubjectLookup;
  readonly onOpenConversation: (alert: DetectedError) => void;
}

function AlertRow({
  alert,
  conversationSubjects,
  onOpenConversation,
}: AlertRowProps): JSX.Element {
  const presentation = presentSimpleAlert(alert, conversationSubjects);

  return (
    <article
      className={`border-border/60 flex min-h-24 flex-col gap-2 border-b px-6 py-4 ${
        alert.isRead ? 'opacity-70' : 'bg-primary/5'
      }`}
    >
      <div className="flex min-w-0 items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-foreground truncate text-sm font-medium" title={presentation.source}>
            {presentation.source}
          </p>
          <p className="text-muted-foreground mt-1 break-words text-sm leading-snug">
            {presentation.message}
          </p>
        </div>
        <time
          dateTime={presentation.dateTime ?? undefined}
          className="text-muted-foreground shrink-0 pt-0.5 text-[11px]"
        >
          {presentation.relativeTime}
        </time>
      </div>
      <div className="flex min-w-0 items-center justify-between gap-3">
        <span className="text-muted-foreground min-w-0 truncate text-xs" title={presentation.conversationSubject}>
          {presentation.conversationSubject}
        </span>
        {presentation.target && (
          <Button
            type="button"
            variant="link"
            size="sm"
            onClick={() => onOpenConversation(alert)}
            aria-label={`Open conversation ${presentation.conversationSubject}`}
            className="h-auto shrink-0 px-0 py-1 text-xs"
          >
            Open conversation
          </Button>
        )}
      </div>
    </article>
  );
}

export const AlertList = ({
  alerts,
  unreadCount,
  loading,
  initialError,
  appendError,
  hasMore,
  loadingMore,
  hasEnabledTriggers,
  onLoad,
  onLoadMore,
  onMarkAllRead,
  onOpenConversation,
  onOpenSettings,
}: AlertListProps): JSX.Element => {
  const parentRef = useRef<HTMLDivElement>(null);
  const endSentinelRef = useRef<HTMLDivElement>(null);
  const previousIdsRef = useRef<Set<string>>(new Set());
  const [announcement, setAnnouncement] = useState('');
  const orderedAlerts = useMemo(() => orderAlerts(alerts), [alerts]);
  const conversationIdentities = useMemo(
    () =>
      orderedAlerts
        .filter((alert) => alert.projectId.trim() && alert.sessionId.trim())
        .map((alert) => ({
          projectId: alert.projectId.trim(),
          sessionId: alert.sessionId.trim(),
        })),
    [orderedAlerts]
  );
  const conversationSubjects = useConversationSubjects(conversationIdentities);
  const items = useMemo<AlertListItem[]>(
    () => [
      ...orderedAlerts.map((alert) => ({ type: 'alert' as const, id: alert.id, alert })),
      ...(hasMore ? [{ type: 'end-sentinel' as const, id: 'alerts-end-sentinel' as const }] : []),
    ],
    [hasMore, orderedAlerts]
  );
  const isVirtualized = items.length > VIRTUALIZATION_THRESHOLD;

  useEffect(() => {
    const previousIds = previousIdsRef.current;
    if (previousIds.size > 0) {
      const addedCount = alerts.filter((alert) => !previousIds.has(alert.id)).length;
      if (addedCount > 0) {
        setAnnouncement(
          `${addedCount} ${addedCount === 1 ? 'alert was' : 'alerts were'} added to the list`
        );
      }
    }
    previousIdsRef.current = new Set(alerts.map((alert) => alert.id));
  }, [alerts]);

  // eslint-disable-next-line react-hooks/incompatible-library -- TanStack Virtual API limitation, not fixable in user code
  const rowVirtualizer = useVirtualizer({
    count: isVirtualized ? items.length : 0,
    getScrollElement: () => parentRef.current,
    estimateSize: (index) => (items[index]?.type === 'end-sentinel' ? SENTINEL_HEIGHT : ALERT_HEIGHT),
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
      !hasMore ||
      loadingMore ||
      appendError ||
      initialError
    ) {
      return;
    }

    void onLoadMore();
  }, [appendError, hasMore, initialError, isEndSentinelVisible, isVirtualized, loadingMore, onLoadMore]);

  useEffect(() => {
    if (
      isVirtualized ||
      !hasMore ||
      loadingMore ||
      appendError ||
      initialError ||
      !endSentinelRef.current
    ) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          void onLoadMore();
        }
      },
      { root: parentRef.current, rootMargin: '200px' }
    );
    observer.observe(endSentinelRef.current);
    return () => observer.disconnect();
  }, [appendError, hasMore, initialError, isVirtualized, loadingMore, onLoadMore, items.length]);

  const emptyState = getSimpleAlertEmptyState(alerts, hasEnabledTriggers);
  const hasAlerts = alerts.length > 0;

  const renderItem = (item: AlertListItem): JSX.Element => {
    if (item.type === 'end-sentinel') {
      return (
        <AlertEndSentinel
          isLoadingMore={loadingMore}
          appendError={appendError}
          sentinelRef={endSentinelRef}
        />
      );
    }

    return (
      <AlertRow
        alert={item.alert}
        conversationSubjects={conversationSubjects}
        onOpenConversation={onOpenConversation}
      />
    );
  };

  return (
    <section
      aria-labelledby="alerts-heading"
      className="bg-background flex h-full flex-1 flex-col overflow-hidden"
    >
      <header className="border-border/60 flex shrink-0 items-center justify-between gap-4 border-b px-6 py-5">
        <div>
          <h1 id="alerts-heading" className="text-foreground text-lg font-semibold tracking-tight">
            Alerts
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            {unreadCount} unread {unreadCount === 1 ? 'alert' : 'alerts'}
          </p>
        </div>
        {unreadCount > 0 && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => void onMarkAllRead()}
            aria-label="Mark all read"
          >
            <CheckCheck aria-hidden="true" />
            <span>Mark all read</span>
          </Button>
        )}
      </header>

      {initialError && (
        <div
          role="alert"
          className="border-destructive/30 bg-destructive/10 flex items-center justify-between gap-4 border-b px-6 py-3 text-sm"
        >
          <span className="text-destructive">Could not load alerts.</span>
          <Button type="button" variant="outline" size="sm" onClick={() => void onLoad()}>
            Retry
          </Button>
        </div>
      )}

      {appendError && hasAlerts && (
        <div
          role="alert"
          className="border-destructive/30 bg-destructive/10 flex items-center justify-between gap-4 border-b px-6 py-3 text-sm"
        >
          <span className="text-destructive">Could not load earlier alerts.</span>
          <Button type="button" variant="outline" size="sm" onClick={() => void onLoadMore()}>
            Retry
          </Button>
        </div>
      )}

      {loading && !hasAlerts ? (
        <div role="status" className="text-muted-foreground flex flex-1 items-center justify-center px-6 text-sm">
          <Loader2 aria-hidden="true" className="mr-2 size-4 animate-spin" />
          Loading alerts
        </div>
      ) : initialError && !hasAlerts ? (
        <div className="flex flex-1 items-center justify-center px-6 text-center">
          <p className="text-muted-foreground text-sm">Retry to load your alerts.</p>
        </div>
      ) : emptyState === 'no-enabled-triggers' ? (
        <div className="flex flex-1 items-center justify-center px-6 text-center">
          <div className="max-w-sm">
            <Inbox aria-hidden="true" className="text-muted-foreground mx-auto mb-3 size-10 opacity-40" />
            <p className="text-foreground text-sm font-medium">No alert triggers are enabled</p>
            <p className="text-muted-foreground mt-1 text-sm">
              Enable a trigger in notification settings to start collecting alerts.
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onOpenSettings}
              className="mt-4"
            >
              Open notification settings
            </Button>
          </div>
        </div>
      ) : emptyState === 'no-records' ? (
        <div className="flex flex-1 items-center justify-center px-6 text-center">
          <div className="max-w-sm">
            <Inbox aria-hidden="true" className="text-muted-foreground mx-auto mb-3 size-10 opacity-40" />
            <p className="text-foreground text-sm font-medium">No alerts yet</p>
            <p className="text-muted-foreground mt-1 text-sm">
              Alerts will appear here when an enabled trigger matches.
            </p>
          </div>
        </div>
      ) : isVirtualized ? (
        <div ref={parentRef} role="list" aria-label="Alerts" className="flex-1 overflow-y-auto">
          <div className="relative w-full" style={{ height: `${rowVirtualizer.getTotalSize()}px` }}>
            {virtualRows.map((virtualRow) => {
              const item = items[virtualRow.index];
              if (!item) return null;

              return (
                <div
                  key={item.id}
                  ref={rowVirtualizer.measureElement}
                  data-index={virtualRow.index}
                  role={item.type === 'alert' ? 'listitem' : undefined}
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
        <div ref={parentRef} role="list" aria-label="Alerts" className="flex-1 overflow-y-auto">
          {items.map((item) => (
            <div key={item.id} role={item.type === 'alert' ? 'listitem' : undefined}>
              {renderItem(item)}
            </div>
          ))}
        </div>
      )}

      <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {announcement}
      </div>
    </section>
  );
};
