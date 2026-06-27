import { JSX } from 'react';
import { cn } from '@renderer/lib/utils';
import { useStore } from '@renderer/store';
import { Loader2, Monitor, RefreshCw, Wifi, WifiOff } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';

interface ConnectionStatusBadgeProps {
  contextId: string;
  className?: string;
}

export const ConnectionStatusBadge = ({
  contextId,
  className,
}: Readonly<ConnectionStatusBadgeProps>): JSX.Element => {
  const { connectionState, connectedHost } = useStore(
    useShallow((s) => ({
      connectionState: s.connectionState,
      connectedHost: s.connectedHost,
    }))
  );

  if (contextId === 'local') {
    return <Monitor className={cn('text-muted-foreground size-3.5', className)} />;
  }

  const isConnectedToThisHost = connectedHost != null && contextId === `ssh-${connectedHost}`;
  const effectiveState = isConnectedToThisHost ? connectionState : 'disconnected';

  switch (effectiveState) {
    case 'connected':
      return <Wifi className={cn('size-3.5 text-green-400', className)} />;
    case 'connecting':
      return <Loader2 className={cn('text-muted-foreground size-3.5 animate-spin', className)} />;
    case 'retrying':
      return <RefreshCw className={cn('size-3.5 animate-spin text-amber-400', className)} />;
    case 'disconnected':
      return <WifiOff className={cn('text-muted-foreground size-3.5', className)} />;
    case 'error':
      return <WifiOff className={cn('size-3.5 text-red-400', className)} />;
    default:
      return <WifiOff className={cn('text-muted-foreground size-3.5', className)} />;
  }
};
