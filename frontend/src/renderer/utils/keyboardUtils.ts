export function isMacOS(): boolean {
  return navigator.userAgent.toLowerCase().includes('mac');
}

export function getModifierKeyName(): string {
  return isMacOS() ? 'Cmd' : 'Ctrl';
}

export function getModifierKeySymbol(): string {
  return isMacOS() ? '⌘' : 'Ctrl';
}

export function formatModifierShortcut(key: string, useSymbol = true): string {
  const modifier = useSymbol ? getModifierKeySymbol() : getModifierKeyName();
  const separator = useSymbol && isMacOS() ? '' : '+';
  return `${modifier}${separator}${key}`;
}
