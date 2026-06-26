const STYLE_TAG_ID = 'custom-theme-overrides';

export interface ThemeTokenGroup {
  label: string;
  tokens: { name: string; description?: string }[];
}

export const THEME_TOKEN_GROUPS: ThemeTokenGroup[] = [
  {
    label: 'Surface',
    tokens: [
      { name: 'background', description: 'Page background' },
      { name: 'foreground', description: 'Primary text' },
      { name: 'card', description: 'Card surface' },
      { name: 'card-foreground', description: 'Card text' },
      { name: 'popover', description: 'Popover surface' },
      { name: 'popover-foreground', description: 'Popover text' },
    ],
  },
  {
    label: 'Brand',
    tokens: [
      { name: 'primary', description: 'Primary action' },
      { name: 'primary-foreground', description: 'Primary action text' },
      { name: 'secondary', description: 'Secondary action' },
      { name: 'secondary-foreground', description: 'Secondary action text' },
      { name: 'accent', description: 'Accent surface' },
      { name: 'accent-foreground', description: 'Accent text' },
    ],
  },
  {
    label: 'Muted & Borders',
    tokens: [
      { name: 'muted', description: 'Muted surface' },
      { name: 'muted-foreground', description: 'Muted text' },
      { name: 'border', description: 'Default border' },
      { name: 'input', description: 'Input border' },
      { name: 'ring', description: 'Focus ring' },
      { name: 'destructive', description: 'Destructive action' },
    ],
  },
  {
    label: 'Sidebar',
    tokens: [
      { name: 'sidebar', description: 'Sidebar surface' },
      { name: 'sidebar-foreground', description: 'Sidebar text' },
      { name: 'sidebar-primary', description: 'Sidebar accent' },
      { name: 'sidebar-accent', description: 'Sidebar hover' },
      { name: 'sidebar-border', description: 'Sidebar border' },
    ],
  },
];

export const ALL_THEME_TOKENS: string[] = THEME_TOKEN_GROUPS.flatMap((g) =>
  g.tokens.map((t) => t.name)
);

export function applyTheme(overrides: Record<string, string>): void {
  if (typeof document === 'undefined') return;
  let style = document.getElementById(STYLE_TAG_ID) as HTMLStyleElement | null;
  if (!style) {
    style = document.createElement('style');
    style.id = STYLE_TAG_ID;
    document.head.appendChild(style);
  }
  const decls = Object.entries(overrides)
    .filter(([k, v]) => k.length > 0 && v.length > 0)
    .map(([k, v]) => `  --${k}: ${v};`)
    .join('\n');
  style.textContent = decls.length > 0 ? `:root {\n${decls}\n}` : '';
}

export function revertTheme(): void {
  if (typeof document === 'undefined') return;
  const style = document.getElementById(STYLE_TAG_ID);
  if (style?.parentNode) {
    style.parentNode.removeChild(style);
  }
}

export function readComputedToken(name: string): string {
  if (typeof document === 'undefined') return '';
  return getComputedStyle(document.documentElement).getPropertyValue(`--${name}`).trim();
}

export function isValidColor(value: string): boolean {
  if (typeof document === 'undefined') return value.length > 0;
  const probe = document.createElement('div');
  probe.style.color = '';
  probe.style.color = value;
  return probe.style.color.length > 0;
}
