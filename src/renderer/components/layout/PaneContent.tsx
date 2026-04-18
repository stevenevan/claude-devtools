import React, { Suspense } from 'react';

import { TabUIProvider } from '@renderer/contexts/TabUIContext';
import { cn } from '@renderer/lib/utils';
import { useStore } from '@renderer/store';
import { Loader2 } from 'lucide-react';

import { ErrorBoundary } from '../common/ErrorBoundary';

import { SessionTabContent } from './SessionTabContent';

const SessionComparison = React.lazy(() => import('../chat/SessionComparison').then((m) => ({ default: m.SessionComparison })));

// Lazy-load non-critical views for faster initial load
const DashboardView = React.lazy(() => import('../dashboard/DashboardView').then((m) => ({ default: m.DashboardView })));
const AnalyticsDashboard = React.lazy(() => import('../dashboard/AnalyticsDashboard').then((m) => ({ default: m.AnalyticsDashboard })));
const AgentsGrid = React.lazy(() => import('../dashboard/AgentsGrid').then((m) => ({ default: m.AgentsGrid })));
const SkillsGrid = React.lazy(() => import('../dashboard/SkillsGrid').then((m) => ({ default: m.SkillsGrid })));
const PluginsGrid = React.lazy(() => import('../dashboard/PluginsGrid').then((m) => ({ default: m.PluginsGrid })));
const AnnotationList = React.lazy(() => import('../sidebar/AnnotationList').then((m) => ({ default: m.AnnotationList })));
const NotificationsView = React.lazy(() => import('../notifications/NotificationsView').then((m) => ({ default: m.NotificationsView })));
const SearchView = React.lazy(() => import('../search/SearchView').then((m) => ({ default: m.SearchView })));
const SettingsView = React.lazy(() => import('../settings/SettingsView').then((m) => ({ default: m.SettingsView })));
const GlobalContentView = React.lazy(() => import('./GlobalContentView').then((m) => ({ default: m.GlobalContentView })));

const LazyFallback = (): React.JSX.Element => (
  <div className="bg-background flex flex-1 items-center justify-center">
    <Loader2 className="text-muted-foreground size-5 animate-spin" />
  </div>
);

import type { Pane } from '@renderer/types/panes';

interface PaneContentProps {
  pane: Pane;
}

export const PaneContent = ({ pane }: PaneContentProps): React.JSX.Element => {
  const activeTabId = pane.activeTabId;
  const activeActivity = useStore((s) => s.activeActivity);

  const showDefaultContent = !activeTabId && pane.tabs.length === 0;

  // Global activities don't create tabs, so they must show their content
  // even when session tabs exist
  const isGlobalActivity =
    activeActivity === 'analytics' ||
    activeActivity === 'agents' ||
    activeActivity === 'skills' ||
    activeActivity === 'plugins' ||
    activeActivity === 'annotations' ||
    activeActivity === 'settings' ||
    activeActivity === 'notifications' ||
    activeActivity === 'search';
  const showGlobalContent = isGlobalActivity || showDefaultContent;

  return (
    <div className="relative flex flex-1 overflow-hidden">
      {showGlobalContent && (
        <div className="absolute inset-0 flex">
          <ErrorBoundary>
          <Suspense fallback={<LazyFallback />}>
            {activeActivity === 'projects' && <DashboardView />}
            {activeActivity === 'analytics' && <AnalyticsDashboard />}
            {activeActivity === 'agents' && (
              <GlobalContentView title="Agents">
                <AgentsGrid searchQuery="" />
              </GlobalContentView>
            )}
            {activeActivity === 'skills' && (
              <GlobalContentView title="Skills">
                <SkillsGrid searchQuery="" />
              </GlobalContentView>
            )}
            {activeActivity === 'plugins' && (
              <GlobalContentView title="Plugins">
                <PluginsGrid searchQuery="" />
              </GlobalContentView>
            )}
            {activeActivity === 'annotations' && (
              <GlobalContentView title="Annotations">
                <AnnotationList />
              </GlobalContentView>
            )}
            {activeActivity === 'notifications' && <NotificationsView />}
            {activeActivity === 'search' && <SearchView />}
            {activeActivity === 'settings' && <SettingsView />}
          </Suspense>
          </ErrorBoundary>
        </div>
      )}

      {pane.tabs.map((tab) => {
        const isActive = tab.id === activeTabId && !isGlobalActivity;
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
            </ErrorBoundary>
          </div>
        );
      })}
    </div>
  );
};
