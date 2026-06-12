import type { NotificationTrigger, TriggerContentType, TriggerMode } from '@renderer/types/data';

export function generateId(): string {
  return crypto.randomUUID();
}

export function getAvailableMatchFields(
  contentType: TriggerContentType,
  toolName?: string
): { value: string; label: string }[] {
  if (contentType === 'tool_result') {
    return [{ value: 'content', label: 'Content' }];
  }

  if (contentType === 'thinking') {
    return [{ value: 'thinking', label: 'Thinking Content' }];
  }

  if (contentType === 'text') {
    return [{ value: 'text', label: 'Text Content' }];
  }

  if (contentType === 'tool_use') {
    switch (toolName) {
      case 'Bash':
        return [
          { value: 'command', label: 'Command' },
          { value: 'description', label: 'Description' },
        ];
      case 'Task':
        return [
          { value: 'description', label: 'Description' },
          { value: 'prompt', label: 'Prompt' },
          { value: 'subagent_type', label: 'Subagent Type' },
        ];
      case 'Read':
      case 'Write':
        return [{ value: 'file_path', label: 'File Path' }];
      case 'Edit':
        return [
          { value: 'file_path', label: 'File Path' },
          { value: 'old_string', label: 'Old String' },
          { value: 'new_string', label: 'New String' },
        ];
      case 'Glob':
        return [
          { value: 'pattern', label: 'Pattern' },
          { value: 'path', label: 'Path' },
        ];
      case 'Grep':
        return [
          { value: 'pattern', label: 'Pattern' },
          { value: 'path', label: 'Path' },
          { value: 'glob', label: 'Glob Filter' },
        ];
      case 'WebFetch':
        return [
          { value: 'url', label: 'URL' },
          { value: 'prompt', label: 'Prompt' },
        ];
      case 'WebSearch':
        return [{ value: 'query', label: 'Query' }];
      case 'Skill':
        return [
          { value: 'skill', label: 'Skill Name' },
          { value: 'args', label: 'Arguments' },
        ];
      default:
        return [{ value: '', label: 'Full Input (JSON)' }];
    }
  }

  return [];
}

export function deriveMode(trigger: NotificationTrigger): TriggerMode {
  if (trigger.mode) return trigger.mode;
  // Backward compatibility: requireError + tool_result → error_status
  if (trigger.requireError && trigger.contentType === 'tool_result') {
    return 'error_status';
  }
  return 'content_match';
}

export function validateRegexPattern(pattern: string): string | null {
  if (!pattern) {
    return null;
  }
  try {
    new RegExp(pattern);
    return null;
  } catch {
    return 'Invalid regex pattern';
  }
}
