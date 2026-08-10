import { describe, expect, test } from 'bun:test';

import {
  getAgentCapability,
  getAgentCapabilityLabel,
  isValidAgentName,
} from './agentCapability';

describe('agent capabilities', () => {
  test('recognizes read-only, mutation, and command tools', () => {
    expect(getAgentCapability('Read, Glob, Grep')).toBe('read-only');
    expect(getAgentCapability('Read, Write')).toBe('read-and-change');
    expect(getAgentCapability('Read, Bash')).toBe('runs-commands');
    expect(getAgentCapability('*')).toBe('runs-commands');
  });

  test('handles empty and unknown permissions conservatively', () => {
    expect(getAgentCapability('')).toBe('read-and-change');
    expect(getAgentCapability('Read, Unknown')).toBe('read-and-change');
    expect(getAgentCapabilityLabel('Read, Grep')).toBe('Can read information');
  });

  test('validates the filename rule', () => {
    expect(isValidAgentName('research-helper')).toBe(true);
    expect(isValidAgentName('helper2')).toBe(true);
    expect(isValidAgentName('Research Helper')).toBe(false);
    expect(isValidAgentName('helper_2')).toBe(false);
  });
});
