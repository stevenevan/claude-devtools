import { useCallback, useEffect, useRef, useState } from 'react';

import { cn } from '@renderer/lib/utils';
import { useStore } from '@renderer/store';
import { useShallow } from 'zustand/react/shallow';

import { DateGroupedSessions } from '../sidebar/DateGroupedSessions';
import { ProjectList } from '../sidebar/ProjectList';

import { SidebarHeader } from './SidebarHeader';

const MIN_WIDTH = 200;
const MAX_WIDTH = 500;
const DEFAULT_WIDTH = 280;

export const Sidebar = (): React.JSX.Element | null => {
  const {
    projects,
    projectsLoading,
    fetchProjects,
    sidebarCollapsed,
    activeActivity,
    activeProjectId,
  } = useStore(
    useShallow((s) => ({
      projects: s.projects,
      projectsLoading: s.projectsLoading,
      fetchProjects: s.fetchProjects,
      sidebarCollapsed: s.sidebarCollapsed,
      activeActivity: s.activeActivity,
      activeProjectId: s.activeProjectId,
    }))
  );
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const [isResizing, setIsResizing] = useState(false);
  const sidebarRef = useRef<HTMLDivElement>(null);

  const showSidebar = activeActivity === 'projects';

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
      <SidebarHeader />
      <div className="flex-1 overflow-hidden">
        {activeProjectId ? <DateGroupedSessions /> : <ProjectList />}
      </div>

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
