import { Tabs, TabsContent, TabsList, TabsTrigger } from '@renderer/components/ui/tabs';
import { Bot, FolderGit2, Puzzle, Settings, Sparkles } from 'lucide-react';

import type { DashboardTab } from '@renderer/store/slices/claudeConfigSlice';

interface DashboardTabsProps {
  activeTab: DashboardTab;
  onTabChange: (tab: DashboardTab) => void;
  children: React.ReactNode;
}

interface TabConfig {
  id: DashboardTab;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

const tabs: TabConfig[] = [
  { id: 'projects', label: 'Projects', icon: FolderGit2 },
  { id: 'agents', label: 'Agents', icon: Bot },
  { id: 'skills', label: 'Skills', icon: Sparkles },
  { id: 'plugins', label: 'Plugins', icon: Puzzle },
  { id: 'settings', label: 'Settings', icon: Settings },
];

export { TabsContent as DashboardTabContent };

export const DashboardTabs = ({
  activeTab,
  onTabChange,
  children,
}: Readonly<DashboardTabsProps>): React.JSX.Element => {
  return (
    <Tabs value={activeTab} onValueChange={(v) => { if (v) onTabChange(v as DashboardTab); }}>
      <TabsList variant="line">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          return (
            <TabsTrigger key={tab.id} value={tab.id}>
              <Icon className="size-4" />
              {tab.label}
            </TabsTrigger>
          );
        })}
      </TabsList>
      {children}
    </Tabs>
  );
};
