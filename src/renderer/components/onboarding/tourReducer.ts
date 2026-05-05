/**
 * Onboarding tour state reducer (sprint 49). Pure logic split from the
 * UI so it can be unit-tested.
 */

export interface TourStep {
  id: string;
  title: string;
  body: string;
}

export const TOUR_STEPS: readonly TourStep[] = [
  {
    id: 'projects',
    title: 'Project scan',
    body: 'claude-devtools watches ~/.claude/projects/ and groups every JSONL session by project. The sidebar lists them in recent-first order.',
  },
  {
    id: 'sessions',
    title: 'Sessions list',
    body: 'Click a session to open it in the active tab. Cmd-click opens it in a new tab. Right-click for pin, hide, snapshot, and other actions.',
  },
  {
    id: 'minimap',
    title: 'Minimap & timeline',
    body: 'The right-side minimap is a navigable density map of the conversation. Drag the scrubber or scroll the chat to keep them in sync.',
  },
  {
    id: 'dashboard',
    title: 'Dashboard',
    body: 'Cmd+T opens the dashboard. Forecast, productivity, model comparison, and snapshots all live there; right-click a card to hide it.',
  },
  {
    id: 'settings',
    title: 'Settings & shortcuts',
    body: 'Cmd+, opens settings. Customise themes, plugins, notification rules, and keyboard shortcuts. The Help panel (?) replays this tour anytime.',
  },
];

export type TourPhase = 'inactive' | 'running' | 'done';

export interface TourState {
  phase: TourPhase;
  index: number;
}

export type TourAction =
  | { type: 'start' }
  | { type: 'next' }
  | { type: 'prev' }
  | { type: 'skip' }
  | { type: 'restart' }
  | { type: 'finish' };

export const initialTourState: TourState = { phase: 'inactive', index: 0 };

export function tourReducer(state: TourState, action: TourAction): TourState {
  switch (action.type) {
    case 'start':
    case 'restart':
      return { phase: 'running', index: 0 };
    case 'next': {
      if (state.phase !== 'running') return state;
      const nextIndex = state.index + 1;
      if (nextIndex >= TOUR_STEPS.length) {
        return { phase: 'done', index: TOUR_STEPS.length - 1 };
      }
      return { phase: 'running', index: nextIndex };
    }
    case 'prev':
      if (state.phase !== 'running') return state;
      return { phase: 'running', index: Math.max(0, state.index - 1) };
    case 'skip':
    case 'finish':
      return { phase: 'done', index: state.index };
    default:
      return state;
  }
}
