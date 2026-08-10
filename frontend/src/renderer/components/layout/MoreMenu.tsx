import { ComponentType, JSX, useState } from 'react';
import { isDesktopMode } from '@renderer/api';
import { Button } from '@renderer/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@renderer/components/ui/dropdown-menu';
import { cn } from '@renderer/lib/utils';
import { useStore } from '@renderer/store';
import {
  Bot,
  Ellipsis,
  History,
  MessageSquareText,
  Puzzle,
  ScrollText,
  Sparkles,
  Store,
  Workflow,
  Wrench,
} from 'lucide-react';

import type { ActivityView } from '@renderer/store/slices/uiSlice';

type MoreItem = {
  activity: ActivityView;
  label: string;
  icon: ComponentType<{ className?: string }>;
};

const ITEMS: ReadonlyArray<MoreItem> = [
  { activity: 'agents', label: 'Agents', icon: Bot },
  { activity: 'skills', label: 'Skills', icon: Sparkles },
  { activity: 'plugins', label: 'Plugins', icon: Puzzle },
  { activity: 'annotations', label: 'Annotations', icon: MessageSquareText },
];

const DESKTOP_ITEMS: ReadonlyArray<MoreItem> = [
  { activity: 'history', label: 'History', icon: History },
  { activity: 'transcripts', label: 'Transcripts', icon: ScrollText },
  { activity: 'marketplace', label: 'Marketplace', icon: Store },
  { activity: 'taskGraph', label: 'Task Graph', icon: Workflow },
  { activity: 'maintenance', label: 'Maintenance', icon: Wrench },
];

export const MoreMenu = (): JSX.Element => {
  const [isOpen, setIsOpen] = useState(false);
  const activeActivity = useStore((state) => state.activeActivity);
  const setActiveActivity = useStore((state) => state.setActiveActivity);
  const items = isDesktopMode() ? [...ITEMS, ...DESKTOP_ITEMS] : ITEMS;
  const hasActiveItem = items.some(({ activity }) => activity === activeActivity);

  return (
    <DropdownMenu open={isOpen} onOpenChange={setIsOpen}>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            className={cn(
              'relative h-9 w-full justify-start gap-3 px-2',
              hasActiveItem && 'bg-muted text-foreground'
            )}
            aria-label="More views"
            aria-haspopup="menu"
          />
        }
      >
        {hasActiveItem && <span className="absolute top-1 bottom-1 left-0 w-0.5 rounded-r-full bg-indigo-500" />}
        <Ellipsis className="size-5" />
        <span>More</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="right" align="start" className="w-56 gap-1 p-1.5">
        {items.map(({ activity, label, icon: Icon }) => (
          <DropdownMenuItem
            key={activity}
            className={cn(
              'h-8 w-full justify-start gap-2 px-2',
              activeActivity === activity && 'bg-muted text-foreground'
            )}
            onClick={() => {
              setActiveActivity(activity);
              setIsOpen(false);
            }}
          >
            <Icon className="size-4" />
            <span>{label}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
