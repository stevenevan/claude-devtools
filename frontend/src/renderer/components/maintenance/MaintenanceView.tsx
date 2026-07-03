import { JSX } from 'react';
import { Button } from '@renderer/components/ui/button';
import { useStore } from '@renderer/store';
import { formatBytes } from '@renderer/utils/formatters';
import { HardDrive, Loader2 } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';

import { StorageTable } from './StorageTable';

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

  const isLocal = connectionMode === 'local';

  return (
    <div className="bg-background flex flex-1 flex-col overflow-hidden">
      <div className="border-border/50 shrink-0 border-b">
        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2">
            <HardDrive className="text-muted-foreground size-4" />
            <span className="text-foreground text-sm font-medium">Maintenance</span>
            {dirs.length > 0 && (
              <span className="text-muted-foreground text-xs">
                {dirs.length} {dirs.length === 1 ? 'entry' : 'entries'}
              </span>
            )}
          </div>

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
            <Button
              variant="outline"
              size="sm"
              disabled={!scanning}
              onClick={() => void cancelScan()}
            >
              Cancel
            </Button>
          </div>
        </div>
      </div>

      {!isLocal && (
        <div className="border-border/50 bg-card/50 text-muted-foreground shrink-0 border-b px-4 py-2 text-xs">
          Storage maintenance operates on this local machine only.
        </div>
      )}

      {error && (
        <div className="border-border/50 bg-destructive/10 text-destructive shrink-0 border-b px-4 py-2 text-xs">
          {error}
        </div>
      )}

      {scanning && (
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
        <StorageTable dirs={dirs} />
      </div>
    </div>
  );
};
