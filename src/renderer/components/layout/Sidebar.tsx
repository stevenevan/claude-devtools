import { useCallback, useEffect, useRef, useState } from 'react';

import { Button } from '@renderer/components/ui/button';
import { cn } from '@renderer/lib/utils';
import { useStore } from '@renderer/store';
import { Bell, Globe, Monitor, Settings, Wrench } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';

import { DateGroupedSessions } from '../sidebar/DateGroupedSessions';

import { SidebarHeader } from './SidebarHeader';

import type { SettingsSection } from '../settings/SettingsTabs';

const MIN_WIDTH = 200;
const MAX_WIDTH = 500;
const DEFAULT_WIDTH = 280;

const SETTINGS_SECTIONS: { id: SettingsSection; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: 'general', label: 'General', icon: Settings },
  { id: 'connection', label: 'Connection', icon: Globe },
  { id: 'workspace', label: 'Workspaces', icon: Monitor },
  { id: 'notifications', label: 'Notifications', icon: Bell },
  { id: 'advanced', label: 'Advanced', icon: Wrench },
];

const SettingsSidebar = (): React.JSX.Element => {
  const openSettingsTab = useStore((s) => s.openSettingsTab);

  return (
    <div className="flex flex-col p-3">
      <h2 className="text-muted-foreground mb-2 px-2 text-xs font-medium tracking-wider uppercase">
        Settings
      </h2>
      <nav className="flex flex-col gap-0.5">
        {SETTINGS_SECTIONS.map(({ id, label, icon: Icon }) => (
          <Button
            key={id}
            variant="ghost"
            size="default"
            onClick={() => openSettingsTab(id)}
            className="justify-start gap-2 px-2"
          >
            <Icon className="size-4" />
            {label}
          </Button>
        ))}
      </nav>
    </div>
  );
};

export const Sidebar = (): React.JSX.Element | null => {
  const { projects, projectsLoading, fetchProjects, sidebarCollapsed, activeActivity } = useStore(
    useShallow((s) => ({
      projects: s.projects,
      projectsLoading: s.projectsLoading,
      fetchProjects: s.fetchProjects,
      sidebarCollapsed: s.sidebarCollapsed,
      activeActivity: s.activeActivity,
    }))
  );
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const [isResizing, setIsResizing] = useState(false);
  const sidebarRef = useRef<HTMLDivElement>(null);

  const showSidebar = activeActivity === 'projects' || activeActivity === 'settings';

  useEffect(() => {
    if (projects.length === 0 && !projectsLoading) {
      void fetchProjects();
    }
  }, [projects.length, projectsLoading, fetchProjects]);

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!isResizing) return;

      const newWidth = e.clientX - 44;
      if (newWidth >= MIN_WIDTH && newWidth <= MAX_WIDTH) {
        setWidth(newWidth);
      }
    },
    [isResizing]
  );

  const handleMouseUp = useCallback(() => {
    setIsResizing(false);
  }, []);

  useEffect(() => {
    if (isResizing) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isResizing, handleMouseMove, handleMouseUp]);

  const handleResizeStart = (e: React.MouseEvent): void => {
    e.preventDefault();
    setIsResizing(true);
  };

  if (sidebarCollapsed || !showSidebar) {
    return null;
  }

  return (
    <div
      ref={sidebarRef}
      className="border-border bg-sidebar relative flex shrink-0 flex-col border-r"
      style={{ width: `${width}px` }}
    >
      {activeActivity === 'projects' && (
        <>
          <SidebarHeader />
          <div className="flex-1 overflow-hidden">
            <DateGroupedSessions />
          </div>
        </>
      )}

      {activeActivity === 'settings' && <SettingsSidebar />}

      <button
        type="button"
        aria-label="Resize sidebar"
        className={cn(
          'absolute top-0 right-0 h-full w-1 cursor-col-resize border-0 bg-transparent p-0 transition-colors hover:bg-blue-500/50',
          isResizing && 'bg-blue-500/50'
        )}
        onMouseDown={handleResizeStart}
      />
    </div>
  );
};
