const isMac =
  typeof navigator !== 'undefined' && navigator.platform.includes('Mac');
const mod = isMac ? '⌘' : 'Ctrl';

export interface ShortcutDefinition {
  id: string;
  category: 'Navigation' | 'Tabs' | 'Panes' | 'Session' | 'Workspace';
  label: string;
  defaultBinding: string;
}

export const SHORTCUT_DEFINITIONS: ShortcutDefinition[] = [
  {
    id: 'open-command-palette',
    category: 'Navigation',
    label: 'Open command palette',
    defaultBinding: `${mod}+K`,
  },
  {
    id: 'advanced-search',
    category: 'Navigation',
    label: 'Advanced search',
    defaultBinding: `${mod}+Shift+F`,
  },
  {
    id: 'open-settings',
    category: 'Navigation',
    label: 'Open settings',
    defaultBinding: `${mod}+,`,
  },
  {
    id: 'toggle-sidebar',
    category: 'Navigation',
    label: 'Toggle sidebar',
    defaultBinding: `${mod}+B`,
  },
  {
    id: 'shortcut-cheatsheet',
    category: 'Navigation',
    label: 'Show shortcut cheat sheet',
    defaultBinding: '?',
  },
  {
    id: 'next-turn',
    category: 'Session',
    label: 'Next AI turn',
    defaultBinding: 'J',
  },
  {
    id: 'previous-turn',
    category: 'Session',
    label: 'Previous AI turn',
    defaultBinding: 'K',
  },
  {
    id: 'find-in-session',
    category: 'Session',
    label: 'Find in session',
    defaultBinding: `${mod}+F`,
  },
  {
    id: 'refresh-session',
    category: 'Session',
    label: 'Refresh session',
    defaultBinding: `${mod}+R`,
  },
  {
    id: 'next-tab',
    category: 'Tabs',
    label: 'Next tab',
    defaultBinding: 'Ctrl+Tab',
  },
  {
    id: 'previous-tab',
    category: 'Tabs',
    label: 'Previous tab',
    defaultBinding: 'Ctrl+Shift+Tab',
  },
  {
    id: 'close-tab',
    category: 'Tabs',
    label: 'Close tab',
    defaultBinding: `${mod}+W`,
  },
  {
    id: 'close-all-tabs',
    category: 'Tabs',
    label: 'Close all tabs',
    defaultBinding: `${mod}+Shift+W`,
  },
  {
    id: 'new-tab',
    category: 'Tabs',
    label: 'New tab',
    defaultBinding: `${mod}+T`,
  },
  {
    id: 'split-pane-right',
    category: 'Panes',
    label: 'Split pane right',
    defaultBinding: `${mod}+\\`,
  },
  {
    id: 'close-pane',
    category: 'Panes',
    label: 'Close pane',
    defaultBinding: `${mod}+Opt+W`,
  },
  {
    id: 'focus-pane',
    category: 'Panes',
    label: 'Focus pane 1–4',
    defaultBinding: `${mod}+Opt+1-4`,
  },
  {
    id: 'next-context',
    category: 'Workspace',
    label: 'Cycle workspace context',
    defaultBinding: `${mod}+Shift+K`,
  },
];

export const SHORTCUT_CATEGORIES: ShortcutDefinition['category'][] = [
  'Navigation',
  'Tabs',
  'Session',
  'Panes',
  'Workspace',
];
