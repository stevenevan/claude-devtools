import { describe, expect, it } from 'vitest';

import {
  defaultDashboardLayout,
  layoutReduce,
} from '../../../src/renderer/components/dashboard/widgetRegistry';

describe('layoutReduce', () => {
  it('returns defaults on reset', () => {
    const state = { widgetOrder: ['a', 'b'], hiddenWidgets: ['c'] };
    expect(layoutReduce(state, { type: 'reset' })).toEqual(defaultDashboardLayout());
  });

  it('toggles hidden on/off', () => {
    const state = defaultDashboardLayout();
    const hidden = layoutReduce(state, { type: 'toggle-hidden', id: 'a' });
    expect(hidden.hiddenWidgets).toEqual(['a']);
    const restored = layoutReduce(hidden, { type: 'toggle-hidden', id: 'a' });
    expect(restored.hiddenWidgets).toEqual([]);
  });

  it('moves a widget up', () => {
    const state = { widgetOrder: ['a', 'b', 'c'], hiddenWidgets: [] };
    expect(layoutReduce(state, { type: 'move', id: 'c', direction: 'up' })).toEqual({
      widgetOrder: ['a', 'c', 'b'],
      hiddenWidgets: [],
    });
  });

  it('no-ops when moving past the ends', () => {
    const state = { widgetOrder: ['a', 'b'], hiddenWidgets: [] };
    expect(layoutReduce(state, { type: 'move', id: 'a', direction: 'up' })).toEqual(state);
    expect(layoutReduce(state, { type: 'move', id: 'b', direction: 'down' })).toEqual(state);
  });
});
