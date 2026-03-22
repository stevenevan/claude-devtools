/**
 * ConnectionSection - Settings section for SSH connection management.
 *
 * Provides UI for:
 * - Toggling between local and SSH modes
 * - Configuring SSH connection (host, port, username, auth)
 * - SSH config host alias combobox with auto-fill
 * - Testing and connecting to remote hosts
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { api } from '@renderer/api';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@renderer/components/ui/select';
import { cn } from '@renderer/lib/utils';
import { useStore } from '@renderer/store';
import { Loader2, Monitor, Server, Wifi, WifiOff } from 'lucide-react';

import { SettingRow } from '../components/SettingRow';
import { SettingsSectionHeader } from '../components/SettingsSectionHeader';

import type {
  ClaudeRootInfo,
  SshAuthMethod,
  SshConfigHostEntry,
  SshConnectionConfig,
  SshConnectionProfile,
} from '@shared/types';

const authMethodOptions: readonly { value: SshAuthMethod; label: string }[] = [
  { value: 'auto', label: 'Auto (from SSH Config)' },
  { value: 'agent', label: 'SSH Agent' },
  { value: 'privateKey', label: 'Private Key' },
  { value: 'password', label: 'Password' },
];

export const ConnectionSection = (): React.JSX.Element => {
  const connectionState = useStore((s) => s.connectionState);
  const connectedHost = useStore((s) => s.connectedHost);
  const connectionError = useStore((s) => s.connectionError);
  const connectSsh = useStore((s) => s.connectSsh);
  const disconnectSsh = useStore((s) => s.disconnectSsh);
  const testConnection = useStore((s) => s.testConnection);
  const sshConfigHosts = useStore((s) => s.sshConfigHosts);
  const fetchSshConfigHosts = useStore((s) => s.fetchSshConfigHosts);
  const lastSshConfig = useStore((s) => s.lastSshConfig);
  const loadLastConnection = useStore((s) => s.loadLastConnection);

  // Form state
  const [host, setHost] = useState('');
  const [port, setPort] = useState('22');
  const [username, setUsername] = useState('');
  const [authMethod, setAuthMethod] = useState<SshAuthMethod>('auto');
  const [password, setPassword] = useState('');
  const [privateKeyPath, setPrivateKeyPath] = useState('~/.ssh/id_rsa');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; error?: string } | null>(null);

  // Combobox state
  const [showDropdown, setShowDropdown] = useState(false);
  const hostInputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Saved profiles
  const [savedProfiles, setSavedProfiles] = useState<SshConnectionProfile[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null);
  const [claudeRootInfo, setClaudeRootInfo] = useState<ClaudeRootInfo | null>(null);

  const loadProfiles = useCallback(async () => {
    try {
      const config = await api.config.get();
      const loaded = config.ssh;
      setSavedProfiles(loaded?.profiles ?? []);
    } catch {
      // ignore
    }
  }, []);

  const loadClaudeRootInfo = useCallback(async () => {
    try {
      const info = await api.config.getClaudeRootInfo();
      setClaudeRootInfo(info);
    } catch {
      // ignore
    }
  }, []);

  // Fetch SSH config hosts, saved profiles, and load last connection on mount
  useEffect(() => {
    void fetchSshConfigHosts();
    void loadLastConnection();
    void loadProfiles();
    void loadClaudeRootInfo();
  }, [fetchSshConfigHosts, loadLastConnection, loadProfiles, loadClaudeRootInfo]);

  // Pre-fill form from saved connection config when it arrives (one-time on mount).
  // setState in effect is intentional: lastSshConfig loads async from IPC, so we can't
  // use it as useState initializers.
  const prefilled = useRef(false);
  useEffect(() => {
    if (lastSshConfig && connectionState !== 'connected' && !prefilled.current) {
      prefilled.current = true;
      setHost(lastSshConfig.host);
      setPort(String(lastSshConfig.port));
      setUsername(lastSshConfig.username);
      setAuthMethod(lastSshConfig.authMethod);
      if (lastSshConfig.privateKeyPath) {
        setPrivateKeyPath(lastSshConfig.privateKeyPath);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-time prefill when async data arrives
  }, [lastSshConfig]);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent): void => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node) &&
        hostInputRef.current &&
        !hostInputRef.current.contains(e.target as Node)
      ) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Filter config hosts based on input
  const filteredHosts = useMemo(() => {
    if (!host.trim()) return sshConfigHosts;
    const lower = host.toLowerCase();
    return sshConfigHosts.filter(
      (entry) =>
        entry.alias.toLowerCase().includes(lower) || entry.hostName?.toLowerCase().includes(lower)
    );
  }, [host, sshConfigHosts]);

  const clearProfileSelection = (): void => setSelectedProfileId(null);

  const handleSelectConfigHost = (entry: SshConfigHostEntry): void => {
    setHost(entry.alias);
    if (entry.port) setPort(String(entry.port));
    if (entry.user) setUsername(entry.user);
    setAuthMethod('auto');
    setShowDropdown(false);
    setTestResult(null);
    clearProfileSelection();
  };

  const handleSelectProfile = (profile: SshConnectionProfile): void => {
    setHost(profile.host);
    setPort(String(profile.port));
    setUsername(profile.username);
    setAuthMethod(profile.authMethod);
    if (profile.privateKeyPath) setPrivateKeyPath(profile.privateKeyPath);
    setPassword('');
    setTestResult(null);
    setSelectedProfileId(profile.id);
  };

  const buildConfig = (): SshConnectionConfig => ({
    host,
    port: parseInt(port, 10) || 22,
    username,
    authMethod,
    password: authMethod === 'password' ? password : undefined,
    privateKeyPath: authMethod === 'privateKey' ? privateKeyPath : undefined,
  });

  const handleTest = async (): Promise<void> => {
    setTesting(true);
    setTestResult(null);
    const result = await testConnection(buildConfig());
    setTestResult(result);
    setTesting(false);
  };

  const handleConnect = async (): Promise<void> => {
    await connectSsh(buildConfig());
  };

  const handleDisconnect = async (): Promise<void> => {
    await disconnectSsh();
  };

  const isConnecting = connectionState === 'connecting';
  const isConnected = connectionState === 'connected';
  const resolvedClaudeRootPath = claudeRootInfo?.resolvedPath ?? '~/.claude';

  const inputClass =
    'w-full rounded-md border border-border bg-card px-3 py-1.5 text-sm text-foreground focus:outline-hidden focus:ring-1';

  return (
    <div className="space-y-6">
      <SettingsSectionHeader title="Remote Connection" />
      <p className="text-muted-foreground text-sm">
        Connect to a remote machine to view Claude Code sessions running there
      </p>

      {/* Connection Status */}
      {isConnected && (
        <div className="flex items-center gap-3 rounded-md border border-green-500/30 bg-green-500/5 px-4 py-3">
          <Wifi className="size-4 text-green-400" />
          <div className="flex-1">
            <p className="text-foreground text-sm font-medium">Connected to {connectedHost}</p>
            <p className="text-muted-foreground text-xs">Viewing remote sessions via SSH</p>
          </div>
          <button
            onClick={() => void handleDisconnect()}
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

      {/* Mode indicator */}
      {!isConnected && (
        <SettingRow label="Current Mode" description="Data source for session files">
          <div className="text-muted-foreground flex items-center gap-2 text-sm">
            <Monitor className="size-4" />
            <span>Local ({resolvedClaudeRootPath})</span>
          </div>
        </SettingRow>
      )}

      {/* Saved Profiles */}
      {!isConnected && savedProfiles.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-muted-foreground text-sm font-medium">Saved Profiles</h3>
          <div className="flex flex-wrap gap-2">
            {savedProfiles.map((profile) => {
              const isSelected = selectedProfileId === profile.id;
              return (
                <button
                  key={profile.id}
                  type="button"
                  onClick={() => handleSelectProfile(profile)}
                  className={cn(
                    'flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm transition-colors',
                    isSelected
                      ? 'border-indigo-500/40 bg-indigo-500/10 text-foreground'
                      : 'border-border text-muted-foreground hover:bg-card'
                  )}
                >
                  <Server
                    className={cn('size-3.5', isSelected ? 'text-indigo-400' : 'text-muted-foreground')}
                  />
                  <span>{profile.name}</span>
                  <span className="text-muted-foreground text-xs">
                    {profile.username}@{profile.host}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* SSH Connection Form */}
      {!isConnected && (
        <div className="space-y-4">
          <h3 className="text-muted-foreground text-sm font-medium">SSH Connection</h3>

          <div className="grid grid-cols-2 gap-3">
            {/* Host input with combobox */}
            <div className="relative">
              <label htmlFor="ssh-host" className="text-muted-foreground mb-1 block text-xs">
                Host
              </label>
              <input
                id="ssh-host"
                ref={hostInputRef}
                type="text"
                value={host}
                onChange={(e) => {
                  setHost(e.target.value);
                  setShowDropdown(true);
                  setTestResult(null);
                  clearProfileSelection();
                }}
                onFocus={() => setShowDropdown(true)}
                placeholder="hostname or ssh config alias"
                className={inputClass}
              />
              {showDropdown && filteredHosts.length > 0 && (
                <div
                  ref={dropdownRef}
                  className="border-border bg-popover absolute z-50 mt-1 max-h-48 w-full overflow-y-auto rounded-md border shadow-lg"
                >
                  {filteredHosts.map((entry) => (
                    <button
                      key={entry.alias}
                      type="button"
                      className="hover:bg-card text-foreground flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors"
                      onClick={() => handleSelectConfigHost(entry)}
                    >
                      <span className="font-medium">{entry.alias}</span>
                      {entry.hostName && <span className="text-muted-foreground">{entry.hostName}</span>}
                      {entry.user && (
                        <span className="text-muted-foreground ml-auto text-xs">{entry.user}</span>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div>
              <label htmlFor="ssh-port" className="text-muted-foreground mb-1 block text-xs">
                Port
              </label>
              <input
                id="ssh-port"
                type="text"
                value={port}
                onChange={(e) => setPort(e.target.value)}
                placeholder="22"
                className={inputClass}
              />
            </div>
          </div>

          <div>
            <label htmlFor="ssh-username" className="text-muted-foreground mb-1 block text-xs">
              Username
            </label>
            <input
              id="ssh-username"
              type="text"
              value={username}
              onChange={(e) => {
                setUsername(e.target.value);
                clearProfileSelection();
              }}
              placeholder="user"
              className={inputClass}
            />
          </div>

          <div>
            <label className="text-muted-foreground mb-1 block text-xs">Authentication</label>
            <Select value={authMethod} onValueChange={(v) => setAuthMethod(v!)}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {authMethodOptions.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {authMethod === 'privateKey' && (
            <div>
              <label htmlFor="ssh-private-key-path" className="text-muted-foreground mb-1 block text-xs">
                Private Key Path
              </label>
              <input
                id="ssh-private-key-path"
                type="text"
                value={privateKeyPath}
                onChange={(e) => setPrivateKeyPath(e.target.value)}
                placeholder="~/.ssh/id_rsa"
                className={inputClass}
              />
            </div>
          )}

          {authMethod === 'password' && (
            <div>
              <label htmlFor="ssh-password" className="text-muted-foreground mb-1 block text-xs">
                Password
              </label>
              <input
                id="ssh-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={inputClass}
              />
            </div>
          )}

          {/* Test result */}
          {testResult && (
            <div
              className={cn(
                'rounded-md border px-3 py-2 text-sm',
                testResult.success
                  ? 'border-green-500/20 bg-green-500/10 text-green-400'
                  : 'border-red-500/20 bg-red-500/10 text-red-400'
              )}
            >
              {testResult.success
                ? 'Connection successful'
                : `Connection failed: ${testResult.error ?? 'Unknown error'}`}
            </div>
          )}

          {/* Action buttons */}
          <div className="flex items-center gap-3">
            <button
              onClick={() => void handleTest()}
              disabled={!host || testing || isConnecting}
              className="bg-card text-muted-foreground rounded-md px-4 py-1.5 text-sm transition-colors disabled:opacity-50"
            >
              {testing ? (
                <span className="flex items-center gap-2">
                  <Loader2 className="size-3 animate-spin" />
                  Testing...
                </span>
              ) : (
                'Test Connection'
              )}
            </button>

            <button
              onClick={() => void handleConnect()}
              disabled={!host || isConnecting}
              className="bg-card text-foreground rounded-md px-4 py-1.5 text-sm transition-colors disabled:opacity-50"
            >
              {isConnecting ? (
                <span className="flex items-center gap-2">
                  <Loader2 className="size-3 animate-spin" />
                  Connecting...
                </span>
              ) : (
                <span className="flex items-center gap-2">
                  <WifiOff className="size-3" />
                  Connect
                </span>
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
