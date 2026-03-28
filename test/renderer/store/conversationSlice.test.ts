/**
 * Conversation slice tests — expansion states, search, detail popover.
 */

import { describe, expect, it } from 'vitest';

import { createTestStore } from './storeTestUtils';

describe('conversationSlice', () => {
  // =========================================================================
  // Expansion States
  // =========================================================================

  describe('AI group expansion levels', () => {
    it('sets expansion level for a group', () => {
      const store = createTestStore();
      store.getState().setAIGroupExpansion('ag1', 'full');
      expect(store.getState().aiGroupExpansionLevels.get('ag1')).toBe('full');
    });

    it('updates expansion level', () => {
      const store = createTestStore();
      store.getState().setAIGroupExpansion('ag1', 'full');
      store.getState().setAIGroupExpansion('ag1', 'collapsed');
      expect(store.getState().aiGroupExpansionLevels.get('ag1')).toBe('collapsed');
    });

    it('handles multiple groups independently', () => {
      const store = createTestStore();
      store.getState().setAIGroupExpansion('ag1', 'full');
      store.getState().setAIGroupExpansion('ag2', 'items');
      expect(store.getState().aiGroupExpansionLevels.get('ag1')).toBe('full');
      expect(store.getState().aiGroupExpansionLevels.get('ag2')).toBe('items');
    });
  });

  describe('step expansion', () => {
    it('toggles step expansion on', () => {
      const store = createTestStore();
      store.getState().toggleStepExpansion('step1');
      expect(store.getState().expandedStepIds.has('step1')).toBe(true);
    });

    it('toggles step expansion off', () => {
      const store = createTestStore();
      store.getState().toggleStepExpansion('step1');
      store.getState().toggleStepExpansion('step1');
      expect(store.getState().expandedStepIds.has('step1')).toBe(false);
    });
  });

  describe('display item expansion', () => {
    it('toggles display item on', () => {
      const store = createTestStore();
      store.getState().toggleDisplayItemExpansion('ag1', 'item1');
      const items = store.getState().getExpandedDisplayItemIds('ag1');
      expect(items.has('item1')).toBe(true);
    });

    it('toggles display item off', () => {
      const store = createTestStore();
      store.getState().toggleDisplayItemExpansion('ag1', 'item1');
      store.getState().toggleDisplayItemExpansion('ag1', 'item1');
      const items = store.getState().getExpandedDisplayItemIds('ag1');
      expect(items.has('item1')).toBe(false);
    });

    it('returns empty set for unknown group', () => {
      const store = createTestStore();
      const items = store.getState().getExpandedDisplayItemIds('nonexistent');
      expect(items.size).toBe(0);
    });
  });

  describe('AI group expansion (toggle)', () => {
    it('toggles group on', () => {
      const store = createTestStore();
      store.getState().toggleAIGroupExpansion('ag1');
      expect(store.getState().expandedAIGroupIds.has('ag1')).toBe(true);
    });

    it('toggles group off', () => {
      const store = createTestStore();
      store.getState().toggleAIGroupExpansion('ag1');
      store.getState().toggleAIGroupExpansion('ag1');
      expect(store.getState().expandedAIGroupIds.has('ag1')).toBe(false);
    });
  });

  // =========================================================================
  // Detail Popover
  // =========================================================================

  describe('detail popover', () => {
    it('shows detail popover', () => {
      const store = createTestStore();
      store.getState().showDetailPopover('ag1', 'item1', 'thinking');
      const detail = store.getState().activeDetailItem;
      expect(detail).toEqual({
        aiGroupId: 'ag1',
        itemId: 'item1',
        type: 'thinking',
      });
    });

    it('hides detail popover', () => {
      const store = createTestStore();
      store.getState().showDetailPopover('ag1', 'item1', 'text');
      store.getState().hideDetailPopover();
      expect(store.getState().activeDetailItem).toBeNull();
    });

    it('replaces existing popover', () => {
      const store = createTestStore();
      store.getState().showDetailPopover('ag1', 'item1', 'thinking');
      store.getState().showDetailPopover('ag2', 'item2', 'linked-tool');
      expect(store.getState().activeDetailItem!.aiGroupId).toBe('ag2');
      expect(store.getState().activeDetailItem!.type).toBe('linked-tool');
    });
  });

  // =========================================================================
  // Search
  // =========================================================================

  describe('search', () => {
    it('starts with empty search state', () => {
      const store = createTestStore();
      const state = store.getState();
      expect(state.searchQuery).toBe('');
      expect(state.searchVisible).toBe(false);
      expect(state.searchResultCount).toBe(0);
      expect(state.currentSearchIndex).toBe(-1);
      expect(state.searchMatches).toEqual([]);
      expect(state.searchResultsCapped).toBe(false);
    });

    it('showSearch sets visible', () => {
      const store = createTestStore();
      store.getState().showSearch();
      expect(store.getState().searchVisible).toBe(true);
    });

    it('hideSearch resets all search state', () => {
      const store = createTestStore();
      store.getState().showSearch();
      store.getState().hideSearch();
      const state = store.getState();
      expect(state.searchVisible).toBe(false);
      expect(state.searchQuery).toBe('');
      expect(state.searchResultCount).toBe(0);
      expect(state.currentSearchIndex).toBe(-1);
      expect(state.searchMatches).toEqual([]);
      expect(state.searchMatchItemIds.size).toBe(0);
      expect(state.searchExpandedAIGroupIds.size).toBe(0);
      expect(state.searchExpandedSubagentIds.size).toBe(0);
    });

    it('setSearchQuery with empty query clears results', () => {
      const store = createTestStore();
      store.getState().setSearchQuery('');
      expect(store.getState().searchResultCount).toBe(0);
      expect(store.getState().currentSearchIndex).toBe(-1);
    });

    it('setSearchQuery with whitespace-only clears results', () => {
      const store = createTestStore();
      store.getState().setSearchQuery('   ');
      expect(store.getState().searchResultCount).toBe(0);
    });

    it('nextSearchResult wraps around', () => {
      const store = createTestStore();
      // Manually set up search state
      store.setState({
        searchResultCount: 3,
        currentSearchIndex: 2,
        searchMatches: [
          { itemId: 'i1', itemType: 'user', matchIndexInItem: 0, globalIndex: 0 },
          { itemId: 'i2', itemType: 'ai', matchIndexInItem: 0, globalIndex: 1 },
          { itemId: 'i3', itemType: 'user', matchIndexInItem: 0, globalIndex: 2 },
        ],
      });
      store.getState().nextSearchResult();
      expect(store.getState().currentSearchIndex).toBe(0); // wrapped
    });

    it('previousSearchResult wraps around', () => {
      const store = createTestStore();
      store.setState({
        searchResultCount: 3,
        currentSearchIndex: 0,
        searchMatches: [
          { itemId: 'i1', itemType: 'user', matchIndexInItem: 0, globalIndex: 0 },
          { itemId: 'i2', itemType: 'ai', matchIndexInItem: 0, globalIndex: 1 },
          { itemId: 'i3', itemType: 'user', matchIndexInItem: 0, globalIndex: 2 },
        ],
      });
      store.getState().previousSearchResult();
      expect(store.getState().currentSearchIndex).toBe(2); // wrapped
    });

    it('nextSearchResult no-ops with zero results', () => {
      const store = createTestStore();
      store.getState().nextSearchResult();
      expect(store.getState().currentSearchIndex).toBe(-1);
    });

    it('previousSearchResult no-ops with zero results', () => {
      const store = createTestStore();
      store.getState().previousSearchResult();
      expect(store.getState().currentSearchIndex).toBe(-1);
    });
  });
});
