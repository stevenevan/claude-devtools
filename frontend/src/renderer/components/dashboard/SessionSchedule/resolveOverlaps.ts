import type { PositionedEvent } from './types';

export function resolveOverlaps(events: PositionedEvent[]): PositionedEvent[] {
  if (events.length <= 1) return events;
  const sorted = [...events].sort((a, b) => a.top - b.top);
  const columns: PositionedEvent[][] = [];

  for (const evt of sorted) {
    let placed = false;
    for (let col = 0; col < columns.length; col++) {
      const lastInCol = columns[col][columns[col].length - 1];
      if (lastInCol.top + lastInCol.height <= evt.top) {
        evt.column = col;
        columns[col].push(evt);
        placed = true;
        break;
      }
    }
    if (!placed) {
      evt.column = columns.length;
      columns.push([evt]);
    }
  }

  const totalCols = columns.length;
  for (const col of columns) {
    for (const evt of col) {
      evt.width = 100 / totalCols;
      evt.left = evt.column * (100 / totalCols);
    }
  }
  return sorted;
}
