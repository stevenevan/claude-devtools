import { TabUIProvider } from '@renderer/contexts/TabUIContext';
import { cn } from '@renderer/lib/utils';
import { useStore } from '@renderer/store';

import { AgentsGrid } from '../dashboard/AgentsGrid';
import { AnalyticsDashboard } from '../dashboard/AnalyticsDashboard';
import { DashboardView } from '../dashboard/DashboardView';
import { PluginsGrid } from '../dashboard/PluginsGrid';
import { SkillsGrid } from '../dashboard/SkillsGrid';
import { NotificationsView } from '../notifications/NotificationsView';
import { SettingsView } from '../settings/SettingsView';

import { GlobalContentView } from './GlobalContentView';
import { SessionTabContent } from './SessionTabContent';

import type { Pane } from '@renderer/types/panes';

interface PaneContentProps {
  pane: Pane;
}

export const PaneContent = ({ pane }: PaneContentProps): React.JSX.Element => {
  const activeTabId = pane.activeTabId;
  const activeActivity = useStore((s) => s.activeActivity);

  const showDefaultContent = !activeTabId && pane.tabs.length === 0;

  // Global activities (analytics, agents, skills, plugins) don't create tabs,
  // so they must show their content even when session tabs exist
  const isGlobalActivity =
    activeActivity === 'analytics' ||
    activeActivity === 'agents' ||
    activeActivity === 'skills' ||
    activeActivity === 'plugins';
  const showGlobalContent = isGlobalActivity || showDefaultContent;

  return (
    <div className="relative flex flex-1 overflow-hidden">
      {showGlobalContent && (
        <div className="absolute inset-0 flex">
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
          {activeActivity === 'notifications' && <NotificationsView />}
          {activeActivity === 'settings' && <SettingsView />}
        </div>
      )}

      {pane.tabs.map((tab) => {
        const isActive = tab.id === activeTabId && !isGlobalActivity;
        return (
          <div key={tab.id} className={cn('absolute inset-0', isActive ? 'flex' : 'hidden')}>
            {(tab.type === 'dashboard' || tab.type === 'projects') && <DashboardView />}
            {tab.type === 'notifications' && <NotificationsView />}
            {tab.type === 'settings' && <SettingsView />}
            {tab.type === 'session' && (
              <TabUIProvider tabId={tab.id}>
                <SessionTabContent tab={tab} isActive={isActive} />
              </TabUIProvider>
            )}
          </div>
        );
      })}
    </div>
  );
};
