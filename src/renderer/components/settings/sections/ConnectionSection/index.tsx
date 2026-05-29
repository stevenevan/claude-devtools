/**
 * ConnectionSection - Settings section for SSH connection management.
 *
 * Provides UI for:
 * - Toggling between local and SSH modes
 * - Configuring SSH connection (host, port, username, auth)
 * - SSH config host alias combobox with auto-fill
 * - Testing and connecting to remote hosts
 */

import { Monitor } from 'lucide-react';

import { SettingRow } from '../../components/SettingRow';
import { SettingsSectionHeader } from '../../components/SettingsSectionHeader';

import { ConnectionStatus } from './ConnectionStatus';
import { SavedProfiles } from './SavedProfiles';
import { SshConnectionForm } from './SshConnectionForm';
import { useSshConnectionForm } from './useSshConnectionForm';

export const ConnectionSection = (): React.JSX.Element => {
  const {
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
  } = useSshConnectionForm();

  return (
    <div className="space-y-6">
      <SettingsSectionHeader title="Remote Connection" />
      <p className="text-muted-foreground text-sm">
        Connect to a remote machine to view Claude Code sessions running there
      </p>

      <ConnectionStatus
        isConnected={isConnected}
        connectedHost={connectedHost}
        connectionError={connectionError}
        onDisconnect={() => void handleDisconnect()}
      />

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
      {!isConnected && (
        <SavedProfiles
          profiles={savedProfiles}
          selectedProfileId={selectedProfileId}
          onSelect={handleSelectProfile}
        />
      )}

      {/* SSH Connection Form */}
      {!isConnected && (
        <SshConnectionForm
          host={host}
          setHost={setHost}
          port={port}
          setPort={setPort}
          username={username}
          setUsername={setUsername}
          authMethod={authMethod}
          setAuthMethod={setAuthMethod}
          password={password}
          setPassword={setPassword}
          privateKeyPath={privateKeyPath}
          setPrivateKeyPath={setPrivateKeyPath}
          showDropdown={showDropdown}
          setShowDropdown={setShowDropdown}
          setTestResult={setTestResult}
          hostInputRef={hostInputRef}
          dropdownRef={dropdownRef}
          filteredHosts={filteredHosts}
          inputClass={inputClass}
          testing={testing}
          testResult={testResult}
          isConnecting={isConnecting}
          clearProfileSelection={clearProfileSelection}
          handleSelectConfigHost={handleSelectConfigHost}
          handleTest={handleTest}
          handleConnect={handleConnect}
        />
      )}
    </div>
  );
};
