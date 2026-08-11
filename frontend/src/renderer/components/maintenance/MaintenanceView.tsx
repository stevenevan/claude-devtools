import { JSX, ReactNode, useState } from 'react';
import { Button } from '@renderer/components/ui/button';
import { useUIMode } from '@renderer/hooks/useUIMode';
import { cn } from '@renderer/lib/utils';
import { useStore } from '@renderer/store';
import { formatBytes } from '@renderer/utils/formatters';
import { HardDrive, Loader2 } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';

import { BackupsCleanupPanel } from './BackupsCleanupPanel';
import { CachesCleanupPanel } from './CachesCleanupPanel';
import { ClaudeJsonPanel } from './ClaudeJsonPanel';
import { ConfigBackupPanel } from './ConfigBackupPanel';
import { FileHistoryBrowserPanel } from './FileHistoryBrowserPanel';
import { FileHistoryCleanupPanel } from './FileHistoryCleanupPanel';
import { HealthPanel } from './HealthPanel';
import { HistoryPanel } from './HistoryPanel';
import { InstructionsPanel } from './InstructionsPanel';
import { JunkCleanupPanel } from './JunkCleanupPanel';
import { LogsCleanupPanel } from './LogsCleanupPanel';
import { MCPStatusPanel } from './MCPStatusPanel';
import { MemoryPanel } from './MemoryPanel';
import { PermissionsPanel } from './PermissionsPanel';
import { PlansCleanupPanel } from './PlansCleanupPanel';
import { PluginsCleanupPanel } from './PluginsCleanupPanel';
import { ProjectSettingsPanel } from './ProjectSettingsPanel';
import { ProjectsCleanupPanel } from './ProjectsCleanupPanel';
import { RetentionPolicyPanel } from './RetentionPolicyPanel';
import { RuntimeCleanupPanel } from './RuntimeCleanupPanel';
import { SettingsDiffPanel } from './SettingsDiffPanel';
import { ShellSnapshotPanel } from './ShellSnapshotPanel';
import { SpaceSummary } from './SpaceSummary';
import { StorageTable } from './StorageTable';
import { TranscriptsCleanupPanel } from './TranscriptsCleanupPanel';
import { TrashPanel } from './TrashPanel';
import { UsageStatsPanel } from './UsageStatsPanel';

type MaintenanceGroup = 'clean-up' | 'inspect' | 'configure';

interface MaintenanceTab {
  id: string;
  label: string;
  group: MaintenanceGroup;
  writesToClaudeRoot?: boolean;
  render: () => ReactNode;
}

// The registry remains the source of truth for Nerd mode. Group metadata keeps
// the navigation policy in one place instead of scattering label checks.
const CLEANUP_TABS: MaintenanceTab[] = [
  {
    id: 'plugins',
    label: 'Plugins',
    group: 'clean-up',
    writesToClaudeRoot: true,
    render: () => <PluginsCleanupPanel />,
  },
  {
    id: 'transcripts',
    label: 'Transcripts',
    group: 'clean-up',
    writesToClaudeRoot: true,
    render: () => <TranscriptsCleanupPanel />,
  },
  {
    id: 'file-history',
    label: 'File History',
    group: 'clean-up',
    writesToClaudeRoot: true,
    render: () => <FileHistoryCleanupPanel />,
  },
  {
    id: 'file-history-browser',
    label: 'File History (view)',
    group: 'inspect',
    render: () => <FileHistoryBrowserPanel />,
  },
  {
    id: 'junk',
    label: 'Junk',
    group: 'clean-up',
    writesToClaudeRoot: true,
    render: () => <JunkCleanupPanel />,
  },
  {
    id: 'runtime',
    label: 'Runtime',
    group: 'clean-up',
    writesToClaudeRoot: true,
    render: () => <RuntimeCleanupPanel />,
  },
  {
    id: 'plans',
    label: 'Plans',
    group: 'clean-up',
    writesToClaudeRoot: true,
    render: () => <PlansCleanupPanel />,
  },
  {
    id: 'projects',
    label: 'Projects',
    group: 'clean-up',
    writesToClaudeRoot: true,
    render: () => <ProjectsCleanupPanel />,
  },
  {
    id: 'backups',
    label: 'Backups',
    group: 'clean-up',
    writesToClaudeRoot: true,
    render: () => <BackupsCleanupPanel />,
  },
  {
    id: 'logs',
    label: 'Logs',
    group: 'clean-up',
    writesToClaudeRoot: true,
    render: () => <LogsCleanupPanel />,
  },
  {
    id: 'caches',
    label: 'Caches',
    group: 'clean-up',
    writesToClaudeRoot: true,
    render: () => <CachesCleanupPanel />,
  },
  {
    id: 'history',
    label: 'History',
    group: 'clean-up',
    writesToClaudeRoot: true,
    render: () => <HistoryPanel />,
  },
  {
    id: 'health',
    label: 'Health',
    group: 'inspect',
    render: () => <HealthPanel />,
  },
  {
    id: 'settings-diff',
    label: 'Settings Diff',
    group: 'inspect',
    writesToClaudeRoot: true,
    render: () => <SettingsDiffPanel />,
  },
  {
    id: 'project-settings',
    label: 'Project Settings',
    group: 'configure',
    writesToClaudeRoot: true,
    render: () => <ProjectSettingsPanel />,
  },
  {
    id: 'instructions',
    label: 'Instructions',
    group: 'configure',
    writesToClaudeRoot: true,
    render: () => <InstructionsPanel />,
  },
  {
    id: 'claude-json',
    label: 'claude.json',
    group: 'configure',
    writesToClaudeRoot: true,
    render: () => <ClaudeJsonPanel />,
  },
  {
    id: 'mcp-status',
    label: 'MCP',
    group: 'configure',
    writesToClaudeRoot: true,
    render: () => <MCPStatusPanel />,
  },
  {
    id: 'permissions',
    label: 'Permissions',
    group: 'configure',
    writesToClaudeRoot: true,
    render: () => <PermissionsPanel />,
  },
  {
    id: 'memory',
    label: 'Memory',
    group: 'configure',
    writesToClaudeRoot: true,
    render: () => <MemoryPanel />,
  },
  {
    id: 'config-backup',
    label: 'Config Backup',
    group: 'configure',
    writesToClaudeRoot: true,
    render: () => <ConfigBackupPanel />,
  },
  {
    id: 'retention',
    label: 'Retention',
    group: 'clean-up',
    writesToClaudeRoot: true,
    render: () => <RetentionPolicyPanel />,
  },
  {
    id: 'shell-snapshots',
    label: 'Shell Snapshots',
    group: 'inspect',
    render: () => <ShellSnapshotPanel />,
  },
  {
    id: 'usage',
    label: 'Usage',
    group: 'inspect',
    render: () => <UsageStatsPanel />,
  },
  {
    id: 'trash',
    label: 'Trash',
    group: 'clean-up',
    render: () => <TrashPanel />,
  },
];

const GROUPS: readonly { id: MaintenanceGroup; label: string }[] = [
  { id: 'clean-up', label: 'Clean up' },
  { id: 'inspect', label: 'Inspect' },
  { id: 'configure', label: 'Configure' },
];

export const MaintenanceView = (): JSX.Element => {
  const mode = useUIMode();
  const { dirs, scanning, error, progress, connectionMode, scanStorage, cancelScan } = useStore(
    useShallow((state) => ({
      dirs: state.dirs,
      scanning: state.scanning,
      error: state.error,
      progress: state.progress,
      connectionMode: state.connectionMode,
      scanStorage: state.scanStorage,
      cancelScan: state.cancelScan,
    }))
  );
  const [activeTab, setActiveTab] = useState('storage');
  const [showAllTools, setShowAllTools] = useState(false);
  const isLocal = connectionMode === 'local';
  const storageTab: MaintenanceTab = {
    id: 'storage',
    label: 'Storage',
    group: 'inspect',
    render: () => <StorageTable dirs={dirs} />,
  };
  const tabs = [storageTab, ...CLEANUP_TABS];
  const active = tabs.find((tab) => tab.id === activeTab) ?? storageTab;
  const simpleSummary = mode === 'simple' && !showAllTools;

  const tabButton = (tab: MaintenanceTab): JSX.Element => (
    <Button
      key={tab.id}
      variant={tab.id === activeTab ? 'secondary' : 'ghost'}
      size="sm"
      className={cn('text-xs', tab.id === activeTab && 'font-medium')}
      aria-label={tab.writesToClaudeRoot ? `${tab.label} (writes to ~/.claude)` : tab.label}
      onClick={() => setActiveTab(tab.id)}
    >
      {tab.label}
      {tab.writesToClaudeRoot && (
        <span className="text-muted-foreground ml-1 text-[10px]" title="Writes to ~/.claude">
          write
        </span>
      )}
    </Button>
  );

  return (
    <div className="bg-background flex flex-1 flex-col overflow-hidden">
      <div className="border-border/50 shrink-0 border-b">
        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2">
            <HardDrive className="text-muted-foreground size-4" />
            <span className="text-foreground text-sm font-medium">Maintenance</span>
          </div>

          {!simpleSummary && (
            <div className="flex items-center gap-2">
              {mode === 'simple' && (
                <Button variant="outline" size="sm" onClick={() => setShowAllTools(false)}>
                  Summary
                </Button>
              )}
              {activeTab === 'storage' && (
                <>
                  <Button
                    variant="default"
                    size="sm"
                    disabled={!isLocal || scanning}
                    onClick={() => void scanStorage()}
                  >
                    {scanning && <Loader2 className="size-3.5 animate-spin" />}
                    Scan
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!scanning}
                    onClick={() => void cancelScan()}
                  >
                    Cancel
                  </Button>
                </>
              )}
            </div>
          )}
        </div>

        {!simpleSummary && (
          <div className="flex flex-wrap items-start gap-x-3 gap-y-2 px-2 pb-2">
            {tabButton(storageTab)}
            {GROUPS.map((group) => (
              <div key={group.id} className="flex flex-wrap items-center gap-1">
                <span className="text-muted-foreground px-1 text-[10px] font-medium tracking-wide uppercase">
                  {group.label}
                </span>
                {tabs.filter((tab) => tab.group === group.id && tab.id !== 'storage').map(tabButton)}
              </div>
            ))}
          </div>
        )}
      </div>

      {!isLocal && !simpleSummary && (
        <div className="border-border/50 bg-card/50 text-muted-foreground shrink-0 border-b px-4 py-2 text-xs">
          Storage maintenance operates on this local machine only.
        </div>
      )}

      {error && !simpleSummary && activeTab === 'storage' && (
        <div className="border-border/50 bg-destructive/10 text-destructive shrink-0 border-b px-4 py-2 text-xs">
          {error}
        </div>
      )}

      {scanning && !simpleSummary && activeTab === 'storage' && (
        <div className="shrink-0 px-4 py-2">
          <div className="bg-muted h-1 w-full overflow-hidden rounded-full">
            <div className="bg-primary h-full w-1/3 animate-pulse rounded-full" />
          </div>
          {progress && (
            <p className="text-muted-foreground mt-1 text-xs">
              {progress.dirsVisited.toLocaleString()} dirs scanned - {formatBytes(progress.bytes)}
            </p>
          )}
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        {simpleSummary ? (
          <SpaceSummary dirs={dirs} onShowAllTools={() => setShowAllTools(true)} />
        ) : (
          active.render()
        )}
      </div>
    </div>
  );
};
