import type { GlobalSession } from '@shared/types';

export type ConversationGroup = {
  id: string;
  label: string;
  folderName: string;
  projectPath: string;
  sessions: GlobalSession[];
  newestCreatedAt: number;
};

export type FlattenedConversationListItem =
  | { type: 'heading'; id: string; label: string }
  | { type: 'conversation'; id: string; session: GlobalSession };

export type ConversationListItem =
  | FlattenedConversationListItem
  | { type: 'end-sentinel'; id: 'conversation-feed-end' };

function pathSegments(path: string): string[] {
  return path.split(/[\\/]+/).filter(Boolean);
}

function folderName(session: GlobalSession): string {
  const name = session.projectName.trim();
  if (name && !name.includes('/') && !name.includes('\\')) return name;

  const segments = pathSegments(session.projectPath);
  return segments[segments.length - 1] ?? 'Untitled folder';
}

function parentSegments(projectPath: string): string[] {
  return pathSegments(projectPath).slice(0, -1).reverse();
}

function compareSessions(left: GlobalSession, right: GlobalSession): number {
  return (
    right.createdAt - left.createdAt ||
    left.projectId.localeCompare(right.projectId) ||
    left.id.localeCompare(right.id)
  );
}

function findDisambiguatingParent(
  group: ConversationGroup,
  sameNamedGroups: readonly ConversationGroup[]
): string {
  const parents = parentSegments(group.projectPath);

  for (const parent of parents) {
    const isUnique = sameNamedGroups.every(
      (other) => other.id === group.id || !parentSegments(other.projectPath).includes(parent)
    );
    if (isUnique) return parent;
  }

  return parents[0] ?? 'other folder';
}

export function groupConversations(
  sessions: readonly GlobalSession[]
): ConversationGroup[] {
  const groups = new Map<string, ConversationGroup>();

  for (const session of sessions) {
    const existing = groups.get(session.projectId);
    if (existing) {
      existing.sessions.push(session);
      continue;
    }

    const name = folderName(session);
    groups.set(session.projectId, {
      id: session.projectId,
      label: name,
      folderName: name,
      projectPath: session.projectPath,
      sessions: [session],
      newestCreatedAt: session.createdAt,
    });
  }

  return [...groups.values()];
}

export function sortConversationGroups(
  groups: readonly ConversationGroup[]
): ConversationGroup[] {
  return groups
    .map((group) => {
      const sessions = [...group.sessions].sort(compareSessions);
      return {
        ...group,
        sessions,
        newestCreatedAt: sessions[0]?.createdAt ?? 0,
      };
    })
    .sort(
      (left, right) =>
        right.newestCreatedAt - left.newestCreatedAt ||
        left.folderName.localeCompare(right.folderName) ||
        left.id.localeCompare(right.id)
    );
}

export function disambiguateConversationGroups(
  groups: readonly ConversationGroup[]
): ConversationGroup[] {
  const groupsByFolderName = new Map<string, ConversationGroup[]>();

  for (const group of groups) {
    const sameNamedGroups = groupsByFolderName.get(group.folderName) ?? [];
    sameNamedGroups.push(group);
    groupsByFolderName.set(group.folderName, sameNamedGroups);
  }

  const disambiguated = groups.map((group) => {
    const sameNamedGroups = groupsByFolderName.get(group.folderName) ?? [];
    if (sameNamedGroups.length === 1) return { ...group, label: group.folderName };

    return {
      ...group,
      label: `${group.folderName} · ${findDisambiguatingParent(group, sameNamedGroups)}`,
    };
  });

  const labelCounts = new Map<string, number>();
  for (const group of disambiguated) {
    labelCounts.set(group.label, (labelCounts.get(group.label) ?? 0) + 1);
  }

  const labelPositions = new Map<string, number>();
  return disambiguated.map((group) => {
    if ((labelCounts.get(group.label) ?? 0) === 1) return group;

    const position = (labelPositions.get(group.label) ?? 0) + 1;
    labelPositions.set(group.label, position);
    return { ...group, label: `${group.label} ${position}` };
  });
}

export function flattenConversationGroups(
  groups: readonly ConversationGroup[]
): FlattenedConversationListItem[] {
  return groups.flatMap((group) => [
    { type: 'heading' as const, id: `group:${group.id}`, label: group.label },
    ...group.sessions.map((session) => ({
      type: 'conversation' as const,
      id: `conversation:${session.projectId}\0${session.id}`,
      session,
    })),
  ]);
}

export function buildConversationListItems(
  sessions: readonly GlobalSession[]
): FlattenedConversationListItem[] {
  return flattenConversationGroups(
    disambiguateConversationGroups(sortConversationGroups(groupConversations(sessions)))
  );
}

export function appendConversationEndSentinel(
  items: readonly FlattenedConversationListItem[],
  hasMore: boolean
): ConversationListItem[] {
  if (!hasMore) return [...items];

  return [...items, { type: 'end-sentinel', id: 'conversation-feed-end' }];
}
