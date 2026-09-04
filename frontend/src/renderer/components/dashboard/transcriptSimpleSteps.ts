import { getSimpleToolSummary } from '@renderer/utils/toolRendering/toolSummaryHelpers';
import { sanitizeSimpleText } from '@renderer/utils/simpleTextSanitizer';

import type { InspectorEvent, TranscriptRecord } from '@shared/types/api';

export interface SimpleTranscriptEntry {
  id: string;
  text: string;
}

export interface SimpleTranscript {
  userTexts: SimpleTranscriptEntry[];
  toolSteps: SimpleTranscriptEntry[];
}

function safeParseToolInput(raw: string | null): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return {};
  }
  return {};
}

function isUserEvent(event: InspectorEvent): boolean {
  return (
    event.role === 'user' || event.kind === 'user_message' || event.kind === 'user'
  );
}

function isToolCallEvent(event: InspectorEvent): boolean {
  return event.toolName !== null && event.toolOutputSize === null;
}

export function buildSimpleTranscript(
  records: readonly (InspectorEvent | TranscriptRecord)[]
): SimpleTranscript {
  const userTexts: SimpleTranscriptEntry[] = [];
  const toolSteps: SimpleTranscriptEntry[] = [];
  let unpairedToolUse: { toolName: string; stepIndex: number } | null = null;

  const pushToolStep = (id: string, text: string): void => {
    const clean = text.trim();
    if (clean) toolSteps.push({ id, text: clean });
  };

  records.forEach((record, index) => {
    if (isLegacyRecord(record)) {
      if (record.kind === 'user') {
        const text = sanitizeSimpleText(record.content ?? '').trim();
        if (text) userTexts.push({ id: `simple-transcript-user-${index}`, text });
        return;
      }
      if (record.kind === 'tool_use') {
        const toolName = record.toolName ?? 'unknown tool';
        pushToolStep(
          `simple-transcript-step-${index}`,
          getSimpleToolSummary(toolName, safeParseToolInput(record.toolInput))
        );
        unpairedToolUse = { toolName, stepIndex: toolSteps.length - 1 };
        return;
      }
      if (record.kind === 'tool_result') {
        const toolName = record.toolName ?? 'unknown tool';
        if (unpairedToolUse && unpairedToolUse.toolName === toolName) {
          unpairedToolUse = null;
          return;
        }
        pushToolStep(`simple-transcript-step-${index}`, `Got a result from ${toolName}`);
        return;
      }
      return;
    }

    if (isUserEvent(record)) {
      const text = sanitizeSimpleText(record.content ?? '').trim();
      if (text) userTexts.push({ id: `simple-transcript-user-${index}`, text });
      return;
    }
    if (record.toolName && isToolCallEvent(record)) {
      pushToolStep(
        `simple-transcript-step-${index}`,
        getSimpleToolSummary(record.toolName, {})
      );
      unpairedToolUse = { toolName: record.toolName, stepIndex: toolSteps.length - 1 };
      return;
    }
    if (record.toolName && !isToolCallEvent(record)) {
      if (unpairedToolUse && unpairedToolUse.toolName === record.toolName) {
        unpairedToolUse = null;
        return;
      }
      pushToolStep(`simple-transcript-step-${index}`, `Got a result from ${record.toolName}`);
    }
  });

  return { userTexts, toolSteps };
}

function isLegacyRecord(record: InspectorEvent | TranscriptRecord): record is TranscriptRecord {
  return 'toolInput' in record;
}
