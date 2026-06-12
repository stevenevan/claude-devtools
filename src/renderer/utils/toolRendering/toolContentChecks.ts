import type { LinkedToolItem } from '@renderer/types/groups';

export function hasSkillInstructions(linkedTool: LinkedToolItem): boolean {
  return !!linkedTool.skillInstructions;
}

export function hasReadContent(linkedTool: LinkedToolItem): boolean {
  if (!linkedTool.result) return false;

  const toolUseResult = linkedTool.result.toolUseResult as Record<string, unknown> | undefined;
  const fileData = toolUseResult?.file as { content?: string } | undefined;
  if (fileData?.content) return true;

  if (linkedTool.result.content != null) {
    if (typeof linkedTool.result.content === 'string' && linkedTool.result.content.length > 0)
      return true;
    if (Array.isArray(linkedTool.result.content) && linkedTool.result.content.length > 0)
      return true;
  }

  return false;
}

export function hasEditContent(linkedTool: LinkedToolItem): boolean {
  if (linkedTool.input.old_string != null) return true;

  const toolUseResult = linkedTool.result?.toolUseResult as Record<string, unknown> | undefined;
  if (toolUseResult?.oldString != null || toolUseResult?.newString != null) return true;

  return false;
}

export function hasWriteContent(linkedTool: LinkedToolItem): boolean {
  if (linkedTool.input.content != null || linkedTool.input.file_path != null) return true;

  const toolUseResult = linkedTool.result?.toolUseResult as Record<string, unknown> | undefined;
  if (toolUseResult?.content != null || toolUseResult?.filePath != null) return true;

  return false;
}
