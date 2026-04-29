import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  __resetForTests,
  parseFilterPayload,
  parseFilterPresetEntry,
} from '@renderer/utils/filterPresetSerialization';

beforeEach(() => {
  __resetForTests();
});

describe('parseFilterPayload', () => {
  it('round-trips all 7 SessionFilterState fields including non-empty tags', () => {
    const input = {
      dateMin: 1000,
      dateMax: 2000,
      minContext: 5000,
      maxContext: 100000,
      minCompactions: 2,
      agentName: 'researcher',
      tags: ['rust', 'frontend'],
    };
    expect(parseFilterPayload(input)).toEqual(input);
  });

  it('drops unknown keys silently', () => {
    const input = { dateMin: 100, randomKey: 'ignored', tags: ['a'] };
    expect(parseFilterPayload(input)).toEqual({ dateMin: 100, tags: ['a'] });
  });

  it('returns null for non-object payload and warns once', () => {
    expect(parseFilterPayload('bogus')).toBeNull();
    expect(parseFilterPayload(null)).toBeNull();
    expect(parseFilterPayload([1, 2])).toBeNull();
    const warnMock = vi.mocked(console.warn);
    expect(warnMock).toHaveBeenCalledTimes(1);
    warnMock.mockClear();
  });

  it('coerces malformed types to undefined rather than partial application', () => {
    const input = {
      dateMin: 'not-a-number',
      tags: [1, 2, 'real'],
      agentName: '',
      minContext: NaN,
    };
    expect(parseFilterPayload(input)).toEqual({ tags: ['real'] });
  });

  it('drops empty tags array', () => {
    expect(parseFilterPayload({ tags: [] })).toEqual({});
  });
});

describe('parseFilterPresetEntry', () => {
  it('parses a complete preset', () => {
    const raw = {
      id: 'p1',
      name: 'Recent Rust',
      filter: { agentName: 'rust', tags: ['rust'] },
      createdAt: 1234567890,
    };
    expect(parseFilterPresetEntry(raw)).toEqual(raw);
  });

  it('returns null when required fields missing', () => {
    expect(parseFilterPresetEntry({ name: 'x', createdAt: 0, filter: {} })).toBeNull();
    expect(parseFilterPresetEntry({ id: 'p', createdAt: 0, filter: {} })).toBeNull();
    expect(parseFilterPresetEntry({ id: 'p', name: 'x', filter: {} })).toBeNull();
  });

  it('returns null when filter payload is invalid', () => {
    const raw = { id: 'p', name: 'x', filter: 'bad', createdAt: 0 };
    expect(parseFilterPresetEntry(raw)).toBeNull();
    vi.mocked(console.warn).mockClear();
  });
});
