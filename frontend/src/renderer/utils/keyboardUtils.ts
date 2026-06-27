export function isMacOS(): boolean {
  return navigator.userAgent.toLowerCase().includes('mac');
}

function getModifierKeyName(): string {
  return isMacOS() ? 'Cmd' : 'Ctrl';
}

function getModifierKeySymbol(): string {
  return isMacOS() ? '⌘' : 'Ctrl';
}

export function formatModifierShortcut(key: string, useSymbol = true): string {
  const modifier = useSymbol ? getModifierKeySymbol() : getModifierKeyName();
  const separator = useSymbol && isMacOS() ? '' : '+';
  return `${modifier}${separator}${key}`;
}
