export function formatFirstSeen(groupId: string): string {
  const turnIndex = parseTurnIndex(groupId);
  if (turnIndex < 0) return groupId;
  return `Turn ${turnIndex + 1}`;
}

export function parseTurnIndex(groupId: string): number {
  const match = /^ai-(\d+)$/.exec(groupId);
  if (!match) return -1;
  return parseInt(match[1], 10);
}
