import { describe, expect, it } from 'vitest';

import { reviveDates } from '@renderer/api/reviveDates';

describe('reviveDates', () => {
  it('converts ISO string with Z suffix to Date', () => {
    const out = reviveDates('2024-01-15T10:30:00.000Z');
    expect(out).toBeInstanceOf(Date);
    expect((out as unknown as Date).toISOString()).toBe('2024-01-15T10:30:00.000Z');
  });

  it('converts ISO string with timezone offset to Date', () => {
    const out = reviveDates('2024-01-15T10:30:00+02:00');
    expect(out).toBeInstanceOf(Date);
  });

  it('converts bare ISO timestamp (no fractional seconds, no zone) to Date', () => {
    const out = reviveDates('2024-01-15T10:30:00');
    expect(out).toBeInstanceOf(Date);
  });

  it('leaves non-ISO strings untouched', () => {
    expect(reviveDates('hello world')).toBe('hello world');
    expect(reviveDates('2024-01-15')).toBe('2024-01-15');
    expect(reviveDates('not a date')).toBe('not a date');
  });

  it('passes through null and undefined', () => {
    expect(reviveDates(null)).toBeNull();
    expect(reviveDates(undefined)).toBeUndefined();
  });

  it('passes through numbers and booleans untouched', () => {
    expect(reviveDates(42)).toBe(42);
    expect(reviveDates(true)).toBe(true);
    expect(reviveDates(false)).toBe(false);
  });

  it('recursively converts dates inside nested objects', () => {
    const input = {
      id: 'abc',
      createdAt: '2024-01-15T10:30:00.000Z',
      nested: { updatedAt: '2024-02-20T08:00:00.000Z', label: 'plain' },
    };
    const out = reviveDates(input);
    expect(out.createdAt).toBeInstanceOf(Date);
    expect(out.nested.updatedAt).toBeInstanceOf(Date);
    expect(out.nested.label).toBe('plain');
    expect(out.id).toBe('abc');
  });

  it('recursively converts dates inside arrays', () => {
    const input = ['plain', '2024-01-15T10:30:00.000Z', { ts: '2024-02-20T08:00:00.000Z' }];
    const out = reviveDates(input);
    expect(out[0]).toBe('plain');
    expect(out[1]).toBeInstanceOf(Date);
    expect((out[2] as { ts: Date }).ts).toBeInstanceOf(Date);
  });

  it('rejects strings that pass the regex but parse to NaN', () => {
    const out = reviveDates('2024-13-45T99:99:99Z');
    expect(out).toBe('2024-13-45T99:99:99Z');
  });
});
