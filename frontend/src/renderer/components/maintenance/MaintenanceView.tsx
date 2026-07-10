import { JSX, ReactNode, useState } from 'react';
import { Button } from '@renderer/components/ui/button';
import { cn } from '@renderer/lib/utils';
import { useStore } from '@renderer/store';
import { formatBytes } from '@renderer/utils/formatters';
import { HardDrive, Loader2 } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';

import { BackupsCleanupPanel } from './BackupsCleanupPanel';
import { CachesCleanupPanel } from './CachesCleanupPanel';
import { FileHistoryCleanupPanel } from './FileHistoryCleanupPanel';
import { HealthPanel } from './HealthPanel';
import { HistoryPanel } from './HistoryPanel';
import { InstructionsPanel } from './InstructionsPanel';
import { JunkCleanupPanel } from './JunkCleanupPanel';
import { LogsCleanupPanel } from './LogsCleanupPanel';
import { PlansCleanupPanel } from './PlansCleanupPanel';
import { PluginsCleanupPanel } from './PluginsCleanupPanel';
import { ProjectsCleanupPanel } from './ProjectsCleanupPanel';
import { ProjectSettingsPanel } from './ProjectSettingsPanel';
import { RuntimeCleanupPanel } from './RuntimeCleanupPanel';
import { SettingsDiffPanel } from './SettingsDiffPanel';
import { StorageTable } from './StorageTable';
import { TranscriptsCleanupPanel } from './TranscriptsCleanupPanel';
import { TrashPanel } from './TrashPanel';

// Maintenance tab registry. Each cleanup week appends its panel here; "storage"
// keeps the raw scan + table and "trash" the restore/empty surface.
interface MaintenanceTab {
  id: string;
  label: string;
  render: () => ReactNode;
}

const CLEANUP_TABS: MaintenanceTab[] = [
  { id: 'plugins', label: 'Plugins', render: () => <PluginsCleanupPanel /> },
  { id: 'transcripts', label: 'Transcripts', render: () => <TranscriptsCleanupPanel /> },
  { id: 'file-history', label: 'File History', render: () => <FileHistoryCleanupPanel /> },
  { id: 'junk', label: 'Junk', render: () => <JunkCleanupPanel /> },
  { id: 'runtime', label: 'Runtime', render: () => <RuntimeCleanupPanel /> },
  { id: 'plans', label: 'Plans', render: () => <PlansCleanupPanel /> },
  { id: 'projects', label: 'Projects', render: () => <ProjectsCleanupPanel /> },
  { id: 'backups', label: 'Backups', render: () => <BackupsCleanupPanel /> },
  { id: 'logs', label: 'Logs', render: () => <LogsCleanupPanel /> },
  { id: 'caches', label: 'Caches', render: () => <CachesCleanupPanel /> },
  { id: 'history', label: 'History', render: () => <HistoryPanel /> },
  { id: 'health', label: 'Health', render: () => <HealthPanel /> },
  { id: 'settings-diff', label: 'Settings Diff', render: () => <SettingsDiffPanel /> },
  { id: 'project-settings', label: 'Project Settings', render: () => <ProjectSettingsPanel /> },
  { id: 'instructions', label: 'Instructions', render: () => <InstructionsPanel /> },
];

export const MaintenanceView = (): JSX.Element => {
  const { dirs, scanning, error, progress, connectionMode, scanStorage, cancelScan } = useStore(
    useShallow((s) => ({
      dirs: s.dirs,
      scanning: s.scanning,
      error: s.error,
      progress: s.progress,
      connectionMode: s.connectionMode,
      scanStorage: s.scanStorage,
      cancelScan: s.cancelScan,
    }))
  );

  const [activeTab, setActiveTab] = useState('storage');
  const isLocal = connectionMode === 'local';
  const tabs: MaintenanceTab[] = [
    { id: 'storage', label: 'Storage', render: () => <StorageTable dirs={dirs} /> },
    ...CLEANUP_TABS,
    { id: 'trash', label: 'Trash', render: () => <TrashPanel /> },
  ];
  const active = tabs.find((t) => t.id === activeTab) ?? tabs[0];

  return (
    <div className="bg-background flex flex-1 flex-col overflow-hidden">
      <div className="border-border/50 shrink-0 border-b">
        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2">
            <HardDrive className="text-muted-foreground size-4" />
            <span className="text-foreground text-sm font-medium">Maintenance</span>
          </div>

          {activeTab === 'storage' && (
            <div className="flex items-center gap-2">
              <Button
                variant="default"
                size="sm"
                disabled={!isLocal || scanning}
                onClick={() => void scanStorage()}
              >
                {scanning && <Loader2 className="size-3.5 animate-spin" />}
                Scan
              </Button>
              <Button variant="outline" size="sm" disabled={!scanning} onClick={() => void cancelScan()}>
                Cancel
              </Button>
            </div>
          )}
        </div>

        <div className="flex items-center gap-1 px-2 pb-2">
          {tabs.map((tab) => (
            <Button
              key={tab.id}
              variant={tab.id === activeTab ? 'secondary' : 'ghost'}
              size="sm"
              className={cn('text-xs', tab.id === activeTab && 'font-medium')}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </Button>
          ))}
        </div>
      </div>

      {!isLocal && (
        <div className="border-border/50 bg-card/50 text-muted-foreground shrink-0 border-b px-4 py-2 text-xs">
          Storage maintenance operates on this local machine only.
        </div>
      )}

      {error && activeTab === 'storage' && (
        <div className="border-border/50 bg-destructive/10 text-destructive shrink-0 border-b px-4 py-2 text-xs">
          {error}
        </div>
      )}

      {scanning && activeTab === 'storage' && (
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

      <div className="flex-1 overflow-y-auto">{active.render()}</div>
    </div>
  );
};
