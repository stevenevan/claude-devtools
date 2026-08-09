import type { UIMode } from '@shared/types';

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
  {
    id: 'mode',
    title: 'Choose your interface',
    body: 'Simple keeps everyday tools prominent. Nerd keeps every workspace control visible. You can switch modes later in General Settings.',
  },
];

export type TourPhase = 'inactive' | 'running' | 'done';

export interface TourState {
  phase: TourPhase;
  index: number;
  selectedMode: UIMode | null;
}

export type TourAction =
  | { type: 'start' }
  | { type: 'next' }
  | { type: 'prev' }
  | { type: 'selectMode'; mode: UIMode }
  | { type: 'skip' }
  | { type: 'restart' }
  | { type: 'finish' };

export const initialTourState: TourState = {
  phase: 'inactive',
  index: 0,
  selectedMode: null,
};

export function tourReducer(state: TourState, action: TourAction): TourState {
  switch (action.type) {
    case 'start':
    case 'restart':
      return { phase: 'running', index: 0, selectedMode: null };
    case 'next': {
      if (state.phase !== 'running') return state;
      const nextIndex = state.index + 1;
      if (nextIndex >= TOUR_STEPS.length) return state;
      return { ...state, index: nextIndex };
    }
    case 'prev':
      if (state.phase !== 'running') return state;
      return { ...state, index: Math.max(0, state.index - 1) };
    case 'selectMode':
      if (state.phase !== 'running') return state;
      return { ...state, selectedMode: action.mode };
    case 'skip':
      return { phase: 'done', index: state.index, selectedMode: 'nerd' };
    case 'finish':
      if (!state.selectedMode) return state;
      return { ...state, phase: 'done' };
    default:
      return state;
  }
}
