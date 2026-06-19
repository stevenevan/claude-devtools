import { api } from '@renderer/api';

import { getFullResetState } from '../utils/stateResetHelpers';

import type { AppState } from '../types';
import type {
  SshConfigHostEntry,
  SshConnectionConfig,
  SshConnectionState,
  SshLastConnection,
} from '@shared/types';
import type { StateCreator } from 'zustand';

export interface ConnectionSlice {
  connectionMode: 'local' | 'ssh';
  connectionState: SshConnectionState;
  connectedHost: string | null;
  connectionError: string | null;
  sshConfigHosts: SshConfigHostEntry[];
  lastSshConfig: SshLastConnection | null;

  connectSsh: (config: SshConnectionConfig) => Promise<void>;
  disconnectSsh: () => Promise<void>;
  testConnection: (config: SshConnectionConfig) => Promise<{ success: boolean; error?: string }>;
  setConnectionStatus: (
    state: SshConnectionState,
    host: string | null,
    error: string | null
  ) => void;
  fetchSshConfigHosts: () => Promise<void>;
  resolveConfigHost: (alias: string) => Promise<SshConfigHostEntry | null>;
  loadLastConnection: () => Promise<void>;
}

export const createConnectionSlice: StateCreator<AppState, [], [], ConnectionSlice> = (
  set,
  get
) => ({
  connectionMode: 'local',
  connectionState: 'disconnected',
  connectedHost: null,
  connectionError: null,
  sshConfigHosts: [],
  lastSshConfig: null,

  connectSsh: async (config: SshConnectionConfig): Promise<void> => {
    set({
      connectionState: 'connecting',
      connectedHost: config.host,
      connectionError: null,
    });

    try {
      const status = await api.ssh.connect(config);
      set({
        connectionMode: status.state === 'connected' ? 'ssh' : 'local',
        connectionState: status.state,
        connectedHost: status.host,
        connectionError: status.error,
        ...(status.state === 'connected'
          ? {
              activeContextId: `ssh-${config.host}`,
              projects: [],
              repositoryGroups: [],
              openTabs: [],
              activeTabId: null,
              selectedTabIds: [],
              paneLayout: {
                panes: [
                  {
                    id: 'pane-default',
                    tabs: [],
                    activeTabId: null,
                    selectedTabIds: [],
                    widthFraction: 1,
                  },
                ],
                focusedPaneId: 'pane-default',
              },
              ...getFullResetState(),
            }
          : {}),
      });

      if (status.state === 'connected') {
        const state = get();
        void state.fetchProjects();
        void state.fetchRepositoryGroups();

        const saved: SshLastConnection = {
          host: config.host,
          port: config.port,
          username: config.username,
          authMethod: config.authMethod,
          privateKeyPath: config.privateKeyPath,
        };
        set({ lastSshConfig: saved });
        void api.ssh.saveLastConnection(saved);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      set({
        connectionState: 'error',
        connectionError: message,
      });
    }
  },

  disconnectSsh: async (): Promise<void> => {
    try {
      const status = await api.ssh.disconnect();
      set({
        connectionMode: 'local',
        connectionState: status.state,
        connectedHost: null,
        connectionError: null,
        activeContextId: 'local',
        projects: [],
        repositoryGroups: [],
        openTabs: [],
        activeTabId: null,
        selectedTabIds: [],
        paneLayout: {
          panes: [
            {
              id: 'pane-default',
              tabs: [],
              activeTabId: null,
              selectedTabIds: [],
              widthFraction: 1,
            },
          ],
          focusedPaneId: 'pane-default',
        },
        ...getFullResetState(),
      });

      const state = get();
      void state.fetchProjects();
      void state.fetchRepositoryGroups();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      set({ connectionError: message });
    }
  },

  testConnection: async (
    config: SshConnectionConfig
  ): Promise<{ success: boolean; error?: string }> => {
    try {
      return await api.ssh.test(config);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, error: message };
    }
  },

  setConnectionStatus: (
    state: SshConnectionState,
    host: string | null,
    error: string | null
  ): void => {
    set({
      connectionState: state,
      connectionMode: state === 'connected' ? 'ssh' : 'local',
      connectedHost: host,
      connectionError: error,
    });
  },

  fetchSshConfigHosts: async (): Promise<void> => {
    try {
      const hosts = await api.ssh.getConfigHosts();
      set({ sshConfigHosts: hosts });
    } catch {
      // Gracefully ignore - SSH config may not exist
      set({ sshConfigHosts: [] });
    }
  },

  resolveConfigHost: async (alias: string): Promise<SshConfigHostEntry | null> => {
    try {
      return await api.ssh.resolveHost(alias);
    } catch {
      return null;
    }
  },

  loadLastConnection: async (): Promise<void> => {
    try {
      const saved = await api.ssh.getLastConnection();
      set({ lastSshConfig: saved });
    } catch {
      // Gracefully ignore - no saved connection
    }
  },
});
