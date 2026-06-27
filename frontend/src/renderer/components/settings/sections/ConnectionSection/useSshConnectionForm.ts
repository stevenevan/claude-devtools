import { useCallback, useEffect, useMemo, useRef, useState, Dispatch, SetStateAction, RefObject } from 'react';

import { api } from '@renderer/api';
import { useStore } from '@renderer/store';

import type {
  ClaudeRootInfo,
  SshAuthMethod,
  SshConfigHostEntry,
  SshConnectionConfig,
  SshConnectionProfile,
} from '@shared/types';

interface UseSshConnectionForm {
  host: string;
  setHost: Dispatch<SetStateAction<string>>;
  port: string;
  setPort: Dispatch<SetStateAction<string>>;
  username: string;
  setUsername: Dispatch<SetStateAction<string>>;
  authMethod: SshAuthMethod;
  setAuthMethod: Dispatch<SetStateAction<SshAuthMethod>>;
  password: string;
  setPassword: Dispatch<SetStateAction<string>>;
  privateKeyPath: string;
  setPrivateKeyPath: Dispatch<SetStateAction<string>>;
  testing: boolean;
  testResult: { success: boolean; error?: string } | null;
  setTestResult: Dispatch<SetStateAction<{ success: boolean; error?: string } | null>>;
  showDropdown: boolean;
  setShowDropdown: Dispatch<SetStateAction<boolean>>;
  hostInputRef: RefObject<HTMLInputElement | null>;
  dropdownRef: RefObject<HTMLDivElement | null>;
  savedProfiles: SshConnectionProfile[];
  selectedProfileId: string | null;
  filteredHosts: SshConfigHostEntry[];
  inputClass: string;
  isConnecting: boolean;
  isConnected: boolean;
  connectionError: string | null;
  connectedHost: string | null;
  resolvedClaudeRootPath: string;
  clearProfileSelection: () => void;
  handleSelectConfigHost: (entry: SshConfigHostEntry) => void;
  handleSelectProfile: (profile: SshConnectionProfile) => void;
  handleTest: () => Promise<void>;
  handleConnect: () => Promise<void>;
  handleDisconnect: () => Promise<void>;
}

export const useSshConnectionForm = (): UseSshConnectionForm => {
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

  const [host, setHost] = useState('');
  const [port, setPort] = useState('22');
  const [username, setUsername] = useState('');
  const [authMethod, setAuthMethod] = useState<SshAuthMethod>('auto');
  const [password, setPassword] = useState('');
  const [privateKeyPath, setPrivateKeyPath] = useState('~/.ssh/id_rsa');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; error?: string } | null>(null);

  const [showDropdown, setShowDropdown] = useState(false);
  const hostInputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const [savedProfiles, setSavedProfiles] = useState<SshConnectionProfile[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null);
  const [claudeRootInfo, setClaudeRootInfo] = useState<ClaudeRootInfo | null>(null);

  // ponytail: useCallback required — in useEffect dep array
  const loadProfiles = useCallback(async () => {
    try {
      const config = await api.config.get();
      const loaded = config.ssh;
      setSavedProfiles(loaded?.profiles ?? []);
    } catch {
      // ignore
    }
  }, []);

  // ponytail: useCallback required — in useEffect dep array
  const loadClaudeRootInfo = useCallback(async () => {
    try {
      const info = await api.config.getClaudeRootInfo();
      setClaudeRootInfo(info);
    } catch {
      // ignore
    }
  }, []);

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

  return {
    host,
    setHost,
    port,
    setPort,
    username,
    setUsername,
    authMethod,
    setAuthMethod,
    password,
    setPassword,
    privateKeyPath,
    setPrivateKeyPath,
    testing,
    testResult,
    setTestResult,
    showDropdown,
    setShowDropdown,
    hostInputRef,
    dropdownRef,
    savedProfiles,
    selectedProfileId,
    filteredHosts,
    inputClass,
    isConnecting,
    isConnected,
    connectionError,
    connectedHost,
    resolvedClaudeRootPath,
    clearProfileSelection,
    handleSelectConfigHost,
    handleSelectProfile,
    handleTest,
    handleConnect,
    handleDisconnect,
  };
};
