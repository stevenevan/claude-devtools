import { ComponentType, JSX, ReactNode, useMemo } from 'react';
import { isDesktopMode } from '@renderer/api';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@renderer/components/ui/tabs';
import {
  Bell,
  HardDrive,
  Keyboard,
  Palette,
  Plug,
  Server,
  Settings,
  Terminal,
  Wrench,
} from 'lucide-react';

export type SettingsSection =
  | 'general'
  | 'connection'
  | 'workspace'
  | 'claudeCode'
  | 'notifications'
  | 'shortcuts'
  | 'themes'
  | 'plugins'
  | 'advanced';

interface SettingsTabsProps {
  activeSection: SettingsSection;
  onSectionChange: (section: SettingsSection) => void;
  children: ReactNode;
}

interface TabConfig {
  id: SettingsSection;
  label: string;
  icon: ComponentType<{ className?: string }>;
  desktopOnly?: boolean;
}

const tabs: TabConfig[] = [
  { id: 'general', label: 'General', icon: Settings },
  { id: 'connection', label: 'Connection', icon: Server, desktopOnly: true },
  { id: 'workspace', label: 'Workspaces', icon: HardDrive, desktopOnly: true },
  { id: 'claudeCode', label: 'Claude Code', icon: Terminal, desktopOnly: true },
  { id: 'notifications', label: 'Notifications', icon: Bell },
  { id: 'shortcuts', label: 'Shortcuts', icon: Keyboard },
  { id: 'themes', label: 'Themes', icon: Palette },
  { id: 'plugins', label: 'Plugins', icon: Plug },
  { id: 'advanced', label: 'Advanced', icon: Wrench },
];

export { TabsContent as SettingsTabContent };

export const SettingsTabs = ({
  activeSection,
  onSectionChange,
  children,
}: Readonly<SettingsTabsProps>): JSX.Element => {
  const isDesktop = isDesktopMode();
  const visibleTabs = useMemo(
    () => tabs.filter((tab) => !tab.desktopOnly || isDesktop),
    [isDesktop]
  );

  return (
    <Tabs
      value={activeSection}
      onValueChange={(v) => {
        if (v) onSectionChange(v as SettingsSection);
      }}
    >
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
