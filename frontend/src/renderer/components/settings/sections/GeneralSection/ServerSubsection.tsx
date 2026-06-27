import { JSX, useEffect, useState } from 'react';
import { api } from '@renderer/api';
import { Switch } from '@renderer/components/ui/switch';
import { useClipboard } from '@renderer/hooks/mantine';
import { cn } from '@renderer/lib/utils';
import { Check, Copy, Loader2 } from 'lucide-react';

import { SettingRow, SettingsSectionHeader } from '../../components';

import type { HttpServerStatus } from '@shared/types/api';

interface ServerSubsectionProps {
  readonly saving: boolean;
  readonly isElectron: boolean;
}

export const ServerSubsection = ({
  saving,
  isElectron,
}: ServerSubsectionProps): JSX.Element => {
  const [serverStatus, setServerStatus] = useState<HttpServerStatus>({
    running: false,
    port: 3456,
  });
  const [serverLoading, setServerLoading] = useState(false);
  const { copy, copied } = useClipboard({ timeout: 2000 });

  useEffect(() => {
    if (isElectron) {
      void api.httpServer.getStatus().then(setServerStatus);
    }
  }, [isElectron]);

  const handleServerToggle = async (enabled: boolean): Promise<void> => {
    setServerLoading(true);
    try {
      const status = enabled ? await api.httpServer.start() : await api.httpServer.stop();
      setServerStatus(status);
    } catch {
      // Status didn't change
    } finally {
      setServerLoading(false);
    }
  };

  const serverUrl = `http://localhost:${serverStatus.port}`;

  if (isElectron) {
    return (
      <>
        <SettingsSectionHeader title="Browser Access" />
        <SettingRow
          label="Enable server mode"
          description="Start an HTTP server to access the UI from a browser or embed in iframes"
        >
          {serverLoading ? (
            <Loader2 className="text-muted-foreground size-5 animate-spin" />
          ) : (
            <Switch
              checked={serverStatus.running}
              onCheckedChange={handleServerToggle}
              disabled={saving}
            />
          )}
        </SettingRow>

        {serverStatus.running && (
          <div className="bg-card mb-2 flex items-center gap-3 rounded-md px-3 py-2.5">
            <div className="size-2 shrink-0 rounded-full bg-green-500" />
            <span className="text-muted-foreground text-xs font-medium">Running on</span>
            <code className="border-border bg-background text-foreground rounded-sm border px-1.5 py-0.5 font-mono text-xs">
              {serverUrl}
            </code>
            <button
              onClick={() => copy(serverUrl)}
              className={cn(
                'ml-auto flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs font-medium transition-colors hover:bg-white/5',
                copied ? 'text-green-500' : 'text-muted-foreground'
              )}
            >
              {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
              {copied ? 'Copied' : 'Copy URL'}
            </button>
          </div>
        )}
      </>
    );
  }

  return (
    <>
      <SettingsSectionHeader title="Server" />
      <div className="bg-card mb-2 flex items-center gap-3 rounded-md px-3 py-2.5">
        <div className="size-2 shrink-0 rounded-full bg-green-500" />
        <span className="text-muted-foreground text-xs font-medium">Running on</span>
        <code className="border-border bg-background text-foreground rounded-sm border px-1.5 py-0.5 font-mono text-xs">
          {window.location.origin}
        </code>
        <button
          onClick={() => copy(window.location.origin)}
          className={cn(
            'ml-auto flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs font-medium transition-colors hover:bg-white/5',
            copied ? 'text-green-500' : 'text-muted-foreground'
          )}
        >
          {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
          {copied ? 'Copied' : 'Copy URL'}
        </button>
      </div>
      <p className="text-muted-foreground text-xs">
        Running in standalone mode. The HTTP server is always active. System notifications are not
        available — notification triggers are logged in-app only.
      </p>
    </>
  );
};
