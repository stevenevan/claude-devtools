import type { Session } from '@renderer/types/data';
import type { DateCategory } from '@renderer/types/tabs';

export type VirtualItem =
  | { type: 'header'; category: DateCategory; id: string }
  | { type: 'pinned-header'; id: string }
  | { type: 'session'; session: Session; isPinned: boolean; isHidden: boolean; id: string }
  | { type: 'loader'; id: string };

export const HEADER_HEIGHT = 28;
export const SESSION_HEIGHT = 48; // Must match h-[48px] in SessionItem.tsx
export const LOADER_HEIGHT = 36;
export const OVERSCAN = 5;
