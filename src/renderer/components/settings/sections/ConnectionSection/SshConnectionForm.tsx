import React from 'react';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@renderer/components/ui/select';
import { cn } from '@renderer/lib/utils';
import { Loader2, WifiOff } from 'lucide-react';

import { authMethodOptions } from './constants';

import type { SshAuthMethod, SshConfigHostEntry } from '@shared/types';

interface SshConnectionFormProps {
  host: string;
  setHost: React.Dispatch<React.SetStateAction<string>>;
  port: string;
  setPort: React.Dispatch<React.SetStateAction<string>>;
  username: string;
  setUsername: React.Dispatch<React.SetStateAction<string>>;
  authMethod: SshAuthMethod;
  setAuthMethod: React.Dispatch<React.SetStateAction<SshAuthMethod>>;
  password: string;
  setPassword: React.Dispatch<React.SetStateAction<string>>;
  privateKeyPath: string;
  setPrivateKeyPath: React.Dispatch<React.SetStateAction<string>>;
  showDropdown: boolean;
  setShowDropdown: React.Dispatch<React.SetStateAction<boolean>>;
  setTestResult: React.Dispatch<React.SetStateAction<{ success: boolean; error?: string } | null>>;
  hostInputRef: React.RefObject<HTMLInputElement | null>;
  dropdownRef: React.RefObject<HTMLDivElement | null>;
  filteredHosts: SshConfigHostEntry[];
  inputClass: string;
  testing: boolean;
  testResult: { success: boolean; error?: string } | null;
  isConnecting: boolean;
  clearProfileSelection: () => void;
  handleSelectConfigHost: (entry: SshConfigHostEntry) => void;
  handleTest: () => Promise<void>;
  handleConnect: () => Promise<void>;
}

export const SshConnectionForm = ({
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
  showDropdown,
  setShowDropdown,
  setTestResult,
  hostInputRef,
  dropdownRef,
  filteredHosts,
  inputClass,
  testing,
  testResult,
  isConnecting,
  clearProfileSelection,
  handleSelectConfigHost,
  handleTest,
  handleConnect,
}: SshConnectionFormProps): JSX.Element => {
  return (
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
                  {entry.hostName && (
                    <span className="text-muted-foreground">{entry.hostName}</span>
                  )}
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
        {/* Select renders its own accessible button; label wraps it semantically. */}
        {/* oxlint-disable-next-line jsx-a11y/label-has-associated-control */}
        <label className="text-muted-foreground mb-1 block text-xs">
          Authentication
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
        </label>
      </div>

      {authMethod === 'privateKey' && (
        <div>
          <label
            htmlFor="ssh-private-key-path"
            className="text-muted-foreground mb-1 block text-xs"
          >
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
  );
};
