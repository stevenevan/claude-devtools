import type { Session } from '@renderer/types/data';
import type { DateCategory } from '@renderer/types/tabs';

export type VirtualItem =
  | { type: 'header'; category: DateCategory; id: string }
  | { type: 'pinned-header'; id: string }
  | { type: 'session'; session: Session; isPinned: boolean; isHidden: boolean; id: string }
  | { type: 'loader'; id: string };

/**
 * Item height constants for virtual scroll positioning.
 * CRITICAL: These values MUST match the actual rendered heights of components.
 * If SessionItem height changes, update SESSION_HEIGHT here AND add h-[Xpx] to SessionItem.
 * Mismatch causes items to overlap!
 */
export const HEADER_HEIGHT = 28;
export const SESSION_HEIGHT = 48; // Must match h-[48px] in SessionItem.tsx
export const LOADER_HEIGHT = 36;
export const OVERSCAN = 5;
