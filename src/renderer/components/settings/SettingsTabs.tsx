import { useMemo } from 'react';

import { isDesktopMode } from '@renderer/api';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@renderer/components/ui/tabs';
import { Bell, HardDrive, Server, Settings, Wrench } from 'lucide-react';

export type SettingsSection = 'general' | 'connection' | 'workspace' | 'notifications' | 'advanced';

interface SettingsTabsProps {
  activeSection: SettingsSection;
  onSectionChange: (section: SettingsSection) => void;
  children: React.ReactNode;
}

interface TabConfig {
  id: SettingsSection;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  electronOnly?: boolean;
}

const tabs: TabConfig[] = [
  { id: 'general', label: 'General', icon: Settings },
  { id: 'connection', label: 'Connection', icon: Server, electronOnly: true },
  { id: 'workspace', label: 'Workspaces', icon: HardDrive, electronOnly: true },
  { id: 'notifications', label: 'Notifications', icon: Bell },
  { id: 'advanced', label: 'Advanced', icon: Wrench },
];

export { TabsContent as SettingsTabContent };

export const SettingsTabs = ({
  activeSection,
  onSectionChange,
  children,
}: Readonly<SettingsTabsProps>): React.JSX.Element => {
  const isElectron = useMemo(() => isDesktopMode(), []);
  const visibleTabs = useMemo(
    () => tabs.filter((tab) => !tab.electronOnly || isElectron),
    [isElectron]
  );

  return (
    <Tabs value={activeSection} onValueChange={(v) => { if (v) onSectionChange(v as SettingsSection); }}>
      <TabsList variant="line">
        {visibleTabs.map((tab) => {
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
