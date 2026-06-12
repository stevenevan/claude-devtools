import type { SessionConversation } from '@renderer/types/groups';
import type { TabNavigationRequest } from '@renderer/types/tabs';
import type { TriggerColor } from '@shared/constants/triggerColors';

export type NavigationPhase =
  | 'idle' // No navigation in progress
  | 'pending' // Navigation requested, waiting for content
  | 'expanding' // Expanding target group/item
  | 'scrolling' // Scrolling to target
  | 'highlighting' // Showing highlight ring
  | 'complete'; // Navigation done, waiting to clear highlight

export interface UseTabNavigationControllerOptions {
  // Whether this tab instance is currently the active tab
  isActiveTab: boolean;
  // Pending navigation request from tab state (undefined = no request)
  pendingNavigation?: TabNavigationRequest;
  // Conversation data (null while loading)
  conversation: SessionConversation | null;
  // Whether conversation is currently loading
  conversationLoading: boolean;
  // Function to consume (mark as processed) a navigation request
  consumeTabNavigation: (tabId: string, requestId: string) => void;
  // Tab ID for consuming navigation
  tabId: string;
  // Refs to AI group DOM elements
  aiGroupRefs: React.MutableRefObject<Map<string, HTMLElement>>;
  // Refs to individual chat item DOM elements
  chatItemRefs: React.MutableRefObject<Map<string, HTMLElement>>;
  // Refs to individual tool item DOM elements
  toolItemRefs: React.MutableRefObject<Map<string, HTMLElement>>;
  // Function to expand an AI group (per-tab state)
  expandAIGroup: (groupId: string) => void;
  // Ref to scroll container
  scrollContainerRef: React.RefObject<HTMLDivElement | null>;
  // Height of sticky elements at top of scroll container
  stickyOffset?: number;
  // Optional helper to ensure a target group is mounted (e.g., virtualized lists)
  ensureGroupVisible?: (groupId: string) => Promise<void> | void;
  // Function to expand a subagent trace (persists in per-tab state)
  expandSubagentTrace: (subagentId: string) => void;
  // Function to set search query in the search bar
  setSearchQuery: (query: string) => void;
  // Function to select an exact search match by item identity
  selectSearchMatch: (itemId: string, matchIndexInItem: number) => boolean;
  // Highlight duration in ms (default: 3000)
  highlightDuration?: number;
}

export interface UseTabNavigationControllerReturn {
  // Current navigation phase
  phase: NavigationPhase;
  // Currently highlighted group ID
  highlightedGroupId: string | null;
  // Tool use ID to highlight
  highlightToolUseId: string | null;
  // Whether this is a search-based highlight (yellow)
  isSearchHighlight: boolean;
  // Custom highlight color from trigger (undefined = default red)
  highlightColor: TriggerColor | undefined;
  // Whether auto-scroll should be disabled
  shouldDisableAutoScroll: boolean;
  // Set highlighted group (for external control, e.g., turn navigation)
  setHighlightedGroupId: (id: string | null) => void;
  // Handle highlight end (clear highlight)
  handleHighlightEnd: () => void;
}
