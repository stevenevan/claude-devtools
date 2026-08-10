import { getDateGroupLabel } from '@renderer/utils/dateGrouping';

import type { Project } from '@renderer/types/data';
import type { HistoryEntry } from '@shared/types/api';

export type HistoryListItem =
  | { type: 'heading'; id: string; label: string }
  | { type: 'entry'; id: string; entry: HistoryEntry };

export interface HistoryProjectOption {
  value: string;
  label: string;
}

function pathSegments(path: string): string[] {
  return path.split(/[\\/]+/).filter(Boolean);
}

function dayKey(timestamp: number): string {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function folderName(project: Project | undefined, rawProject: string): string {
  const projectName = project?.name.trim() ?? '';
  if (projectName && !projectName.includes('/') && !projectName.includes('\\')) {
    return projectName;
  }

  const path = project?.path ?? (rawProject.includes('/') || rawProject.includes('\\') ? rawProject : '');
  return pathSegments(path).at(-1) ?? 'Unknown folder';
}

export function getHistoryProjectLabel(
  rawProject: string,
  projects: readonly Project[],
  mode: 'simple' | 'nerd'
): string {
  if (mode === 'nerd') return rawProject || 'Unknown project';

  const project = projects.find((candidate) => candidate.id === rawProject || candidate.path === rawProject);
  return folderName(project, rawProject);
}

export function getHistoryProjectOptions(
  entries: readonly HistoryEntry[],
  projects: readonly Project[],
  mode: 'simple' | 'nerd'
): HistoryProjectOption[] {
  const values = new Set(entries.map((entry) => entry.project));

  return [...values]
    .map((value) => ({ value, label: getHistoryProjectLabel(value, projects, mode) }))
    .sort((left, right) => left.label.localeCompare(right.label) || left.value.localeCompare(right.value));
}

export function flattenHistoryEntries(
  entries: readonly HistoryEntry[],
  now: Date = new Date()
): HistoryListItem[] {
  const groups = new Map<string, { label: string; entries: HistoryEntry[] }>();
  const occurrences = new Map<string, number>();

  for (const entry of entries) {
    const key = dayKey(entry.timestamp);
    const group = groups.get(key);
    if (group) {
      group.entries.push(entry);
    } else {
      groups.set(key, { label: getDateGroupLabel(entry.timestamp, now), entries: [entry] });
    }
  }

  return [...groups].flatMap(([key, group]) => [
    { type: 'heading' as const, id: `history-heading:${key}`, label: group.label },
    ...group.entries.map((entry) => {
      const baseKey = `${entry.timestamp}\0${entry.project}\0${entry.display}`;
      const occurrence = occurrences.get(baseKey) ?? 0;
      occurrences.set(baseKey, occurrence + 1);
      return {
        type: 'entry' as const,
        id: `history-entry:${baseKey}:${occurrence}`,
        entry,
      };
    }),
  ]);
}
