

import type { Tab } from './tabs';

export const MAX_PANES = 4;

export interface Pane {

  id: string;

  tabs: Tab[];

  activeTabId: string | null;

  selectedTabIds: string[];

  widthFraction: number;
}

export interface PaneLayout {

  panes: Pane[];

  focusedPaneId: string;
}
