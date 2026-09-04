import { JSX, useEffect, useMemo, useRef, useState } from 'react';
import { AlertList } from '@renderer/components/notifications/AlertList';
import { Button } from '@renderer/components/ui/button';
import { confirm } from '@renderer/components/common/ConfirmDialog';
import { EmptyState } from '@renderer/components/common/EmptyState';
import { ErrorState } from '@renderer/components/common/ErrorState';
import { LoadingState } from '@renderer/components/common/LoadingState';
import { useUIMode } from '@renderer/hooks/useUIMode';
import { cn } from '@renderer/lib/utils';
import { useStore } from '@renderer/store';
import { getTriggerColorDef } from '@shared/constants/triggerColors';
import { useVirtualizer } from '@tanstack/react-virtual';
import { CheckCheck, Inbox, Trash2 } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';

import { getAlertTarget, orderAlerts } from './alertPresentation';
import { NotificationRow } from './NotificationRow';

import type { DetectedError } from '@renderer/types/data';

const ROW_HEIGHT = 56;
const OVERSCAN = 5;
const estimateSize = (): number => ROW_HEIGHT;

const OTHER_LABEL = 'Other';

interface FilterChip {
  label: string;
  count: number;
  colorHex: string;
}

interface NerdNotificationsViewProps {
  readonly notifications: DetectedError[];
  readonly unreadCount: number;
  readonly notificationsLoading: boolean;
  readonly notificationsError: string | null;
  readonly notificationsHasMore: boolean;
  readonly fetchNotifications: () => Promise<void>;
  readonly markNotificationRead: (id: string) => Promise<void>;
  readonly markAllNotificationsRead: (triggerName?: string) => Promise<void>;
  readonly deleteNotification: (id: string) => Promise<void>;
  readonly clearNotifications: (triggerName?: string) => Promise<void>;
  readonly navigateToError: (error: DetectedError) => void;
}

const NerdNotificationsView = ({
  notifications,
  unreadCount,
  notificationsLoading,
  notificationsError,
  notificationsHasMore,
  fetchNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  deleteNotification,
  clearNotifications,
  navigateToError,
}: NerdNotificationsViewProps): JSX.Element => {
  const parentRef = useRef<HTMLDivElement>(null);
  const [activeFilter, setActiveFilter] = useState<string | null>(null);
  const sortedNotifications = useMemo(() => orderAlerts(notifications), [notifications]);
  const filterChips = useMemo((): FilterChip[] => {
    const counts = new Map<string, { count: number; colorHex: string }>();
    for (const notification of sortedNotifications) {
      const label = notification.triggerName ?? OTHER_LABEL;
      const existing = counts.get(label);
      if (existing) {
        existing.count++;
      } else {
        counts.set(label, {
          count: 1,
          colorHex: getTriggerColorDef(notification.triggerColor).hex,
        });
      }
    }
    return Array.from(counts.entries())
      .sort((left, right) => right[1].count - left[1].count)
      .map(([label, { count, colorHex }]) => ({ label, count, colorHex }));
  }, [sortedNotifications]);

  useEffect(() => {
    if (notifications.length === 0) setActiveFilter(null);
  }, [notifications.length]);

  const filteredNotifications = useMemo(() => {
    if (activeFilter === null) return sortedNotifications;
    return sortedNotifications.filter((notification) => {
      const label = notification.triggerName ?? OTHER_LABEL;
      return label === activeFilter;
    });
  }, [activeFilter, sortedNotifications]);

  // eslint-disable-next-line react-hooks/incompatible-library -- TanStack Virtual API limitation, not fixable in user code
  const rowVirtualizer = useVirtualizer({
    count: filteredNotifications.length,
    getScrollElement: () => parentRef.current,
    estimateSize,
    overscan: OVERSCAN,
  });

  useEffect(() => {
    rowVirtualizer.scrollToIndex(0);
  }, [activeFilter, rowVirtualizer]);

  const filteredUnreadCount = useMemo(() => {
    if (activeFilter === null) return unreadCount;
    return filteredNotifications.filter((notification) => !notification.isRead).length;
  }, [activeFilter, filteredNotifications, unreadCount]);

  const handleMarkAllRead = async (): Promise<void> => {
    await markAllNotificationsRead(activeFilter ?? undefined);
  };

  const handleClearAll = async (): Promise<void> => {
    const confirmed = await confirm({
      title: activeFilter !== null ? 'Clear filtered notifications' : 'Clear all notifications',
      message: 'Removed immediately — notifications are not moved to trash.',
      confirmLabel: 'Clear',
      variant: 'danger',
    });
    if (!confirmed) return;
    await clearNotifications(activeFilter ?? undefined);
  };

  const handleRowClick = (error: DetectedError): void => {
    if (!error.isRead) void markNotificationRead(error.id);
    navigateToError(error);
  };

  const handleFilterClick = (label: string): void => {
    setActiveFilter((previous) => (previous === label ? null : label));
  };

  const headerStatus =
    activeFilter !== null
      ? filteredUnreadCount > 0
        ? `${filteredUnreadCount} unread in filter`
        : `${filteredNotifications.length} loaded in filter`
      : unreadCount > 0
        ? `${unreadCount} unread`
        : notificationsHasMore
          ? `${notifications.length} loaded`
          : `${notifications.length} total`;

  return (
    <div className="bg-background flex flex-1 flex-col overflow-hidden">
      <div className="border-border/50 shrink-0 border-b">
        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex min-w-0 items-center gap-2">
            <Inbox aria-hidden="true" className="text-muted-foreground size-4 shrink-0" />
            <span className="text-foreground text-sm font-medium">Notifications</span>
            {notifications.length > 0 && (
              <span className="text-muted-foreground truncate text-xs">
                {activeFilter !== null && `Filter: ${activeFilter} · `}
                {headerStatus}
              </span>
            )}
          </div>

          {notifications.length > 0 && (
            <div className="flex items-center gap-1">
              {filteredUnreadCount > 0 && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => void handleMarkAllRead()}
                  aria-label={activeFilter !== null ? 'Mark filtered as read' : 'Mark all as read'}
                  title={activeFilter !== null ? 'Mark filtered as read' : 'Mark all as read'}
                >
                  <CheckCheck aria-hidden="true" />
                  <span className="hidden sm:inline">
                    {activeFilter !== null ? 'Mark filtered read' : 'Mark all read'}
                  </span>
                </Button>
              )}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => void handleClearAll()}
                aria-label={
                  activeFilter !== null ? 'Clear filtered notifications' : 'Clear all notifications'
                }
                title={activeFilter !== null ? 'Clear filtered notifications' : 'Clear all notifications'}
              >
                <Trash2 aria-hidden="true" />
                <span className="hidden sm:inline">
                  {activeFilter !== null ? 'Clear filtered' : 'Clear all'}
                </span>
              </Button>
            </div>
          )}
        </div>
      </div>

      {notificationsError && (
        <div
          role="alert"
          className="border-destructive/30 bg-destructive/10 flex items-center justify-between gap-4 border-b px-4 py-3 text-sm"
        >
          <span className="text-destructive">Could not load notifications.</span>
          <Button type="button" variant="outline" size="sm" onClick={() => void fetchNotifications()}>
            Retry
          </Button>
        </div>
      )}

      {filterChips.length > 1 && (
        <div className="scrollbar-none border-border/50 shrink-0 overflow-x-auto border-b">
          <div className="flex items-center gap-1.5 px-4 py-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setActiveFilter(null)}
              aria-pressed={activeFilter === null}
              className={cn(
                'h-auto shrink-0 rounded-full border px-2.5 py-1 text-xs',
                activeFilter === null
                  ? 'border-border bg-card text-foreground'
                  : 'border-border text-muted-foreground'
              )}
            >
              All <span className="opacity-60">({sortedNotifications.length})</span>
            </Button>
            {filterChips.map((chip) => (
              <Button
                key={chip.label}
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => handleFilterClick(chip.label)}
                aria-pressed={activeFilter === chip.label}
                aria-label={`${chip.label}, ${chip.count} loaded`}
                className={cn(
                  'h-auto shrink-0 gap-1.5 rounded-full border px-2.5 py-1 text-xs',
                  activeFilter === chip.label
                    ? 'border-border bg-card text-foreground'
                    : 'border-border text-muted-foreground'
                )}
              >
                <span
                  aria-hidden="true"
                  className="size-2 rounded-full"
                  style={{ backgroundColor: chip.colorHex }}
                />
                {chip.label}
                <span className="opacity-60">({chip.count})</span>
              </Button>
            ))}
          </div>
        </div>
      )}

      <div ref={parentRef} className="flex-1 overflow-y-auto">
        {notificationsLoading && notifications.length === 0 ? (
          <LoadingState label="Loading notifications" rows={6} />
        ) : notificationsError && notifications.length === 0 ? (
          <ErrorState
            message="Could not load notifications."
            detail={notificationsError}
            onRetry={() => void fetchNotifications()}
          />
        ) : filteredNotifications.length === 0 ? (
          <EmptyState
            icon={Inbox}
            title={activeFilter !== null ? 'No matching notifications' : 'No notifications'}
            hint={activeFilter !== null ? 'Try a different filter' : "You're all caught up!"}
          />
        ) : (
          <div
            style={{
              height: `${rowVirtualizer.getTotalSize()}px`,
              width: '100%',
              position: 'relative',
            }}
          >
            {rowVirtualizer.getVirtualItems().map((virtualRow) => {
              const notification = filteredNotifications[virtualRow.index];
              if (!notification) return null;

              return (
                <div
                  key={virtualRow.key}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: `${virtualRow.size}px`,
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                >
                  <NotificationRow
                    error={notification}
                    onRowClick={() => handleRowClick(notification)}
                    onArchive={() => void markNotificationRead(notification.id)}
                    onDelete={() => void deleteNotification(notification.id)}
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export const NotificationsView = (): JSX.Element => {
  const mode = useUIMode();
  const {
    notifications,
    unreadCount,
    notificationsLoading,
    notificationsError,
    notificationsHasMore,
    notificationsLoadingMore,
    notificationsAppendError,
    appConfig,
    fetchNotifications,
    fetchMoreNotifications,
    markNotificationRead,
    markAllNotificationsRead,
    deleteNotification,
    clearNotifications,
    navigateToError,
    navigateToSession,
    openSettingsTab,
  } = useStore(
    useShallow((state) => ({
      notifications: state.notifications,
      unreadCount: state.unreadCount,
      notificationsLoading: state.notificationsLoading,
      notificationsError: state.notificationsError,
      notificationsHasMore: state.notificationsHasMore,
      notificationsLoadingMore: state.notificationsLoadingMore,
      notificationsAppendError: state.notificationsAppendError,
      appConfig: state.appConfig,
      fetchNotifications: state.fetchNotifications,
      fetchMoreNotifications: state.fetchMoreNotifications,
      markNotificationRead: state.markNotificationRead,
      markAllNotificationsRead: state.markAllNotificationsRead,
      deleteNotification: state.deleteNotification,
      clearNotifications: state.clearNotifications,
      navigateToError: state.navigateToError,
      navigateToSession: state.navigateToSession,
      openSettingsTab: state.openSettingsTab,
    }))
  );

  useEffect(() => {
    void fetchNotifications();
  }, [fetchNotifications]);

  if (mode === 'simple') {
    const hasEnabledTriggers =
      appConfig === null || Boolean(appConfig.notifications.triggers?.some((trigger) => trigger.enabled));
    const openSimpleConversation = (alert: DetectedError): void => {
      const target = getAlertTarget(alert);
      if (!target) return;
      if (!alert.isRead) void markNotificationRead(alert.id);
      navigateToSession(target.projectId, target.sessionId);
    };

    return (
      <AlertList
        alerts={notifications}
        unreadCount={unreadCount}
        loading={notificationsLoading}
        initialError={notificationsError}
        appendError={notificationsAppendError}
        hasMore={notificationsHasMore}
        loadingMore={notificationsLoadingMore}
        hasEnabledTriggers={hasEnabledTriggers}
        onLoad={fetchNotifications}
        onLoadMore={fetchMoreNotifications}
        onMarkAllRead={() => markAllNotificationsRead()}
        onOpenConversation={openSimpleConversation}
        onOpenSettings={() => openSettingsTab('notifications')}
      />
    );
  }

  return (
    <NerdNotificationsView
      notifications={notifications}
      unreadCount={unreadCount}
      notificationsLoading={notificationsLoading}
      notificationsError={notificationsError}
      notificationsHasMore={notificationsHasMore}
      fetchNotifications={fetchNotifications}
      markNotificationRead={markNotificationRead}
      markAllNotificationsRead={markAllNotificationsRead}
      deleteNotification={deleteNotification}
      clearNotifications={clearNotifications}
      navigateToError={navigateToError}
    />
  );
};
