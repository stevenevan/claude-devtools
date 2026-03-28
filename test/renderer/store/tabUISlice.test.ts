/**
 * TabUI slice tests — per-tab UI state isolation.
 */

import { describe, expect, it } from 'vitest';

import { createTestStore } from './storeTestUtils';

describe('tabUISlice', () => {
  // =========================================================================
  // Initialization & Cleanup
  // =========================================================================

  describe('initTabUIState', () => {
    it('creates default state for a new tab', () => {
      const store = createTestStore();
      store.getState().initTabUIState('tab1');
      const state = store.getState().tabUIStates.get('tab1');
      expect(state).toBeDefined();
      expect(state!.expandedAIGroupIds.size).toBe(0);
      expect(state!.expandedDisplayItemIds.size).toBe(0);
      expect(state!.expandedSubagentTraceIds.size).toBe(0);
      expect(state!.showContextPanel).toBe(false);
      expect(state!.selectedContextPhase).toBeNull();
      expect(state!.savedScrollTop).toBeUndefined();
      expect(state!.focusedTurnIndex).toBe(-1);
    });

    it('does not overwrite existing state', () => {
      const store = createTestStore();
      store.getState().initTabUIState('tab1');
      store.getState().expandAIGroupForTab('tab1', 'ag1');
      store.getState().initTabUIState('tab1');
      // Should still have the expanded group
      expect(store.getState().isAIGroupExpandedForTab('tab1', 'ag1')).toBe(true);
    });
  });

  describe('cleanupTabUIState', () => {
    it('removes state for a tab', () => {
      const store = createTestStore();
      store.getState().initTabUIState('tab1');
      store.getState().cleanupTabUIState('tab1');
      expect(store.getState().tabUIStates.has('tab1')).toBe(false);
    });

    it('no-ops for non-existent tab', () => {
      const store = createTestStore();
      store.getState().cleanupTabUIState('nonexistent');
      expect(store.getState().tabUIStates.size).toBe(0);
    });
  });

  // =========================================================================
  // AI Group Expansion
  // =========================================================================

  describe('AI group expansion', () => {
    it('toggles group expansion on', () => {
      const store = createTestStore();
      store.getState().initTabUIState('tab1');
      store.getState().toggleAIGroupExpansionForTab('tab1', 'ag1');
      expect(store.getState().isAIGroupExpandedForTab('tab1', 'ag1')).toBe(true);
    });

    it('toggles group expansion off', () => {
      const store = createTestStore();
      store.getState().initTabUIState('tab1');
      store.getState().toggleAIGroupExpansionForTab('tab1', 'ag1');
      store.getState().toggleAIGroupExpansionForTab('tab1', 'ag1');
      expect(store.getState().isAIGroupExpandedForTab('tab1', 'ag1')).toBe(false);
    });

    it('expandAIGroupForTab is idempotent', () => {
      const store = createTestStore();
      store.getState().initTabUIState('tab1');
      store.getState().expandAIGroupForTab('tab1', 'ag1');
      store.getState().expandAIGroupForTab('tab1', 'ag1');
      expect(store.getState().isAIGroupExpandedForTab('tab1', 'ag1')).toBe(true);
    });

    it('isolates state between tabs', () => {
      const store = createTestStore();
      store.getState().initTabUIState('tab1');
      store.getState().initTabUIState('tab2');
      store.getState().expandAIGroupForTab('tab1', 'ag1');
      expect(store.getState().isAIGroupExpandedForTab('tab1', 'ag1')).toBe(true);
      expect(store.getState().isAIGroupExpandedForTab('tab2', 'ag1')).toBe(false);
    });

    it('returns false for uninitialized tab', () => {
      const store = createTestStore();
      expect(store.getState().isAIGroupExpandedForTab('nonexistent', 'ag1')).toBe(false);
    });
  });

  // =========================================================================
  // Display Item Expansion
  // =========================================================================

  describe('display item expansion', () => {
    it('toggles display item on', () => {
      const store = createTestStore();
      store.getState().initTabUIState('tab1');
      store.getState().toggleDisplayItemExpansionForTab('tab1', 'ag1', 'item1');
      const items = store.getState().getExpandedDisplayItemIdsForTab('tab1', 'ag1');
      expect(items.has('item1')).toBe(true);
    });

    it('toggles display item off', () => {
      const store = createTestStore();
      store.getState().initTabUIState('tab1');
      store.getState().toggleDisplayItemExpansionForTab('tab1', 'ag1', 'item1');
      store.getState().toggleDisplayItemExpansionForTab('tab1', 'ag1', 'item1');
      const items = store.getState().getExpandedDisplayItemIdsForTab('tab1', 'ag1');
      expect(items.has('item1')).toBe(false);
    });

    it('expandDisplayItemForTab is idempotent', () => {
      const store = createTestStore();
      store.getState().initTabUIState('tab1');
      store.getState().expandDisplayItemForTab('tab1', 'ag1', 'item1');
      store.getState().expandDisplayItemForTab('tab1', 'ag1', 'item1');
      const items = store.getState().getExpandedDisplayItemIdsForTab('tab1', 'ag1');
      expect(items.size).toBe(1);
    });

    it('returns empty set for uninitialized tab', () => {
      const store = createTestStore();
      const items = store.getState().getExpandedDisplayItemIdsForTab('none', 'ag1');
      expect(items.size).toBe(0);
    });
  });

  // =========================================================================
  // Subagent Trace Expansion
  // =========================================================================

  describe('subagent trace expansion', () => {
    it('toggles subagent trace on', () => {
      const store = createTestStore();
      store.getState().initTabUIState('tab1');
      store.getState().toggleSubagentTraceExpansionForTab('tab1', 'sa1');
      expect(store.getState().isSubagentTraceExpandedForTab('tab1', 'sa1')).toBe(true);
    });

    it('toggles subagent trace off', () => {
      const store = createTestStore();
      store.getState().initTabUIState('tab1');
      store.getState().toggleSubagentTraceExpansionForTab('tab1', 'sa1');
      store.getState().toggleSubagentTraceExpansionForTab('tab1', 'sa1');
      expect(store.getState().isSubagentTraceExpandedForTab('tab1', 'sa1')).toBe(false);
    });

    it('expandSubagentTraceForTab is idempotent', () => {
      const store = createTestStore();
      store.getState().initTabUIState('tab1');
      store.getState().expandSubagentTraceForTab('tab1', 'sa1');
      store.getState().expandSubagentTraceForTab('tab1', 'sa1');
      expect(store.getState().isSubagentTraceExpandedForTab('tab1', 'sa1')).toBe(true);
    });

    it('returns false for uninitialized tab', () => {
      const store = createTestStore();
      expect(store.getState().isSubagentTraceExpandedForTab('none', 'sa1')).toBe(false);
    });
  });

  // =========================================================================
  // Context Panel
  // =========================================================================

  describe('context panel', () => {
    it('sets context panel visible', () => {
      const store = createTestStore();
      store.getState().initTabUIState('tab1');
      store.getState().setContextPanelVisibleForTab('tab1', true);
      expect(store.getState().isContextPanelVisibleForTab('tab1')).toBe(true);
    });

    it('sets context panel hidden', () => {
      const store = createTestStore();
      store.getState().initTabUIState('tab1');
      store.getState().setContextPanelVisibleForTab('tab1', true);
      store.getState().setContextPanelVisibleForTab('tab1', false);
      expect(store.getState().isContextPanelVisibleForTab('tab1')).toBe(false);
    });

    it('returns false for uninitialized tab', () => {
      const store = createTestStore();
      expect(store.getState().isContextPanelVisibleForTab('none')).toBe(false);
    });
  });

  // =========================================================================
  // Context Phase Selection
  // =========================================================================

  describe('context phase selection', () => {
    it('sets selected phase', () => {
      const store = createTestStore();
      store.getState().initTabUIState('tab1');
      store.getState().setSelectedContextPhaseForTab('tab1', 2);
      const state = store.getState().tabUIStates.get('tab1');
      expect(state!.selectedContextPhase).toBe(2);
    });

    it('clears selected phase with null', () => {
      const store = createTestStore();
      store.getState().initTabUIState('tab1');
      store.getState().setSelectedContextPhaseForTab('tab1', 2);
      store.getState().setSelectedContextPhaseForTab('tab1', null);
      const state = store.getState().tabUIStates.get('tab1');
      expect(state!.selectedContextPhase).toBeNull();
    });
  });

  // =========================================================================
  // Scroll Position
  // =========================================================================

  describe('scroll position', () => {
    it('saves and retrieves scroll position', () => {
      const store = createTestStore();
      store.getState().initTabUIState('tab1');
      store.getState().saveScrollPositionForTab('tab1', 500);
      expect(store.getState().getScrollPositionForTab('tab1')).toBe(500);
    });

    it('returns undefined for uninitialized tab', () => {
      const store = createTestStore();
      expect(store.getState().getScrollPositionForTab('none')).toBeUndefined();
    });
  });

  // =========================================================================
  // Turn Navigation
  // =========================================================================

  describe('turn navigation', () => {
    it('sets focused turn index', () => {
      const store = createTestStore();
      store.getState().initTabUIState('tab1');
      store.getState().setFocusedTurnIndexForTab('tab1', 3);
      expect(store.getState().getFocusedTurnIndexForTab('tab1')).toBe(3);
    });

    it('returns -1 for uninitialized tab', () => {
      const store = createTestStore();
      expect(store.getState().getFocusedTurnIndexForTab('none')).toBe(-1);
    });
  });
});
