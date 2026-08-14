import type {
  CodexAgentDetail,
  CodexAgentList,
  CodexInventoryScope,
  CodexInstructionDetail,
  CodexInstructionList,
  CodexSkillDetail,
  CodexSkillList,
  CodexTextApplyResult,
  CodexTextPreviewResult,
  DesktopAPI,
} from '@shared/types/api';

import { call } from '../invoke';

type CodexInventorySlice = Pick<
  DesktopAPI,
  | 'listCodexInstructions'
  | 'readCodexInstruction'
  | 'previewCodexInstruction'
  | 'applyCodexInstruction'
  | 'listCodexAgents'
  | 'readCodexAgent'
  | 'previewCodexAgent'
  | 'applyCodexAgent'
  | 'listCodexSkills'
  | 'readCodexSkill'
>;

export const codexInventoryCommands: CodexInventorySlice = {
  listCodexInstructions: (scope: CodexInventoryScope) =>
    call<CodexInstructionList>('list_codex_instructions', { scope }),
  readCodexInstruction: (scope: CodexInventoryScope, recordId: string, maxBytes?: number) =>
    call<CodexInstructionDetail>('read_codex_instruction', {
      scope,
      recordId,
      maxBytes,
    }),
  previewCodexInstruction: (
    scope: CodexInventoryScope,
    recordId: string,
    content: string,
    expectedRevision: string
  ) =>
    call<CodexTextPreviewResult>('preview_codex_instruction', {
      scope,
      recordId,
      content,
      expectedRevision,
    }),
  applyCodexInstruction: (
    scope: CodexInventoryScope,
    recordId: string,
    content: string,
    expectedRevision: string
  ) =>
    call<CodexTextApplyResult>('apply_codex_instruction', {
      scope,
      recordId,
      content,
      expectedRevision,
    }),
  listCodexAgents: (scope: CodexInventoryScope) =>
    call<CodexAgentList>('list_codex_agents', { scope }),
  readCodexAgent: (scope: CodexInventoryScope, recordId: string, maxBytes?: number) =>
    call<CodexAgentDetail>('read_codex_agent', {
      scope,
      recordId,
      maxBytes,
    }),
  previewCodexAgent: (
    scope: CodexInventoryScope,
    recordId: string,
    content: string,
    expectedRevision: string
  ) =>
    call<CodexTextPreviewResult>('preview_codex_agent', {
      scope,
      recordId,
      content,
      expectedRevision,
    }),
  applyCodexAgent: (
    scope: CodexInventoryScope,
    recordId: string,
    content: string,
    expectedRevision: string
  ) =>
    call<CodexTextApplyResult>('apply_codex_agent', {
      scope,
      recordId,
      content,
      expectedRevision,
    }),
  listCodexSkills: (scope: CodexInventoryScope) =>
    call<CodexSkillList>('list_codex_skills', { scope }),
  readCodexSkill: (scope: CodexInventoryScope, recordId: string, maxBytes?: number) =>
    call<CodexSkillDetail>('read_codex_skill', {
      scope,
      recordId,
      maxBytes,
    }),
};

