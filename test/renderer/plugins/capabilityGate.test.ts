import { describe, expect, it } from 'vitest';

import {
  buildCapabilityPreamble,
  probeWorkerScope,
  WORKER_GLOBAL_ALLOWLIST,
} from '@renderer/plugins/capabilityGate';
import {
  PluginDisposedError,
  SUBSCRIPTION_QUOTA,
  TEARDOWN_TIMEOUT_MS,
} from '@renderer/plugins/pluginApi';
import { PUBLIC_METHODS, SandboxBridge } from '@renderer/plugins/sandboxBridge';

describe('capabilityGate allowlist', () => {
  it('allowlist enumerates only the explicit globals plugins may keep', () => {
    expect(WORKER_GLOBAL_ALLOWLIST).toEqual([
      'postMessage',
      'addEventListener',
      'removeEventListener',
      'console',
      'setTimeout',
      'clearTimeout',
      'self',
    ]);
  });

  it('preamble deletes everything off self that is not allowlisted', () => {
    const fakeSelf: Record<string, unknown> = {
      postMessage: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      console: { log: () => {} },
      setTimeout: () => 0,
      clearTimeout: () => {},
      self: null,
      fetch: () => {},
      XMLHttpRequest: function () {},
      importScripts: () => {},
      WebSocket: function () {},
      eval: () => {},
    };
    fakeSelf.self = fakeSelf;

    const preamble = buildCapabilityPreamble();
    const fn = new Function('self', preamble);
    fn(fakeSelf);

    const probe = probeWorkerScope(fakeSelf);
    expect(probe.fetch).toBe('undefined');
    expect(probe.XMLHttpRequest).toBe('undefined');
    expect(probe.importScripts).toBe('undefined');
    expect(fakeSelf.WebSocket).toBeUndefined();
    expect(fakeSelf.eval).toBeUndefined();
    expect(typeof fakeSelf.postMessage).toBe('function');
    expect(typeof fakeSelf.console).toBe('object');
  });
});

describe('SandboxBridge', () => {
  it('rejects non-public methods', () => {
    const bridge = new SandboxBridge('plug');
    expect(bridge.isPublicMethod('registerPanel')).toBe(true);
    expect(bridge.isPublicMethod('eval')).toBe(false);
    expect(bridge.isPublicMethod('readFile')).toBe(false);
    expect(PUBLIC_METHODS).toContain('subscribeStoreSlice');
  });

  it('caps subscriptions at SUBSCRIPTION_QUOTA', () => {
    const bridge = new SandboxBridge('plug');
    for (let i = 0; i < SUBSCRIPTION_QUOTA; i++) {
      expect(bridge.registerSubscription(`s${i}`).ok).toBe(true);
    }
    const overflow = bridge.registerSubscription('overflow');
    expect(overflow.ok).toBe(false);
    expect(overflow.reason).toMatch(/quota/i);
  });

  it('refuses oversized payloads (64KB cap)', () => {
    const bridge = new SandboxBridge('plug');
    const big = { data: 'x'.repeat(70_000) };
    expect(bridge.emissionAllowed({ small: 1 })).toBe(true);
    expect(bridge.emissionAllowed(big)).toBe(false);
  });

  it('rejects pending RPCs with PluginDisposedError on dispose', async () => {
    const bridge = new SandboxBridge('plug');
    const pending = new Promise<unknown>((resolve, reject) => {
      bridge.trackRpc('rpc-1', { resolve, reject });
    });
    bridge.dispose();
    await expect(pending).rejects.toBeInstanceOf(PluginDisposedError);
    expect(bridge.isDisposed).toBe(true);
  });

  it('teardown timeout is the documented 100ms', () => {
    expect(TEARDOWN_TIMEOUT_MS).toBe(100);
  });
});
