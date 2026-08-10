import { JSX, lazy, Suspense } from 'react';
import { TabUIProvider } from '@renderer/contexts/TabUIContext';
import { useUIMode } from '@renderer/hooks/useUIMode';
import { cn } from '@renderer/lib/utils';
import { useStore } from '@renderer/store';
import { Loader2 } from 'lucide-react';

import { SnapshotTabContent } from '../chat/SnapshotTabContent';
import { ErrorBoundary } from '../common/ErrorBoundary';

import { SessionTabContent } from './SessionTabContent';

const SessionComparison = lazy(() =>
  import('../chat/SessionComparison').then((m) => ({ default: m.SessionComparison }))
);

// Lazy-load non-critical views for faster initial load
const DashboardView = lazy(() =>
  import('../dashboard/DashboardView').then((m) => ({ default: m.DashboardView }))
);
const AnalyticsDashboard = lazy(() =>
  import('../dashboard/AnalyticsDashboard').then((m) => ({ default: m.AnalyticsDashboard }))
);
const AgentsManager = lazy(() =>
  import('../dashboard/AgentsManager').then((m) => ({ default: m.AgentsManager }))
);
const SkillsManager = lazy(() =>
  import('../dashboard/SkillsManager').then((m) => ({ default: m.SkillsManager }))
);
const PluginsGrid = lazy(() =>
  import('../dashboard/PluginsGrid').then((m) => ({ default: m.PluginsGrid }))
);
const AnnotationList = lazy(() =>
  import('../sidebar/AnnotationList').then((m) => ({ default: m.AnnotationList }))
);
const TodosDashboard = lazy(() =>
  import('../dashboard/TodosDashboard').then((m) => ({ default: m.TodosDashboard }))
);
const NotificationsView = lazy(() =>
  import('../notifications/NotificationsView').then((m) => ({ default: m.NotificationsView }))
);
const SearchView = lazy(() =>
  import('../search/SearchView').then((m) => ({ default: m.SearchView }))
);
const SettingsView = lazy(() =>
  import('../settings/SettingsView').then((m) => ({ default: m.SettingsView }))
);
const GlobalContentView = lazy(() =>
  import('./GlobalContentView').then((m) => ({ default: m.GlobalContentView }))
);
const MaintenanceView = lazy(() =>
  import('../maintenance/MaintenanceView').then((m) => ({ default: m.MaintenanceView }))
);
const HistoryBrowser = lazy(() =>
  import('../dashboard/HistoryBrowser').then((m) => ({ default: m.HistoryBrowser }))
);
const TranscriptsViewer = lazy(() =>
  import('../dashboard/TranscriptsViewer').then((m) => ({ default: m.TranscriptsViewer }))
);
const MarketplaceBrowser = lazy(() =>
  import('../dashboard/MarketplaceBrowser').then((m) => ({ default: m.MarketplaceBrowser }))
);
const TaskGraphViewer = lazy(() =>
  import('../dashboard/TaskGraphViewer').then((m) => ({ default: m.TaskGraphViewer }))
);

const LazyFallback = (): JSX.Element => (
  <div className="bg-background flex flex-1 items-center justify-center">
    <Loader2 className="text-muted-foreground size-5 animate-spin" />
  </div>
);

import type { Pane } from '@renderer/types/panes';

interface PaneContentProps {
  pane: Pane;
}

export const PaneContent = ({ pane }: PaneContentProps): JSX.Element => {
  const mode = useUIMode();
  const activeTabId = pane.activeTabId;
  const activeActivity = useStore((state) => state.activeActivity);
  const isActivityViewActive = useStore((state) => state.isActivityViewActive);

  const showDefaultContent = !activeTabId && pane.tabs.length === 0;

  // Global activities don't create tabs, so they must show their content
  // even when session tabs exist
  const isGlobalActivity =
    activeActivity === 'analytics' ||
    activeActivity === 'agents' ||
    activeActivity === 'skills' ||
    activeActivity === 'plugins' ||
    activeActivity === 'annotations' ||
    activeActivity === 'todos' ||
    activeActivity === 'settings' ||
    activeActivity === 'notifications' ||
    activeActivity === 'search' ||
    activeActivity === 'maintenance' ||
    activeActivity === 'history' ||
    activeActivity === 'transcripts' ||
    activeActivity === 'marketplace' ||
    activeActivity === 'taskGraph';
  const showGlobalContent =
    (mode === 'simple' && isActivityViewActive) || isGlobalActivity || showDefaultContent;

  return (
    <div className="relative flex flex-1 overflow-hidden">
      {showGlobalContent && (
        <div className="absolute inset-0 flex">
          <ErrorBoundary>
            <Suspense fallback={<LazyFallback />}>
              {activeActivity === 'projects' && <DashboardView />}
              {activeActivity === 'analytics' && <AnalyticsDashboard />}
              {activeActivity === 'agents' && <AgentsManager />}
              {activeActivity === 'skills' && <SkillsManager />}
              {activeActivity === 'plugins' && (
                <GlobalContentView title="Plugins">
                  <PluginsGrid searchQuery="" />
                </GlobalContentView>
              )}
              {activeActivity === 'annotations' && (
                <GlobalContentView title="Annotations" simpleTitle="Your notes">
                  <AnnotationList />
                </GlobalContentView>
              )}
              {activeActivity === 'todos' && <TodosDashboard />}
              {activeActivity === 'notifications' && <NotificationsView />}
              {activeActivity === 'search' && <SearchView />}
              {activeActivity === 'settings' && <SettingsView />}
              {activeActivity === 'maintenance' && <MaintenanceView />}
              {activeActivity === 'history' && <HistoryBrowser />}
              {activeActivity === 'transcripts' && <TranscriptsViewer />}
              {activeActivity === 'marketplace' && <MarketplaceBrowser />}
              {activeActivity === 'taskGraph' && <TaskGraphViewer />}
            </Suspense>
          </ErrorBoundary>
        </div>
      )}

      {pane.tabs.map((tab) => {
        const isActive = tab.id === activeTabId && !showGlobalContent;
        return (
          <div key={tab.id} className={cn('absolute inset-0', isActive ? 'flex' : 'hidden')}>
            <ErrorBoundary>
              <Suspense fallback={<LazyFallback />}>
                {(tab.type === 'dashboard' || tab.type === 'projects') && <DashboardView />}
                {tab.type === 'notifications' && <NotificationsView />}
                {tab.type === 'settings' && <SettingsView />}
              </Suspense>
              {tab.type === 'session' && (
                <TabUIProvider tabId={tab.id}>
                  <SessionTabContent tab={tab} isActive={isActive} />
                </TabUIProvider>
              )}
              {tab.type === 'comparison' && (
                <Suspense fallback={<LazyFallback />}>
                  <SessionComparison tab={tab} />
                </Suspense>
              )}
              {tab.type === 'snapshot' && <SnapshotTabContent tab={tab} />}
            </ErrorBoundary>
          </div>
        );
      })}
    </div>
  );
};
