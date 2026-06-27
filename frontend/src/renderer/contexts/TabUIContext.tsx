import type { JSX } from 'react';

import { createContext, type ReactNode } from 'react';

// Context Definition

interface TabUIContextValue {

  tabId: string;
}

const TabUIContext = createContext<TabUIContextValue | null>(null);

export { TabUIContext };

// Provider Component

interface TabUIProviderProps {

  tabId: string;
  children: ReactNode;
}

export const TabUIProvider = ({ tabId, children }: TabUIProviderProps): JSX.Element => {
  return <TabUIContext.Provider value={{ tabId }}>{children}</TabUIContext.Provider>;
};
