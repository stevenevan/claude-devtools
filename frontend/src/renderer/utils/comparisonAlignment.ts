

export type SignatureFn<T> = (item: T) => string;

export interface AlignmentRow<T> {

  cells: (T | null)[];

  isShared: boolean;

  isDivergent: boolean;
}

export interface AlignmentResult<T> {
  rows: AlignmentRow<T>[];

  divergenceRowIndices: number[];
}

function lcsIndexMap<T>(base: T[], other: T[], sig: SignatureFn<T>): number[] {
  const m = base.length;
  const n = other.length;
  if (m === 0 || n === 0) return new Array<number>(m).fill(-1);

  const baseSigs = base.map(sig);
  const otherSigs = other.map(sig);

  const table: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      if (baseSigs[i] === otherSigs[j]) {
        table[i][j] = table[i + 1][j + 1] + 1;
      } else {
        table[i][j] = Math.max(table[i + 1][j], table[i][j + 1]);
      }
    }
  }

  const mapping = new Array<number>(m).fill(-1);
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (baseSigs[i] === otherSigs[j]) {
      mapping[i] = j;
      i++;
      j++;
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      i++;
    } else {
      j++;
    }
  }
  return mapping;
}

export function alignColumns<T>(columns: T[][], sig: SignatureFn<T>): AlignmentResult<T> {
  if (columns.length === 0) {
    return { rows: [], divergenceRowIndices: [] };
  }
  if (columns.length === 1) {
    const rows: AlignmentRow<T>[] = columns[0].map((c) => ({
      cells: [c],
      isShared: false,
      isDivergent: false,
    }));
    return { rows, divergenceRowIndices: [] };
  }

  const base = columns[0];
  const others = columns.slice(1);
  const mappings = others.map((other) => lcsIndexMap(base, other, sig));

  const rows: AlignmentRow<T>[] = [];
  const divergenceRowIndices: number[] = [];

  // Track consumed indices per column so unmatched items can be appended
  // between matched rows.
  const consumed = others.map(() => 0);

  for (let i = 0; i < base.length; i++) {
    // First: emit standalone rows for each other column's unmatched items
    // that appear before their next LCS match.
    for (let oi = 0; oi < others.length; oi++) {
      const otherColumn = others[oi];
      const map = mappings[oi];
      const nextMatchIdx = map[i];
      const stopAt = nextMatchIdx === -1 ? consumed[oi] : nextMatchIdx;
      while (consumed[oi] < stopAt) {
        const cells = new Array<T | null>(columns.length).fill(null);
        cells[oi + 1] = otherColumn[consumed[oi]];
        rows.push({ cells, isShared: false, isDivergent: true });
        divergenceRowIndices.push(rows.length - 1);
        consumed[oi]++;
      }
    }

    // Now the shared/divergent row for base[i]
    const cells = new Array<T | null>(columns.length).fill(null);
    cells[0] = base[i];
    let divergent = false;
    for (let oi = 0; oi < others.length; oi++) {
      const matchIdx = mappings[oi][i];
      if (matchIdx === -1) {
        divergent = true;
        continue;
      }
      cells[oi + 1] = others[oi][matchIdx];
      consumed[oi] = matchIdx + 1;
    }
    rows.push({
      cells,
      isShared: cells.filter((c) => c !== null).length > 1,
      isDivergent: divergent,
    });
    if (divergent) divergenceRowIndices.push(rows.length - 1);
  }

  // Append any trailing unmatched items for each other column.
  for (let oi = 0; oi < others.length; oi++) {
    const otherColumn = others[oi];
    while (consumed[oi] < otherColumn.length) {
      const cells = new Array<T | null>(columns.length).fill(null);
      cells[oi + 1] = otherColumn[consumed[oi]];
      rows.push({ cells, isShared: false, isDivergent: true });
      divergenceRowIndices.push(rows.length - 1);
      consumed[oi]++;
    }
  }

  return { rows, divergenceRowIndices };
}
