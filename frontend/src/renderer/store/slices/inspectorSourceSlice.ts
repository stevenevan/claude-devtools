import { api } from '@renderer/api';

import type { AppState } from '../types';
import type {
  InspectorEvent,
  InspectorPage,
  InspectorSourceStatus,
  SourceKind,
} from '@shared/types/api';
import type { StateCreator } from 'zustand';

export interface InspectorSourceSlice {
  inspectorSource: SourceKind;
  inspectorSources: InspectorSourceStatus[];
  inspectorSourcesLoading: boolean;
  inspectorSourcesError: string | null;
  inspectorSourceGeneration: number;
  inspectorCache: Record<string, unknown>;
  inspectorSelectedSessionId: string | null;
  inspectorSessionEvents: InspectorEvent[];
  inspectorSessionLoading: boolean;
  inspectorSessionError: string | null;

  loadInspectorSources: () => Promise<void>;
  setInspectorSource: (source: SourceKind) => void;
  getInspectorCacheKey: (
    source: SourceKind,
    operation: string,
    id?: string,
    cursor?: string | null,
    fingerprint?: string
  ) => string;
  getInspectorCache: <T>(key: string) => T | undefined;
  setInspectorCache: (key: string, value: unknown) => void;
  clearInspectorCache: () => void;
  loadInspectorSession: (id: string) => Promise<void>;
}

export const createInspectorSourceSlice: StateCreator<
  AppState,
  [],
  [],
  InspectorSourceSlice
> = (set, get) => {
  let requestId = 0;
  let sessionRequestId = 0;

  return {
    inspectorSource: 'claude',
    inspectorSources: [],
    inspectorSourcesLoading: false,
    inspectorSourcesError: null,
    inspectorSourceGeneration: 0,
    inspectorCache: {},
    inspectorSelectedSessionId: null,
    inspectorSessionEvents: [],
    inspectorSessionLoading: false,
    inspectorSessionError: null,

    loadInspectorSources: async (): Promise<void> => {
      const currentRequest = ++requestId;
      set({ inspectorSourcesLoading: true, inspectorSourcesError: null });
      try {
        const inspectorSources = await api.getInspectorSources();
        if (currentRequest !== requestId) return;
        set({ inspectorSources, inspectorSourcesLoading: false });
      } catch (error) {
        if (currentRequest !== requestId) return;
        set({
          inspectorSources: [],
          inspectorSourcesLoading: false,
          inspectorSourcesError: error instanceof Error ? error.message : String(error),
        });
      }
    },

    setInspectorSource: (inspectorSource: SourceKind): void => {
      if (get().inspectorSource === inspectorSource) return;
      sessionRequestId += 1;
      set((state) => ({
        inspectorSource,
        inspectorSourceGeneration: state.inspectorSourceGeneration + 1,
        inspectorCache: {},
        inspectorSelectedSessionId: null,
        inspectorSessionEvents: [],
        inspectorSessionLoading: false,
        inspectorSessionError: null,
      }));
    },

    getInspectorCacheKey: (
      source: SourceKind,
      operation: string,
      id?: string,
      cursor?: string | null,
      fingerprint?: string
    ): string => {
      const revision =
        get().inspectorSources.find((status) => status.sourceKind === source)?.revision ??
        'unknown';
      return JSON.stringify([
        source,
        revision,
        operation,
        id ?? '',
        cursor ?? '',
        fingerprint ?? '',
      ]);
    },

    getInspectorCache: <T>(key: string): T | undefined =>
      get().inspectorCache[key] as T | undefined,

    setInspectorCache: (key: string, value: unknown): void => {
      set((state) => {
        const entries = Object.entries({ ...state.inspectorCache, [key]: value });
        const boundedEntries = entries.slice(-64);
        return { inspectorCache: Object.fromEntries(boundedEntries) };
      });
    },

    clearInspectorCache: (): void => {
      set({ inspectorCache: {} });
    },

    loadInspectorSession: async (id: string): Promise<void> => {
      const source = get().inspectorSource;
      const generation = get().inspectorSourceGeneration;
      const request = ++sessionRequestId;
      const cacheKey = get().getInspectorCacheKey(source, 'session', id, null, '500');
      set({
        inspectorSelectedSessionId: id,
        inspectorSessionEvents: [],
        inspectorSessionLoading: true,
        inspectorSessionError: null,
      });
      try {
        const cached = get().getInspectorCache<InspectorPage<InspectorEvent>>(cacheKey);
        const page = cached ?? (await api.readSourceSession(source, id, null, 500));
        const current = get();
        if (
          request !== sessionRequestId ||
          current.inspectorSource !== source ||
          current.inspectorSourceGeneration !== generation
        ) {
          return;
        }
        if (!cached) current.setInspectorCache(cacheKey, page);
        set({
          inspectorSessionEvents: page.items,
          inspectorSessionLoading: false,
          inspectorSessionError: page.diagnostics[0]?.message ?? null,
        });
      } catch (error) {
        const current = get();
        if (
          request !== sessionRequestId ||
          current.inspectorSource !== source ||
          current.inspectorSourceGeneration !== generation
        ) {
          return;
        }
        set({
          inspectorSessionLoading: false,
          inspectorSessionError: error instanceof Error ? error.message : String(error),
        });
      }
    },
  };
};
