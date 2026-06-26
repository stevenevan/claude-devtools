import { createLogger } from '@shared/utils/logger';

import type { SessionFilterState } from '@renderer/store/slices/sessionSlice';
import type { FilterPresetEntry, FilterPresetPayload } from '@shared/types/notifications';

const logger = createLogger('FilterPresetSerialization');

let didWarn = false;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const filtered = value.filter((v): v is string => typeof v === 'string');
  return filtered.length > 0 ? filtered : undefined;
}

export function parseFilterPayload(raw: unknown): SessionFilterState | null {
  if (!isObject(raw)) {
    if (!didWarn) {
      logger.warn('filter payload is not an object; dropping preset');
      didWarn = true;
    }
    return null;
  }
  const out: SessionFilterState = {};
  const dateMin = asNumber(raw.dateMin);
  if (dateMin !== undefined) out.dateMin = dateMin;
  const dateMax = asNumber(raw.dateMax);
  if (dateMax !== undefined) out.dateMax = dateMax;
  const minContext = asNumber(raw.minContext);
  if (minContext !== undefined) out.minContext = minContext;
  const maxContext = asNumber(raw.maxContext);
  if (maxContext !== undefined) out.maxContext = maxContext;
  const minCompactions = asNumber(raw.minCompactions);
  if (minCompactions !== undefined) out.minCompactions = minCompactions;
  const agentName = asString(raw.agentName);
  if (agentName !== undefined) out.agentName = agentName;
  const tags = asStringArray(raw.tags);
  if (tags !== undefined) out.tags = tags;
  return out;
}

export function parseFilterPresetEntry(raw: unknown): FilterPresetEntry | null {
  if (!isObject(raw)) return null;
  const id = asString(raw.id);
  const name = typeof raw.name === 'string' ? raw.name : undefined;
  const createdAt = asNumber(raw.createdAt);
  if (id === undefined || name === undefined || createdAt === undefined) return null;
  const filter = parseFilterPayload(raw.filter);
  if (filter === null) return null;
  return { id, name, filter: filter as FilterPresetPayload, createdAt };
}

export function __resetForTests(): void {
  didWarn = false;
}
