import { cn } from '@renderer/lib/utils';
import { useStore } from '@renderer/store';
import { Loader2, Plug, ServerCrash, Wifi, WifiOff } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';

import type { SshConnectionState } from '@shared/types/api';

interface StatusMeta {
  label: string;
  className: string;
  Icon: typeof Wifi;
}

function statusMeta(state: SshConnectionState): StatusMeta {
  switch (state) {
    case 'connected':
      return { label: 'Connected', className: 'text-emerald-400', Icon: Wifi };
    case 'connecting':
      return { label: 'Authenticating…', className: 'text-amber-400', Icon: Plug };
    case 'retrying':
      return { label: 'Reconnecting…', className: 'text-amber-400', Icon: Loader2 };
    case 'error':
      return { label: 'Offline', className: 'text-red-400', Icon: ServerCrash };
    default:
      return { label: 'Disconnected', className: 'text-text-muted', Icon: WifiOff };
  }
}

export const SshStatusIndicator = (): React.JSX.Element | null => {
  const { mode, state, host, error } = useStore(
    useShallow((s) => ({
      mode: s.connectionMode,
      state: s.connectionState,
      host: s.connectedHost,
      error: s.connectionError,
    }))
  );

  if (mode !== 'ssh') return null;
  const meta = statusMeta(state);
  const isSpinning = state === 'retrying' || state === 'connecting';
  const hostSuffix = host ? `: ${host}` : '';
  return (
    <div
      title={error ?? `${meta.label}${hostSuffix}`}
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px]',
        meta.className,
        'border-border bg-surface-raised'
      )}
    >
      <meta.Icon className={cn('size-3', isSpinning && 'animate-spin')} />
      <span>{meta.label}</span>
      {host && <span className="text-text-muted">· {host}</span>}
    </div>
  );
};
