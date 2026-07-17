import type { SessionDetail } from '@shared/types';

import { call } from '../invoke';

// Flat session data methods (WailsAPI top-level, NOT a slice). W7 wires the
// first real Tauri data command: getSessionDetail. reviveDates: true mirrors the
// Wails adapter (domain/sessions.ts) so the Tauri path returns the same shape.
export const sessionCommands = {
  getSessionDetail: (projectId: string, sessionId: string): Promise<SessionDetail | null> =>
    call<SessionDetail | null>(
      'get_session_detail',
      { projectId, sessionId },
      { reviveDates: true }
    ),
};
