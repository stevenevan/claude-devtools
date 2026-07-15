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

// AgentPatch is a sparse frontmatter+body patch (Week 26). Every field is
// optional: an omitted key leaves that frontmatter key untouched; a present
// string patches (or, for body, replaces the system-prompt body). Only changed
// fields are sent.
export interface AgentPatch {
  name?: string;
  description?: string;
  tools?: string;
  model?: string;
  body?: string;
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
