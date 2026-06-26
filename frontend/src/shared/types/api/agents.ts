// Agent Config

export interface AgentConfig {
  name: string;
  color?: string;
}

// Global ~/.claude/ Config Types

export interface GlobalAgent {
  name: string;
  description: string;
  tools: string;
  model: string;
  filePath: string;
  content: string;
}

export interface GlobalSkill {
  name: string;
  description: string;
  userInvocable: boolean;
  resolvedPath: string;
  symlinkPath: string;
}

export interface GlobalPlugin {
  id: string;
  name: string;
  marketplace: string;
  version: string;
  installedAt: string;
  lastUpdated: string;
  enabled: boolean;
}
