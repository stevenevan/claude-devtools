/**
 * Sandbox RPC bridge (sprint 38).
 *
 * Mediates `postMessage` between the host and a plugin Worker. The
 * bridge enforces:
 *  - method allowlist (anything not in `PUBLIC_METHODS` rejected),
 *  - per-plugin subscription quota,
 *  - 64KB payload limit on subscription emissions,
 *  - PluginDisposedError on pending RPCs at teardown.
 */

import {
  PluginDisposedError,
  SUBSCRIPTION_PAYLOAD_LIMIT_BYTES,
  SUBSCRIPTION_QUOTA,
} from './pluginApi';

export const PUBLIC_METHODS: readonly string[] = [
  'registerPanel',
  'registerCommand',
  'registerContextMenuItem',
  'subscribeStoreSlice',
  'unsubscribeStoreSlice',
];

export interface RpcRequest {
  type: 'rpc';
  rpcId: string;
  method: string;
  args: unknown[];
}

export interface RpcResponse {
  type: 'rpc-response';
  rpcId: string;
  ok: boolean;
  result?: unknown;
  error?: string;
}

export interface SubscriptionEmit {
  type: 'subscription';
  subscriptionId: string;
  payload: unknown;
}

export type BridgeMessage = RpcRequest | RpcResponse | SubscriptionEmit;

export interface PendingRpc {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

export class SandboxBridge {
  private readonly pluginId: string;
  private readonly pending = new Map<string, PendingRpc>();
  private readonly subscriptions = new Set<string>();
  private disposed = false;

  constructor(pluginId: string) {
    this.pluginId = pluginId;
  }

  isPublicMethod(method: string): boolean {
    return PUBLIC_METHODS.includes(method);
  }

  registerSubscription(subscriptionId: string): { ok: boolean; reason?: string } {
    if (this.subscriptions.size >= SUBSCRIPTION_QUOTA) {
      return { ok: false, reason: 'Subscription quota exceeded' };
    }
    this.subscriptions.add(subscriptionId);
    return { ok: true };
  }

  unregisterSubscription(subscriptionId: string): void {
    this.subscriptions.delete(subscriptionId);
  }

  /** Returns false (and rejects emission) when payload exceeds the
   * 64KB cap, so the host can drop the message and log. */
  emissionAllowed(payload: unknown): boolean {
    try {
      const json = JSON.stringify(payload);
      return new TextEncoder().encode(json).byteLength <= SUBSCRIPTION_PAYLOAD_LIMIT_BYTES;
    } catch {
      return false;
    }
  }

  trackRpc(rpcId: string, pending: PendingRpc): void {
    if (this.disposed) {
      pending.reject(new PluginDisposedError(this.pluginId));
      return;
    }
    this.pending.set(rpcId, pending);
  }

  resolveRpc(rpcId: string, result: unknown): void {
    const entry = this.pending.get(rpcId);
    if (!entry) return;
    this.pending.delete(rpcId);
    entry.resolve(result);
  }

  rejectRpc(rpcId: string, error: string): void {
    const entry = this.pending.get(rpcId);
    if (!entry) return;
    this.pending.delete(rpcId);
    entry.reject(new Error(error));
  }

  /** Reject all pending RPCs with PluginDisposedError. */
  dispose(): void {
    this.disposed = true;
    for (const pending of this.pending.values()) {
      pending.reject(new PluginDisposedError(this.pluginId));
    }
    this.pending.clear();
    this.subscriptions.clear();
  }

  get isDisposed(): boolean {
    return this.disposed;
  }

  get subscriptionCount(): number {
    return this.subscriptions.size;
  }
}
