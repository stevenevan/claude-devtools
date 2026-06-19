const isMacPlatform =
  typeof window !== 'undefined' && window.navigator.userAgent.includes('Macintosh');

const modKey = isMacPlatform ? '⌘' : 'Ctrl+';

const shiftKey = isMacPlatform ? '⇧' : 'Shift+';

export function formatShortcut(key: string, opts?: { shift?: boolean }): string {
  if (opts?.shift) {
    return isMacPlatform ? `${shiftKey}${modKey}${key}` : `${modKey}${shiftKey}${key}`;
  }
  return `${modKey}${key}`;
}

export function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength) + '...';
}

// Useful for branch names where the unique identifier is at the end
// e.g. truncateMiddle("feature/very-long-branch-name-with-ticket-12345", 25) → "feature/ver...ticket-12345"
export function truncateMiddle(text: string, maxLen: number = 25): string {
  if (!text || text.length <= maxLen) return text;

  const availableChars = maxLen - 3;
  const startLen = Math.ceil(availableChars / 2);
  const endLen = Math.floor(availableChars / 2);

  const start = text.slice(0, startLen);
  const end = text.slice(-endLen);

  return `${start}...${end}`;
}
