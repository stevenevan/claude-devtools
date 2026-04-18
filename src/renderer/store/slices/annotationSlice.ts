import { api } from '@renderer/api';
import type { AnnotationEntry } from '@shared/types';
import { createLogger } from '@shared/utils/logger';

import type { AppState } from '../types';
import type { StateCreator } from 'zustand';

const logger = createLogger('Store:annotation');

export interface AnnotationSlice {
  annotations: AnnotationEntry[];
  annotationsLoading: boolean;
  annotationsError: string | null;

  fetchAnnotations: () => Promise<void>;
  addAnnotation: (input: {
    sessionId: string;
    projectId: string;
    targetId: string;
    text: string;
    color: string;
  }) => Promise<AnnotationEntry | null>;
  updateAnnotation: (
    annotationId: string,
    patch: { text?: string; color?: string }
  ) => Promise<boolean>;
  removeAnnotation: (annotationId: string) => Promise<void>;
}

export const createAnnotationSlice: StateCreator<AppState, [], [], AnnotationSlice> = (
  set,
  get
) => ({
  annotations: [],
  annotationsLoading: false,
  annotationsError: null,

  fetchAnnotations: async () => {
    set({ annotationsLoading: true, annotationsError: null });
    try {
      const annotations = await api.config.getAnnotations();
      set({ annotations, annotationsLoading: false });
    } catch (error) {
      logger.error('Failed to fetch annotations:', error);
      set({
        annotationsLoading: false,
        annotationsError:
          error instanceof Error ? error.message : 'Failed to load annotations',
      });
    }
  },

  addAnnotation: async ({ sessionId, projectId, targetId, text, color }) => {
    try {
      const entry = await api.config.addAnnotation({
        sessionId,
        projectId,
        targetId,
        text,
        color,
      });
      set({ annotations: [...get().annotations, entry] });
      return entry;
    } catch (error) {
      logger.error('Failed to add annotation:', error);
      return null;
    }
  },

  updateAnnotation: async (annotationId, patch) => {
    try {
      const ok = await api.config.updateAnnotation(annotationId, patch);
      if (!ok) return false;
      set({
        annotations: get().annotations.map((a) =>
          a.id === annotationId
            ? {
                ...a,
                text: patch.text ?? a.text,
                color: patch.color ?? a.color,
                updatedAt: Date.now(),
              }
            : a
        ),
      });
      return true;
    } catch (error) {
      logger.error('Failed to update annotation:', error);
      return false;
    }
  },

  removeAnnotation: async (annotationId) => {
    try {
      await api.config.removeAnnotation(annotationId);
      set({
        annotations: get().annotations.filter((a) => a.id !== annotationId),
      });
    } catch (error) {
      logger.error('Failed to remove annotation:', error);
    }
  },
});
