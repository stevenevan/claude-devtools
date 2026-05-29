import { Wifi } from 'lucide-react';

interface ConnectionStatusProps {
  isConnected: boolean;
  connectedHost: string | null;
  connectionError: string | null;
  onDisconnect: () => void;
}

export const ConnectionStatus = ({
  isConnected,
  connectedHost,
  connectionError,
  onDisconnect,
}: ConnectionStatusProps): JSX.Element => {
  return (
    <>
      {/* Connection Status */}
      {isConnected && (
        <div className="flex items-center gap-3 rounded-md border border-green-500/30 bg-green-500/5 px-4 py-3">
          <Wifi className="size-4 text-green-400" />
          <div className="flex-1">
            <p className="text-foreground text-sm font-medium">Connected to {connectedHost}</p>
            <p className="text-muted-foreground text-xs">Viewing remote sessions via SSH</p>
          </div>
          <button
            onClick={onDisconnect}
            className="bg-card text-muted-foreground rounded-md px-3 py-1.5 text-sm transition-colors"
          >
            Disconnect
          </button>
        </div>
      )}

      {connectionError && (
        <div className="rounded-md border border-red-500/20 bg-red-500/10 px-4 py-3">
          <p className="text-sm text-red-400">{connectionError}</p>
        </div>
      )}
    </>
  );
};
