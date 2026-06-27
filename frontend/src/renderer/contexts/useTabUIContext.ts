

import { useContext } from 'react';

import { TabUIContext } from './TabUIContext';

export function useTabIdOptional(): string | null {
  const context = useContext(TabUIContext);
  return context?.tabId ?? null;
}
