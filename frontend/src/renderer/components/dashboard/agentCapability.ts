export type AgentCapability = 'read-only' | 'read-and-change' | 'runs-commands';

const READ_ONLY_TOOLS = new Set(['Read', 'Glob', 'Grep']);

export function getAgentCapability(toolsValue: string): AgentCapability {
  const tools = toolsValue
    .split(',')
    .map((tool) => tool.trim())
    .filter(Boolean);

  if (tools.some((tool) => tool === 'Bash' || tool === '*')) {
    return 'runs-commands';
  }

  if (tools.some((tool) => tool === 'Edit' || tool === 'Write')) {
    return 'read-and-change';
  }

  if (tools.length > 0 && tools.every((tool) => READ_ONLY_TOOLS.has(tool))) {
    return 'read-only';
  }

  // Unknown or empty permissions must not be presented as harmless read-only access.
  return 'read-and-change';
}

export function getAgentCapabilityLabel(toolsValue: string): string {
  switch (getAgentCapability(toolsValue)) {
    case 'read-only':
      return 'Can read information';
    case 'read-and-change':
      return 'Can read and change files';
    case 'runs-commands':
      return 'Can run commands';
  }
}

const AGENT_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function isValidAgentName(name: string): boolean {
  return AGENT_NAME_PATTERN.test(name);
}

export const AGENT_NAME_RULE = 'Use lowercase letters, numbers, and single dashes only.';
