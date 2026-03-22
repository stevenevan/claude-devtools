/**
 * WorkspaceSection - Settings section for managing saved SSH connection profiles.
 *
 * Provides CRUD UI for:
 * - Listing saved SSH profiles
 * - Adding new profiles (name, host, port, username, auth method)
 * - Inline editing existing profile fields
 * - Deleting profiles with confirmation
 *
 * Profile changes persist via ConfigManager and trigger context list refresh.
 */

import { useCallback, useEffect, useState } from 'react';

import { api } from '@renderer/api';
import { confirm } from '@renderer/components/common/ConfirmDialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@renderer/components/ui/select';
import { useDisclosure } from '@renderer/hooks/mantine';
import { useStore } from '@renderer/store';
import { Edit2, Loader2, Plus, Save, Server, Trash2, X } from 'lucide-react';

import { SettingsSectionHeader } from '../components/SettingsSectionHeader';

import type { SshAuthMethod, SshConnectionProfile } from '@shared/types';

const inputClass =
  'w-full rounded-md border border-border bg-surface-raised px-3 py-1.5 text-sm text-text focus:outline-hidden focus:ring-1';

const authMethodOptions: readonly { value: SshAuthMethod; label: string }[] = [
  { value: 'auto', label: 'Auto (from SSH Config)' },
  { value: 'agent', label: 'SSH Agent' },
  { value: 'privateKey', label: 'Private Key' },
  { value: 'password', label: 'Password' },
];

const defaultForm = {
  name: '',
  host: '',
  port: '22',
  username: '',
  authMethod: 'auto' as SshAuthMethod,
  privateKeyPath: '',
};

export const WorkspaceSection = (): React.JSX.Element => {
  const [profiles, setProfiles] = useState<SshConnectionProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showAddForm, { open: openAddForm, close: closeAddForm }] = useDisclosure(false);

  // Form state
  const [formName, setFormName] = useState(defaultForm.name);
  const [formHost, setFormHost] = useState(defaultForm.host);
  const [formPort, setFormPort] = useState(defaultForm.port);
  const [formUsername, setFormUsername] = useState(defaultForm.username);
  const [formAuthMethod, setFormAuthMethod] = useState<SshAuthMethod>(defaultForm.authMethod);
  const [formPrivateKeyPath, setFormPrivateKeyPath] = useState(defaultForm.privateKeyPath);

  const resetForm = useCallback(() => {
    setFormName(defaultForm.name);
    setFormHost(defaultForm.host);
    setFormPort(defaultForm.port);
    setFormUsername(defaultForm.username);
    setFormAuthMethod(defaultForm.authMethod);
    setFormPrivateKeyPath(defaultForm.privateKeyPath);
  }, []);

  const loadProfiles = useCallback(async () => {
    try {
      const config = await api.config.get();
      // AppConfig type doesn't include ssh field, but ConfigManager returns it at runtime
      const loaded = config.ssh;
      setProfiles(loaded?.profiles ?? []);
    } catch (error) {
      console.error('[WorkspaceSection] Failed to load profiles:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadProfiles();
  }, [loadProfiles]);

  // Populate form when editing starts
  useEffect(() => {
    if (editingId) {
      const profile = profiles.find((p) => p.id === editingId);
      if (profile) {
        setFormName(profile.name);
        setFormHost(profile.host);
        setFormPort(String(profile.port));
        setFormUsername(profile.username);
        setFormAuthMethod(profile.authMethod);
        setFormPrivateKeyPath(profile.privateKeyPath ?? '');
      }
    }
  }, [editingId, profiles]);

  const handleAdd = async (): Promise<void> => {
    const newProfile: SshConnectionProfile = {
      id: crypto.randomUUID(),
      name: formName.trim(),
      host: formHost.trim(),
      port: parseInt(formPort, 10) || 22,
      username: formUsername.trim(),
      authMethod: formAuthMethod,
      privateKeyPath: formAuthMethod === 'privateKey' ? formPrivateKeyPath.trim() : undefined,
    };

    await api.config.update('ssh', { profiles: [...profiles, newProfile] });
    await loadProfiles();
    resetForm();
    closeAddForm();
    void useStore.getState().fetchAvailableContexts();
  };

  const handleEdit = async (): Promise<void> => {
    const updatedProfiles = profiles.map((p) =>
      p.id === editingId
        ? {
            ...p,
            name: formName.trim(),
            host: formHost.trim(),
            port: parseInt(formPort, 10) || 22,
            username: formUsername.trim(),
            authMethod: formAuthMethod,
            privateKeyPath: formAuthMethod === 'privateKey' ? formPrivateKeyPath.trim() : undefined,
          }
        : p
    );

    await api.config.update('ssh', { profiles: updatedProfiles });
    await loadProfiles();
    setEditingId(null);
    resetForm();
    void useStore.getState().fetchAvailableContexts();
  };

  const handleDelete = async (id: string): Promise<void> => {
    const profile = profiles.find((p) => p.id === id);
    if (!profile) return;

    const confirmed = await confirm({
      title: 'Delete Profile',
      message: `Are you sure you want to delete "${profile.name}"? This cannot be undone.`,
      confirmLabel: 'Delete',
      variant: 'danger',
    });
    if (!confirmed) return;

    const filtered = profiles.filter((p) => p.id !== id);
    await api.config.update('ssh', { profiles: filtered });
    await loadProfiles();
    void useStore.getState().fetchAvailableContexts();
  };

  const isFormValid =
    formName.trim() !== '' && formHost.trim() !== '' && formUsername.trim() !== '';

  const renderForm = (onSave: () => Promise<void>, onCancel: () => void): React.JSX.Element => (
    <div className="border-border bg-surface-raised space-y-3 rounded-md border p-4">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="ws-profile-name" className="text-text-muted mb-1 block text-xs">
            Name
          </label>
          <input
            id="ws-profile-name"
            type="text"
            value={formName}
            onChange={(e) => setFormName(e.target.value)}
            placeholder="My Server"
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="ws-profile-host" className="text-text-muted mb-1 block text-xs">
            Host
          </label>
          <input
            id="ws-profile-host"
            type="text"
            value={formHost}
            onChange={(e) => setFormHost(e.target.value)}
            placeholder="hostname or IP"
            className={inputClass}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="ws-profile-port" className="text-text-muted mb-1 block text-xs">
            Port
          </label>
          <input
            id="ws-profile-port"
            type="text"
            value={formPort}
            onChange={(e) => setFormPort(e.target.value)}
            placeholder="22"
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="ws-profile-username" className="text-text-muted mb-1 block text-xs">
            Username
          </label>
          <input
            id="ws-profile-username"
            type="text"
            value={formUsername}
            onChange={(e) => setFormUsername(e.target.value)}
            placeholder="user"
            className={inputClass}
          />
        </div>
      </div>

      <div>
        <label className="text-text-muted mb-1 block text-xs">Authentication</label>
        <Select value={formAuthMethod} onValueChange={(v) => setFormAuthMethod(v!)}>
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

      {formAuthMethod === 'privateKey' && (
        <div>
          <label
            htmlFor="ws-profile-private-key-path"
            className="text-text-muted mb-1 block text-xs"
          >
            Private Key Path
          </label>
          <input
            id="ws-profile-private-key-path"
            type="text"
            value={formPrivateKeyPath}
            onChange={(e) => setFormPrivateKeyPath(e.target.value)}
            placeholder="~/.ssh/id_rsa"
            className={inputClass}
          />
        </div>
      )}

      {formAuthMethod === 'password' && (
        <p className="text-text-muted text-xs">
          You will be prompted for the password when connecting.
        </p>
      )}

      <div className="flex items-center gap-2 pt-1">
        <button
          onClick={() => void onSave()}
          disabled={!isFormValid}
          className="bg-surface-raised text-text flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition-colors disabled:opacity-50"
        >
          <Save className="size-3.5" />
          Save
        </button>
        <button
          onClick={onCancel}
          className="text-text-muted flex items-center gap-1.5 rounded-md bg-transparent px-3 py-1.5 text-sm transition-colors"
        >
          <X className="size-3.5" />
          Cancel
        </button>
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      <SettingsSectionHeader title="Workspace Profiles" />
      <p className="text-text-muted text-sm">Save SSH connection profiles for quick reconnection</p>

      {loading && (
        <div className="text-text-muted flex items-center gap-2 py-4">
          <Loader2 className="size-4 animate-spin" />
          <span className="text-sm">Loading profiles...</span>
        </div>
      )}

      {!loading && profiles.length === 0 && !showAddForm && (
        <div className="border-border text-text-muted rounded-md border py-8 text-center">
          <Server className="mx-auto mb-2 size-8 opacity-40" />
          <p className="text-sm">No saved profiles</p>
          <p className="mt-1 text-xs">Add an SSH profile to connect quickly</p>
        </div>
      )}

      {!loading && (
        <div className="space-y-3">
          {profiles.map((profile) =>
            editingId === profile.id ? (
              <div key={profile.id}>
                {renderForm(handleEdit, () => {
                  setEditingId(null);
                  resetForm();
                })}
              </div>
            ) : (
              <div
                key={profile.id}
                className="border-border bg-surface-raised flex items-center gap-3 rounded-md border p-4"
              >
                <Server className="text-text-muted size-4 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-text truncate text-sm font-medium">{profile.name}</p>
                  <p className="text-text-muted truncate text-xs">
                    {profile.username}@{profile.host}:{profile.port}
                  </p>
                </div>
                <span className="bg-surface text-text-muted shrink-0 rounded-sm px-1.5 py-0.5 text-xs">
                  {profile.authMethod}
                </span>
                <button
                  onClick={() => setEditingId(profile.id)}
                  className="hover:bg-surface-raised text-text-muted shrink-0 rounded-sm p-1 transition-colors"
                  title="Edit profile"
                >
                  <Edit2 className="size-3.5" />
                </button>
                <button
                  onClick={() => void handleDelete(profile.id)}
                  className="hover:bg-surface-raised text-text-muted shrink-0 rounded-sm p-1 transition-colors"
                  title="Delete profile"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            )
          )}
        </div>
      )}

      {!loading && (
        <div>
          {showAddForm ? (
            renderForm(handleAdd, () => {
              closeAddForm();
              resetForm();
            })
          ) : (
            <button
              onClick={() => {
                resetForm();
                openAddForm();
              }}
              className="bg-surface-raised text-text-secondary flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition-colors"
            >
              <Plus className="size-3.5" />
              Add Profile
            </button>
          )}
        </div>
      )}
    </div>
  );
};
