/**
 * SortableTab - A draggable tab item used within SortableContext.
 * Wraps useSortable from @dnd-kit for tab reordering and cross-pane movement.
 * Includes a right-click context menu via shadcn ContextMenu.
 */

import { useCallback } from 'react';

import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from '@renderer/components/ui/context-menu';
import { cn } from '@renderer/lib/utils';
import { useStore } from '@renderer/store';
import { formatShortcut } from '@renderer/utils/stringUtils';
import {
  Bell,
  FileText,
  FolderGit2,
  LayoutDashboard,
  Pin,
  Search,
  Settings,
  X,
} from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';

import type { Tab } from '@renderer/types/tabs';

interface SortableTabProps {
  tab: Tab;
  paneId: string;
  isActive: boolean;
  isSelected: boolean;
  selectedCount: number;
  onTabClick: (tabId: string, e: React.MouseEvent) => void;
  onMouseDown: (tabId: string, e: React.MouseEvent) => void;
  onClose: (tabId: string) => void;
  onCloseOtherTabs: (tabId: string) => void;
  onCloseAllTabs: () => void;
  onCloseSelectedTabs?: () => void;
  onSplitRight: (tabId: string) => void;
  onSplitLeft: (tabId: string) => void;
  disableSplit: boolean;
  setRef: (tabId: string, el: HTMLDivElement | null) => void;
}

const TAB_ICONS = {
  dashboard: LayoutDashboard,
  projects: FolderGit2,
  notifications: Bell,
  settings: Settings,
  session: FileText,
} as const;

export const SortableTab = ({
  tab,
  paneId,
  isActive,
  isSelected,
  selectedCount,
  onTabClick,
  onMouseDown,
  onClose,
  onCloseOtherTabs,
  onCloseAllTabs,
  onCloseSelectedTabs,
  onSplitRight,
  onSplitLeft,
  disableSplit,
  setRef,
}: SortableTabProps): React.JSX.Element => {
  const { isPinned, isHidden, togglePinSession, toggleHideSession } = useStore(
    useShallow((s) => ({
      isPinned:
        tab.type === 'session' && tab.sessionId
          ? s.pinnedSessionIds.includes(tab.sessionId)
          : false,
      isHidden:
        tab.type === 'session' && tab.sessionId
          ? s.hiddenSessionIds.includes(tab.sessionId)
          : false,
      togglePinSession: s.togglePinSession,
      toggleHideSession: s.toggleHideSession,
    }))
  );

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: tab.id,
    data: {
      type: 'tab',
      tabId: tab.id,
      paneId,
    },
  });

  const Icon = TAB_ICONS[tab.type];
  const isSessionTab = tab.type === 'session';

  const handleRef = useCallback(
    (el: HTMLDivElement | null) => {
      setNodeRef(el);
      setRef(tab.id, el);
    },
    [setNodeRef, setRef, tab.id]
  );

  return (
    <ContextMenu>
      <ContextMenuTrigger
        render={
          <div
            ref={handleRef}
            // eslint-disable-next-line react/jsx-props-no-spreading -- @dnd-kit useSortable requires prop spreading
            {...attributes}
            // eslint-disable-next-line react/jsx-props-no-spreading -- @dnd-kit useSortable requires prop spreading
            {...listeners}
            role="tab"
            tabIndex={0}
            aria-selected={isActive}
            title={tab.label}
            className={cn(
              'group flex max-w-[200px] min-w-0 shrink-0 cursor-grab items-center gap-2 rounded-md px-3 py-1.5',
              isActive
                ? 'bg-card text-foreground'
                : 'text-muted-foreground hover:bg-popover hover:text-foreground',
              isSelected && 'outline outline-1 -outline-offset-1 outline-border'
            )}
            style={
              {
                WebkitAppRegion: 'no-drag',
                transform: CSS.Transform.toString(transform),
                transition: isDragging ? 'none' : transition,
                opacity: isDragging ? 0.3 : undefined,
              } as React.CSSProperties
            }
            onClick={(e) => onTabClick(tab.id, e)}
            onMouseDown={(e) => onMouseDown(tab.id, e)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onTabClick(tab.id, e as unknown as React.MouseEvent);
              }
            }}
          />
        }
      >
        <Icon className="size-4 shrink-0" />
        {tab.fromSearch && (
          <span title="Opened from search">
            <Search className="size-3 shrink-0 text-amber-400" />
          </span>
        )}
        {isPinned && (
          <span title="Pinned session">
            <Pin className="size-3 shrink-0 text-blue-400" />
          </span>
        )}
        <span className="truncate text-sm">{tab.label}</span>
        <button
          className={cn(
            'flex size-4 shrink-0 items-center justify-center rounded-xs bg-transparent transition-opacity group-hover:opacity-100 focus-visible:opacity-100',
            isActive ? 'opacity-50' : 'opacity-0'
          )}
          onClick={(e) => {
            e.stopPropagation();
            onClose(tab.id);
          }}
          onPointerDown={(e) => e.stopPropagation()}
          title="Close tab"
        >
          <X className="size-3" />
        </button>
      </ContextMenuTrigger>

      <ContextMenuContent>
        {selectedCount > 1 && onCloseSelectedTabs ? (
          <ContextMenuItem onClick={onCloseSelectedTabs}>
            Close {selectedCount} Tabs
          </ContextMenuItem>
        ) : (
          <ContextMenuItem onClick={() => onClose(tab.id)}>
            Close Tab
            <ContextMenuShortcut>{formatShortcut('W')}</ContextMenuShortcut>
          </ContextMenuItem>
        )}
        <ContextMenuItem onClick={() => onCloseOtherTabs(tab.id)}>Close Other Tabs</ContextMenuItem>

        <ContextMenuSeparator />
        <ContextMenuItem onClick={() => onSplitRight(tab.id)} disabled={disableSplit}>
          Split Right
          <ContextMenuShortcut>{formatShortcut('\\')}</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem onClick={() => onSplitLeft(tab.id)} disabled={disableSplit}>
          Split Left
        </ContextMenuItem>

        {isSessionTab && tab.sessionId && (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem onClick={() => togglePinSession(tab.sessionId!)}>
              {isPinned ? 'Unpin from Sidebar' : 'Pin to Sidebar'}
            </ContextMenuItem>
            <ContextMenuItem onClick={() => toggleHideSession(tab.sessionId!)}>
              {isHidden ? 'Unhide from Sidebar' : 'Hide from Sidebar'}
            </ContextMenuItem>
          </>
        )}

        <ContextMenuSeparator />
        <ContextMenuItem onClick={onCloseAllTabs}>
          Close All Tabs
          <ContextMenuShortcut>{formatShortcut('W', { shift: true })}</ContextMenuShortcut>
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
};

/**
 * DragOverlayTab - Semi-transparent ghost of a tab shown during drag.
 */
export const DragOverlayTab = ({ tab }: { tab: Tab }): React.JSX.Element => {
  const Icon = TAB_ICONS[tab.type];

  return (
    <div className="bg-card text-foreground flex max-w-[200px] min-w-0 cursor-grabbing items-center gap-2 rounded-md border-2 border-indigo-500 px-3 py-1.5 opacity-90">
      <Icon className="size-4 shrink-0" />
      <span className="truncate text-sm">{tab.label}</span>
    </div>
  );
};
