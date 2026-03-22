import { useState } from 'react';

import { Bot, FolderGit2, Puzzle, Settings, Sparkles } from 'lucide-react';

import type { DashboardTab } from '@renderer/store/slices/claudeConfigSlice';

interface DashboardTabsProps {
  activeTab: DashboardTab;
  onTabChange: (tab: DashboardTab) => void;
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

export const DashboardTabs = ({
  activeTab,
  onTabChange,
}: Readonly<DashboardTabsProps>): React.JSX.Element => {
  const [hoveredTab, setHoveredTab] = useState<DashboardTab | null>(null);

  return (
    <div className="inline-flex gap-1 border-b" style={{ borderColor: 'var(--color-border)' }}>
      {tabs.map((tab) => {
        const Icon = tab.icon;
        const isActive = activeTab === tab.id;
        const isHovered = hoveredTab === tab.id;

        const getTextColor = (): string => {
          if (isActive) return 'var(--color-text)';
          if (isHovered) return 'var(--color-text-secondary)';
          return 'var(--color-text-muted)';
        };

        return (
          <button
            key={tab.id}
            onClick={() => onTabChange(tab.id)}
            onMouseEnter={() => setHoveredTab(tab.id)}
            onMouseLeave={() => setHoveredTab(null)}
            className={`flex items-center gap-2 px-3 py-2 text-sm transition-colors ${
              isActive ? 'rounded-md font-medium' : ''
            }`}
            style={{
              backgroundColor: isActive ? 'var(--color-surface-raised)' : 'transparent',
              color: getTextColor(),
            }}
          >
            <Icon className="size-4" />
            <span>{tab.label}</span>
          </button>
        );
      })}
    </div>
  );
};
