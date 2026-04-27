import { describe, it, expect } from 'vitest';

import { alignColumns } from '../../../src/renderer/utils/comparisonAlignment';

const id = (s: string): string => s;

describe('alignColumns', () => {
  it('returns a single column unchanged', () => {
    const result = alignColumns([['a', 'b', 'c']], id);
    expect(result.rows).toHaveLength(3);
    expect(result.rows[0].cells).toEqual(['a']);
  });

  it('matches identical 2-way LCS behaviour on N=2', () => {
    const left = ['a', 'b', 'c', 'd'];
    const right = ['a', 'b', 'c', 'd'];
    const result = alignColumns([left, right], id);
    expect(result.rows).toHaveLength(4);
    expect(result.rows.every((r) => r.isShared)).toBe(true);
    expect(result.divergenceRowIndices).toEqual([]);
  });

  it('flags divergence for N=2 with unique tail items', () => {
    const left = ['a', 'b', 'c'];
    const right = ['a', 'x', 'c'];
    const result = alignColumns([left, right], id);
    // Expect 4 rows: a | b(left only) | x(right only) | c
    expect(result.rows.length).toBeGreaterThanOrEqual(3);
    const shared = result.rows.filter((r) => r.isShared);
    expect(shared.length).toBe(2); // a and c
    expect(result.divergenceRowIndices.length).toBeGreaterThan(0);
  });

  it('aligns three columns with shared prefix', () => {
    const cols = [['a', 'b', 'c'], ['a', 'b', 'd'], ['a', 'b', 'e']];
    const result = alignColumns(cols, id);
    // First two rows are fully shared (a, b).
    expect(result.rows[0].cells).toEqual(['a', 'a', 'a']);
    expect(result.rows[0].isShared).toBe(true);
    expect(result.rows[0].isDivergent).toBe(false);
    expect(result.rows[1].cells).toEqual(['b', 'b', 'b']);
    expect(result.rows[1].isShared).toBe(true);
    // Row for 'c' diverges (columns 1/2 have no match and land as extras).
    const divergentRow = result.rows.find((r) => r.cells[0] === 'c');
    expect(divergentRow?.isDivergent).toBe(true);
  });

  it('handles columns of different lengths', () => {
    const result = alignColumns([['a', 'b'], ['a', 'b', 'c', 'd']], id);
    // After the shared a and b, c and d get tail-appended as divergent rows.
    const tailRows = result.rows.filter((r) => r.cells[0] === null);
    expect(tailRows.length).toBe(2);
    expect(tailRows.every((r) => r.isDivergent)).toBe(true);
  });

  it('returns empty result when given no columns', () => {
    expect(alignColumns<string>([], id)).toEqual({ rows: [], divergenceRowIndices: [] });
  });
});
