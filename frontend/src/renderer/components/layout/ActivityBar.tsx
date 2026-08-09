import { ComponentType, JSX } from 'react';
import { isDesktopMode } from '@renderer/api';
import { Button } from '@renderer/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@renderer/components/ui/tooltip';
import { useUIMode } from '@renderer/hooks/useUIMode';
import { cn } from '@renderer/lib/utils';
import { useStore } from '@renderer/store';
import {
  BarChart3,
  Bell,
  Bot,
  DollarSign,
  FolderGit2,
  HelpCircle,
  History,
  ListTodo,
  MessageSquareText,
  Puzzle,
  ScrollText,
  Settings,
  Sparkles,
  Store,
  Workflow,
  Wrench,
} from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';

import { MoreMenu } from './MoreMenu';

import type { ActivityView } from '@renderer/store/slices/uiSlice';

type ActivityItem = {
  activity: ActivityView;
  label: string;
  icon: ComponentType<{ className?: string }>;
  badge?: number;
};

const SIMPLE_ITEMS: ReadonlyArray<ActivityItem> = [
  { activity: 'projects', label: 'Conversations', icon: FolderGit2 },
  { activity: 'analytics', label: 'Cost', icon: DollarSign },
  { activity: 'todos', label: 'Tasks', icon: ListTodo },
];

const NERD_ITEMS: ReadonlyArray<ActivityItem> = [
  { activity: 'projects', label: 'Projects', icon: FolderGit2 },
  { activity: 'analytics', label: 'Analytics', icon: BarChart3 },
  { activity: 'agents', label: 'Agents', icon: Bot },
  { activity: 'skills', label: 'Skills', icon: Sparkles },
  { activity: 'plugins', label: 'Plugins', icon: Puzzle },
  { activity: 'annotations', label: 'Annotations', icon: MessageSquareText },
  { activity: 'todos', label: 'Todos', icon: ListTodo },
];

const NERD_DESKTOP_ITEMS: ReadonlyArray<ActivityItem> = [
  { activity: 'history', label: 'History', icon: History },
  { activity: 'transcripts', label: 'Transcripts', icon: ScrollText },
  { activity: 'marketplace', label: 'Marketplace', icon: Store },
  { activity: 'taskGraph', label: 'Task Graph', icon: Workflow },
  { activity: 'maintenance', label: 'Maintenance', icon: Wrench },
];

export const ActivityBar = (): JSX.Element => {
  const mode = useUIMode();
  const { activeActivity, setActiveActivity, unreadCount, setHelpPanelOpen } = useStore(
    useShallow((state) => ({
      activeActivity: state.activeActivity,
      setActiveActivity: state.setActiveActivity,
      unreadCount: state.unreadCount,
      setHelpPanelOpen: state.setHelpPanelOpen,
    }))
  );
  const nerdItems = isDesktopMode() ? [...NERD_ITEMS, ...NERD_DESKTOP_ITEMS] : NERD_ITEMS;
  const items = mode === 'simple' ? SIMPLE_ITEMS : nerdItems;

  const renderItem = ({ activity, label, icon: Icon, badge }: ActivityItem): JSX.Element => {
    const isActive = activeActivity === activity;
    const content = (
      <Button
        key={activity}
        variant="ghost"
        size={mode === 'simple' ? 'default' : 'icon'}
        role="tab"
        aria-selected={isActive}
        aria-label={badge ? `${label}, ${badge} unread` : label}
        onClick={() => setActiveActivity(activity)}
        className={cn(
          'relative h-9 transition-colors',
          mode === 'simple' ? 'w-full justify-start gap-3 px-2' : 'size-9 justify-center',
          isActive ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground'
        )}
      >
        {isActive && <span className="absolute top-1 bottom-1 left-0 w-0.5 rounded-r-full bg-indigo-500" />}
        <Icon className="size-5" />
        {mode === 'simple' && <span>{label}</span>}
        {badge != null && badge > 0 && (
          <span className="bg-destructive text-destructive-foreground absolute -top-0.5 -right-0.5 flex size-3.5 items-center justify-center rounded-full text-[8px] font-bold">
            {badge > 9 ? '9+' : badge}
          </span>
        )}
      </Button>
    );

    if (mode === 'simple') return content;
    return (
      <Tooltip key={activity}>
        <TooltipTrigger render={content} />
        <TooltipContent side="right" sideOffset={8}>{label}</TooltipContent>
      </Tooltip>
    );
  };

  return (
    <TooltipProvider delay={300}>
      <nav
        role="tablist"
        aria-orientation="vertical"
        aria-label="App navigation"
        className={cn(
          'border-border bg-sidebar flex shrink-0 flex-col border-r py-2',
          mode === 'simple' ? 'w-40 px-2' : 'w-11 items-center px-1'
        )}
      >
        <div className="flex w-full flex-col gap-1">{items.map(renderItem)}</div>
        {mode === 'simple' && (
          <>
            {renderItem({ activity: 'notifications', label: 'Alerts', icon: Bell, badge: unreadCount })}
            <MoreMenu />
          </>
        )}
        <div className="flex-1" />
        <div className="flex w-full flex-col gap-1">
          <Button
            variant="ghost"
            size={mode === 'simple' ? 'default' : 'icon'}
            className={cn('h-9 gap-3 px-2', mode === 'simple' ? 'w-full justify-start' : 'size-9 justify-center')}
            onClick={() => setHelpPanelOpen(true)}
            aria-label="Help"
          >
            <HelpCircle className="size-5" />
            {mode === 'simple' && <span>Help</span>}
          </Button>
          <Button
            variant="ghost"
            size={mode === 'simple' ? 'default' : 'icon'}
            role="tab"
            aria-selected={activeActivity === 'settings'}
            className={cn('h-9 gap-3 px-2', mode === 'simple' ? 'w-full justify-start' : 'size-9 justify-center')}
            onClick={() => setActiveActivity('settings')}
            aria-label="Settings"
          >
            <Settings className="size-5" />
            {mode === 'simple' && <span>Settings</span>}
          </Button>
          {mode === 'nerd' && renderItem({ activity: 'notifications', label: 'Notifications', icon: Bell, badge: unreadCount })}
        </div>
      </nav>
    </TooltipProvider>
  );
};
