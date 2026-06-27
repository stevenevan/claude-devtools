

import { logger } from '@renderer/lib/logger';
import { del, get, keys, set } from 'idb-keyval';

import type { DetectedError, Project, RepositoryGroup, Session } from '@renderer/types/data';
import type { PaneLayout } from '@renderer/types/panes';
import type { Tab } from '@renderer/types/tabs';

// Constants

const SNAPSHOT_TTL_MS = 5 * 60 * 1000; // 5 minutes
const STORAGE_KEY_PREFIX = 'context-snapshot:';
const SNAPSHOT_VERSION = 1; // Increment when ContextSnapshot structure changes

// Types

export interface ContextSnapshot {
  // Data state (persistable)
  projects: Project[];
  selectedProjectId: string | null;
  repositoryGroups: RepositoryGroup[];
  selectedRepositoryId: string | null;
  selectedWorktreeId: string | null;
  viewMode: 'flat' | 'grouped';
  sessions: Session[];
  selectedSessionId: string | null;
  sessionsCursor: string | null;
  sessionsHasMore: boolean;
  sessionsTotalCount: number;
  pinnedSessionIds: string[];
  notifications: DetectedError[];
  unreadCount: number;

  // Tab/pane state
  openTabs: Tab[];
  activeTabId: string | null;
  selectedTabIds: string[];
  activeProjectId: string | null;
  paneLayout: PaneLayout;

  // UI state
  sidebarCollapsed: boolean;

  // Metadata
  _metadata: {
    contextId: string;
    capturedAt: number;
    version: number;
  };
}

interface StoredSnapshot {
  snapshot: ContextSnapshot;
  timestamp: number;
  version: number;
}

// Storage Implementation

async function saveSnapshot(contextId: string, snapshot: ContextSnapshot): Promise<void> {
  try {
    const stored: StoredSnapshot = {
      snapshot,
      timestamp: Date.now(),
      version: SNAPSHOT_VERSION,
    };
    const key = `${STORAGE_KEY_PREFIX}${contextId}`;
    await set(key, stored);
  } catch (error) {
    logger.error('failed to save snapshot', { contextId, error: String(error) });
  }
}

async function loadSnapshot(contextId: string): Promise<ContextSnapshot | null> {
  try {
    const key = `${STORAGE_KEY_PREFIX}${contextId}`;
    const stored = await get<StoredSnapshot>(key);

    if (!stored) {
      return null;
    }

    // Check TTL
    const age = Date.now() - stored.timestamp;
    if (age > SNAPSHOT_TTL_MS) {
      // Expired - delete and return null
      void deleteSnapshot(contextId);
      return null;
    }

    // Check version compatibility (simple check for now)
    if (stored.version !== SNAPSHOT_VERSION) {
      logger.warn('snapshot version mismatch', {
        contextId,
        expected: SNAPSHOT_VERSION,
        got: stored.version,
      });
      void deleteSnapshot(contextId);
      return null;
    }

    return stored.snapshot;
  } catch (error) {
    logger.error('failed to load snapshot', { contextId, error: String(error) });
    return null;
  }
}

async function deleteSnapshot(contextId: string): Promise<void> {
  try {
    const key = `${STORAGE_KEY_PREFIX}${contextId}`;
    await del(key);
  } catch (error) {
    logger.error('failed to delete snapshot', { contextId, error: String(error) });
  }
}

async function cleanupExpired(): Promise<void> {
  try {
    const allKeys = await keys();
    const snapshotKeys = allKeys.filter(
      (k): k is IDBValidKey & string => typeof k === 'string' && k.startsWith(STORAGE_KEY_PREFIX)
    );

    const now = Date.now();

    for (const key of snapshotKeys) {
      try {
        const stored = await get<StoredSnapshot>(key);
        if (stored) {
          const age = now - stored.timestamp;
          if (age > SNAPSHOT_TTL_MS) {
            await del(key);
          }
        }
      } catch (error) {
        logger.error('failed to check/delete snapshot key', {
          key: String(key),
          error: String(error),
        });
      }
    }
  } catch (error) {
    logger.error('failed to cleanup expired snapshots', { error: String(error) });
  }
}

async function isAvailable(): Promise<boolean> {
  try {
    const testKey = '__idb_test__';
    await set(testKey, true);
    await del(testKey);
    return true;
  } catch {
    return false;
  }
}

// Exports

export const contextStorage = {
  saveSnapshot,
  loadSnapshot,
  deleteSnapshot,
  cleanupExpired,
  isAvailable,
};
