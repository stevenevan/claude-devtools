// SSH API

export type SshConnectionState = 'disconnected' | 'connecting' | 'retrying' | 'connected' | 'error';

export type SshAuthMethod = 'password' | 'privateKey' | 'agent' | 'auto';

export interface SshConfigHostEntry {
  alias: string;
  hostName?: string;
  user?: string;
  port?: number;
  hasIdentityFile: boolean;
}

export interface SshConnectionConfig {
  host: string;
  port: number;
  username: string;
  authMethod: SshAuthMethod;
  password?: string;
  privateKeyPath?: string;
}

export interface SshConnectionProfile {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  authMethod: SshAuthMethod;
  privateKeyPath?: string;
}

export interface SshConnectionStatus {
  state: SshConnectionState;
  host: string | null;
  error: string | null;
  remoteProjectsPath: string | null;
}

export interface SshLastConnection {
  host: string;
  port: number;
  username: string;
  authMethod: SshAuthMethod;
  privateKeyPath?: string;
}

export interface SshAPI {
  connect: (config: SshConnectionConfig) => Promise<SshConnectionStatus>;
  disconnect: () => Promise<SshConnectionStatus>;
  getState: () => Promise<SshConnectionStatus>;
  test: (config: SshConnectionConfig) => Promise<{ success: boolean; error?: string }>;
  getConfigHosts: () => Promise<SshConfigHostEntry[]>;
  resolveHost: (alias: string) => Promise<SshConfigHostEntry | null>;
  saveLastConnection: (config: SshLastConnection) => Promise<void>;
  getLastConnection: () => Promise<SshLastConnection | null>;
  onStatus: (callback: (event: unknown, status: SshConnectionStatus) => void) => () => void;
}
