import type {
  SshConfigHostEntry,
  SshConnectionConfig,
  SshConnectionStatus,
  SshLastConnection,
} from '@shared/types';

import { call } from '../invoke';

// SSH data methods (DesktopAPI.ssh slice, W11). Mirrors sshservice's 8 commands.
// The `onStatus` event is wired separately in system.ts (sshEvents, W02); the
// tauriClient merges both into the `ssh` slice. connect/test emit ssh-status
// events (connecting → retrying → connected/error) that onStatus receives. No
// reviveDates (no Date fields).
export const sshCommands = {
  connect: (config: SshConnectionConfig): Promise<SshConnectionStatus> =>
    call<SshConnectionStatus>('ssh_connect', { config }),
  disconnect: (): Promise<SshConnectionStatus> => call<SshConnectionStatus>('ssh_disconnect'),
  getState: (): Promise<SshConnectionStatus> => call<SshConnectionStatus>('ssh_get_state'),
  test: (config: SshConnectionConfig): Promise<{ success: boolean; error?: string }> =>
    call<{ success: boolean; error?: string }>('ssh_test', { config }),
  getConfigHosts: (): Promise<SshConfigHostEntry[]> =>
    call<SshConfigHostEntry[]>('ssh_get_config_hosts'),
  resolveHost: (alias: string): Promise<SshConfigHostEntry | null> =>
    call<SshConfigHostEntry | null>('ssh_resolve_host', { alias }),
  saveLastConnection: (config: SshLastConnection): Promise<void> =>
    call<void>('ssh_save_last_connection', { config }),
  getLastConnection: (): Promise<SshLastConnection | null> =>
    call<SshLastConnection | null>('ssh_get_last_connection'),
};
