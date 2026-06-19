import type { SshAuthMethod } from '@shared/types';

export const authMethodOptions: readonly { value: SshAuthMethod; label: string }[] = [
  { value: 'auto', label: 'Auto (from SSH Config)' },
  { value: 'agent', label: 'SSH Agent' },
  { value: 'privateKey', label: 'Private Key' },
  { value: 'password', label: 'Password' },
];
