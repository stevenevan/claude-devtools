/**
 * ActivityBar - Thin vertical icon rail for top-level app navigation.
 *
 * Separates app-level concerns (Agents, Skills, Plugins, Settings, Notifications)
 * from project-level content (Sessions). The sidebar adapts based on active section.
 *
 * Layout: 44px wide, icons top-aligned with Settings/Notifications bottom-pinned.
 */

import { isDesktopMode } from '@renderer/api';
import { Button } from '@renderer/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@renderer/components/ui/tooltip';
import { cn } from '@renderer/lib/utils';
import { useStore } from '@renderer/store';
import { formatShortcut } from '@renderer/utils/stringUtils';
import { Bell, Bot, FolderGit2, Puzzle, Settings, Sparkles } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';

import type { ActivityView } from '@renderer/store/slices/uiSlice';

interface ActivityBarItemProps {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  shortcut?: string;
  activity: ActivityView;
  isActive: boolean;
  onClick: () => void;
  badge?: number;
}

const ActivityBarItem = ({
  icon: Icon,
  label,
  shortcut,
  isActive,
  onClick,
  badge,
}: Readonly<ActivityBarItemProps>): React.JSX.Element => {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            role="tab"
            aria-selected={isActive}
            aria-label={badge ? `${label}, ${badge} unread` : label}
            onClick={onClick}
            className={cn(
              'relative size-9 transition-colors duration-150',
              isActive
                ? 'text-foreground bg-white/[0.05] hover:bg-white/[0.08]'
                : 'text-muted-foreground hover:text-secondary-foreground hover:bg-white/[0.03]'
            )}
          />
        }
      >
        {/* Active indicator */}
        {isActive && (
          <span className="absolute top-1 bottom-1 left-0 w-0.5 rounded-r-full bg-indigo-500" />
        )}
        <Icon className="size-5" />
        {/* Notification badge */}
        {badge != null && badge > 0 && (
          <span className="bg-destructive text-destructive-foreground absolute -top-0.5 -right-0.5 flex size-3.5 items-center justify-center rounded-full text-[8px] font-bold leading-none">
            {badge > 9 ? '9+' : badge}
          </span>
        )}
      </TooltipTrigger>
      <TooltipContent side="right" sideOffset={8}>
        <span>{label}</span>
        {shortcut && (
          <span className="text-muted-foreground ml-2 text-xs">{formatShortcut(shortcut)}</span>
        )}
      </TooltipContent>
    </Tooltip>
  );
};

export const ActivityBar = (): React.JSX.Element => {
  const { activeActivity, setActiveActivity, unreadCount } = useStore(
    useShallow((s) => ({
      activeActivity: s.activeActivity,
      setActiveActivity: s.setActiveActivity,
      unreadCount: s.unreadCount,
    }))
  );

  return (
    <TooltipProvider delay={300}>
      <nav
        role="tablist"
        aria-orientation="vertical"
        aria-label="App navigation"
        className="border-border bg-sidebar flex w-11 shrink-0 flex-col items-center border-r py-2"
        style={
          isDesktopMode()
            ? { paddingTop: 'calc(var(--macos-traffic-light-padding-left, 0px) + 8px)' }
            : undefined
        }
      >
        {/* Top section: primary navigation */}
        <div className="flex flex-col items-center gap-1">
          <ActivityBarItem
            icon={FolderGit2}
            label="Projects"
            shortcut="1"
            activity="projects"
            isActive={activeActivity === 'projects'}
            onClick={() => setActiveActivity('projects')}
          />
          <ActivityBarItem
            icon={Bot}
            label="Agents"
            shortcut="2"
            activity="agents"
            isActive={activeActivity === 'agents'}
            onClick={() => setActiveActivity('agents')}
          />
          <ActivityBarItem
            icon={Sparkles}
            label="Skills"
            shortcut="3"
            activity="skills"
            isActive={activeActivity === 'skills'}
            onClick={() => setActiveActivity('skills')}
          />
          <ActivityBarItem
            icon={Puzzle}
            label="Plugins"
            shortcut="4"
            activity="plugins"
            isActive={activeActivity === 'plugins'}
            onClick={() => setActiveActivity('plugins')}
          />
        </div>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Bottom section: utilities */}
        <div className="flex flex-col items-center gap-1">
          <ActivityBarItem
            icon={Settings}
            label="Settings"
            shortcut=","
            activity="settings"
            isActive={activeActivity === 'settings'}
            onClick={() => setActiveActivity('settings')}
          />
          <ActivityBarItem
            icon={Bell}
            label="Notifications"
            activity="notifications"
            isActive={activeActivity === 'notifications'}
            onClick={() => setActiveActivity('notifications')}
            badge={unreadCount}
          />
        </div>
      </nav>
    </TooltipProvider>
  );
};
