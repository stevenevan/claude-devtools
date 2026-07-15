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

// SkillInventoryEntry is one row of the Week 27 skills inventory. isSymlink is
// set from an Lstat of the link entry (never followed); the rest describe the
// resolved directory. bytes is 0 for a symlink (its children contribute 0), so
// removing a link reclaims nothing.
export interface SkillInventoryEntry {
  name: string;
  description: string;
  isSymlink: boolean;
  resolvedPath: string;
  symlinkTarget: string;
  bytes: number;
  hasReferences: boolean;
  hasSkillMd: boolean;
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
