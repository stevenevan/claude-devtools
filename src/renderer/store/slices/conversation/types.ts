import type { SearchMatch } from '../../types';
import type { AIGroupExpansionLevel, SessionConversation } from '@renderer/types/groups';

type DetailItemType = 'thinking' | 'text' | 'linked-tool' | 'subagent';

export interface ActiveDetailItem {
  aiGroupId: string;
  itemId: string;
  type: DetailItemType;
}

export interface ConversationSlice {
  aiGroupExpansionLevels: Map<string, AIGroupExpansionLevel>;
  expandedStepIds: Set<string>;
  expandedDisplayItemIds: Map<string, Set<string>>;
  expandedAIGroupIds: Set<string>;

  activeDetailItem: ActiveDetailItem | null;

  searchQuery: string;
  searchVisible: boolean;
  searchResultCount: number;
  currentSearchIndex: number;
  searchMatches: SearchMatch[];
  searchResultsCapped: boolean;
  searchMatchItemIds: Set<string>;
  searchIsRegex: boolean;

  searchExpandedAIGroupIds: Set<string>;
  searchExpandedSubagentIds: Set<string>;
  searchCurrentDisplayItemId: string | null;
  searchCurrentSubagentItemId: string | null;

  setAIGroupExpansion: (aiGroupId: string, level: AIGroupExpansionLevel) => void;
  toggleStepExpansion: (stepId: string) => void;
  toggleDisplayItemExpansion: (aiGroupId: string, itemId: string) => void;
  getExpandedDisplayItemIds: (aiGroupId: string) => Set<string>;
  toggleAIGroupExpansion: (aiGroupId: string) => void;

  showDetailPopover: (aiGroupId: string, itemId: string, type: DetailItemType) => void;
  hideDetailPopover: () => void;

  setSearchQuery: (query: string, conversationOverride?: SessionConversation | null) => void;
  setSearchIsRegex: (isRegex: boolean) => void;
  syncSearchMatchesWithRendered: (
    renderedMatches: { itemId: string; matchIndexInItem: number }[]
  ) => void;
  selectSearchMatch: (itemId: string, matchIndexInItem: number) => boolean;
  showSearch: () => void;
  hideSearch: () => void;
  nextSearchResult: () => void;
  previousSearchResult: () => void;
  expandForCurrentSearchResult: () => void;
}
