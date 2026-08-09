import { useEffect, useState } from 'react';

import { api } from '@renderer/api';
import { formatConversationSubject } from '@renderer/components/dashboard/dashboardFormatters';
import { createLogger } from '@shared/utils/logger';

import type { DesktopAPI } from '@shared/types/api';

const logger = createLogger('Hook:useConversationSubjects');
const FALLBACK_CONVERSATION_SUBJECT = 'Untitled conversation';

type GetSessionsByIds = DesktopAPI['getSessionsByIds'];

export type ConversationIdentity = {
  projectId: string;
  sessionId: string;
};

export type ConversationSubjectLookup = ReadonlyMap<string, string>;

export function conversationSubjectKey(identity: ConversationIdentity): string {
  return `${identity.projectId}\0${identity.sessionId}`;
}

function uniqueConversationIdentities(
  identities: readonly ConversationIdentity[]
): ConversationIdentity[] {
  const seen = new Set<string>();
  return identities.filter((identity) => {
    const key = conversationSubjectKey(identity);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function createFallbackLookup(
  identities: readonly ConversationIdentity[]
): Map<string, string> {
  const lookup = new Map<string, string>();
  for (const identity of identities) {
    lookup.set(conversationSubjectKey(identity), FALLBACK_CONVERSATION_SUBJECT);
  }
  return lookup;
}

function groupSessionIdsByProject(
  identities: readonly ConversationIdentity[]
): Map<string, string[]> {
  const sessionIdsByProject = new Map<string, string[]>();

  for (const identity of identities) {
    const sessionIds = sessionIdsByProject.get(identity.projectId);
    if (sessionIds) {
      sessionIds.push(identity.sessionId);
    } else {
      sessionIdsByProject.set(identity.projectId, [identity.sessionId]);
    }
  }

  return sessionIdsByProject;
}

export async function resolveConversationSubjects(
  identities: readonly ConversationIdentity[],
  getSessionsByIds: GetSessionsByIds = api.getSessionsByIds
): Promise<ConversationSubjectLookup> {
  const uniqueIdentities = uniqueConversationIdentities(identities);
  const lookup = createFallbackLookup(uniqueIdentities);
  const sessionIdsByProject = groupSessionIdsByProject(uniqueIdentities);
  const results = await Promise.allSettled(
    [...sessionIdsByProject].map(async ([projectId, sessionIds]) => ({
      projectId,
      sessions: await getSessionsByIds(projectId, sessionIds),
    }))
  );

  for (const result of results) {
    if (result.status === 'rejected') {
      logger.error('Failed to resolve conversation subjects:', result.reason);
      continue;
    }

    for (const session of result.value.sessions) {
      const key = conversationSubjectKey({
        projectId: result.value.projectId,
        sessionId: session.id,
      });
      if (!lookup.has(key)) continue;

      try {
        lookup.set(key, formatConversationSubject(session));
      } catch (error: unknown) {
        logger.error('Failed to format conversation subject:', error);
      }
    }
  }

  return lookup;
}

export function useConversationSubjects(
  identities: readonly ConversationIdentity[]
): ConversationSubjectLookup {
  const requestedIdentities = uniqueConversationIdentities(identities);
  const [subjects, setSubjects] = useState<ConversationSubjectLookup>(() =>
    createFallbackLookup(requestedIdentities)
  );

  useEffect(() => {
    let cancelled = false;
    const currentIdentities = uniqueConversationIdentities(identities);
    setSubjects(createFallbackLookup(currentIdentities));

    void resolveConversationSubjects(currentIdentities)
      .then((resolvedSubjects) => {
        if (!cancelled) setSubjects(resolvedSubjects);
      })
      .catch((error: unknown) => {
        if (!cancelled) logger.error('Failed to resolve conversation subjects:', error);
      });

    return () => {
      cancelled = true;
    };
  }, [identities]);

  return subjects;
}
