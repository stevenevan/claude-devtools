/**
 * AdvancedSection - Advanced settings including config management and about info.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { api, isDesktopMode } from '@renderer/api';
import { Button } from '@renderer/components/ui/button';
import appIcon from '@renderer/favicon.png';
import { cn } from '@renderer/lib/utils';
import { useStore } from '@renderer/store';
import { CheckCircle, Code2, Download, Loader2, RefreshCw, Upload } from 'lucide-react';

import { SettingsSectionHeader } from '../components';

interface AdvancedSectionProps {
  readonly saving: boolean;
  readonly onResetToDefaults: () => void;
  readonly onExportConfig: () => void;
  readonly onImportConfig: () => void;
  readonly onOpenInEditor: () => void;
}

export const AdvancedSection = ({
  saving,
  onResetToDefaults,
  onExportConfig,
  onImportConfig,
  onOpenInEditor,
}: AdvancedSectionProps): React.JSX.Element => {
  const isElectron = useMemo(() => isDesktopMode(), []);
  const [version, setVersion] = useState<string>('');
  const updateStatus = useStore((s) => s.updateStatus);
  const availableVersion = useStore((s) => s.availableVersion);
  const checkForUpdates = useStore((s) => s.checkForUpdates);

  // Auto-revert "not-available" / "error" status back to idle after a brief display
  const revertTimerRef = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => {
    if (updateStatus === 'not-available' || updateStatus === 'error') {
      revertTimerRef.current = setTimeout(() => {
        useStore.setState({ updateStatus: 'idle' });
      }, 3000);
    }
    return () => {
      if (revertTimerRef.current) clearTimeout(revertTimerRef.current);
    };
  }, [updateStatus]);

  useEffect(() => {
    api.getAppVersion().then(setVersion).catch(console.error);
  }, []);

  const handleCheckForUpdates = useCallback(() => {
    checkForUpdates();
  }, [checkForUpdates]);

  const getUpdateButtonContent = (): React.JSX.Element => {
    switch (updateStatus) {
      case 'checking':
        return (
          <>
            <Loader2 className="size-3.5 animate-spin" />
            Checking...
          </>
        );
      case 'not-available':
        return (
          <>
            <CheckCircle className="size-3.5" />
            Up to date
          </>
        );
      case 'available':
      case 'downloaded':
        return (
          <>
            <Download className="size-3.5" />
            {updateStatus === 'downloaded'
              ? 'Update ready'
              : `v${availableVersion ?? 'unknown'} available`}
          </>
        );
      default:
        return (
          <>
            <RefreshCw className="size-3.5" />
            Check for Updates
          </>
        );
    }
  };

  return (
    <div>
      <SettingsSectionHeader title="Configuration" />
      <div className="space-y-2 py-2">
        <Button variant="outline" className="w-full" disabled={saving} onClick={onResetToDefaults}>
          <RefreshCw className="size-4" />
          Reset to Defaults
        </Button>
        <Button variant="outline" className="w-full" disabled={saving} onClick={onExportConfig}>
          <Download className="size-4" />
          Export Config
        </Button>
        <Button variant="outline" className="w-full" disabled={saving} onClick={onImportConfig}>
          <Upload className="size-4" />
          Import Config
        </Button>
        {isElectron && (
          <Button variant="outline" className="w-full" onClick={onOpenInEditor}>
            <Code2 className="size-4" />
            Open in Editor
          </Button>
        )}
      </div>

      <SettingsSectionHeader title="About" />
      <div className="flex items-start gap-4 py-3">
        <img src={appIcon} alt="App Icon" className="size-10 rounded-lg" />
        <div>
          <div className="flex items-center gap-3">
            <p className="text-foreground text-sm font-medium">claude-devtools</p>
            {isElectron && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleCheckForUpdates}
                disabled={updateStatus === 'checking'}
                className={cn(
                  updateStatus === 'not-available'
                    ? 'text-muted-foreground'
                    : updateStatus === 'available' || updateStatus === 'downloaded'
                      ? 'text-blue-400'
                      : 'text-muted-foreground'
                )}
              >
                {getUpdateButtonContent()}
              </Button>
            )}
            {!isElectron && (
              <span className="border-border text-muted-foreground rounded-md border px-2.5 py-1 text-xs font-medium">
                Standalone
              </span>
            )}
          </div>
          <p className="text-muted-foreground mt-0.5 text-xs">Version {version || '...'}</p>
          <p className="text-muted-foreground mt-2 text-xs leading-relaxed">
            Visualize and analyze Claude Code session executions with interactive waterfall charts
            and detailed insights.
          </p>
        </div>
      </div>
    </div>
  );
};
