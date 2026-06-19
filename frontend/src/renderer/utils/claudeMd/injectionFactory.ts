import { generateInjectionId, getDisplayName, joinPaths } from './pathHelpers';

import type { ClaudeMdInjection, ClaudeMdSource } from '../../types/claudeMd';
import type { ClaudeMdFileInfo } from '../../types/data';

const DEFAULT_ESTIMATED_TOKENS = 500;

const SOURCE_PROJECT_MEMORY: ClaudeMdSource = 'project-memory';

export function createGlobalInjections(
  projectRoot: string,
  aiGroupId: string,
  tokenData?: Record<string, ClaudeMdFileInfo>
): ClaudeMdInjection[] {
  const injections: ClaudeMdInjection[] = [];

  const getTokens = (key: string): number => {
    return tokenData?.[key]?.estimatedTokens ?? DEFAULT_ESTIMATED_TOKENS;
  };

  // 1. Enterprise config
  const enterprisePath =
    tokenData?.enterprise?.path ?? '/Library/Application Support/ClaudeCode/CLAUDE.md';
  const enterpriseTokens = getTokens('enterprise');
  if (enterpriseTokens > 0) {
    injections.push({
      id: generateInjectionId(enterprisePath),
      path: enterprisePath,
      source: 'enterprise',
      displayName: getDisplayName(enterprisePath, 'enterprise'),
      isGlobal: true,
      estimatedTokens: enterpriseTokens,
      firstSeenInGroup: aiGroupId,
    });
  }

  // 2. User memory (~/.claude/CLAUDE.md) — use ~ since renderer can't access process.env
  const userMemoryPath = '~/.claude/CLAUDE.md';
  const userTokens = getTokens('user');
  if (userTokens > 0) {
    injections.push({
      id: generateInjectionId(userMemoryPath),
      path: userMemoryPath,
      source: 'user-memory',
      displayName: getDisplayName(userMemoryPath, 'user-memory'),
      isGlobal: true,
      estimatedTokens: userTokens,
      firstSeenInGroup: aiGroupId,
    });
  }

  // 3. Project memory - could be at root or in .claude folder
  const projectMemoryPath = joinPaths(projectRoot, 'CLAUDE.md');
  const projectMemoryAltPath = joinPaths(projectRoot, '.claude/CLAUDE.md');
  const projectTokens = getTokens('project');
  if (projectTokens > 0) {
    injections.push({
      id: generateInjectionId(projectMemoryPath),
      path: projectMemoryPath,
      source: SOURCE_PROJECT_MEMORY,
      displayName: getDisplayName(projectMemoryPath, SOURCE_PROJECT_MEMORY),
      isGlobal: true,
      estimatedTokens: projectTokens,
      firstSeenInGroup: aiGroupId,
    });
  }
  const projectAltTokens = getTokens('project-alt');
  if (projectAltTokens > 0) {
    injections.push({
      id: generateInjectionId(projectMemoryAltPath),
      path: projectMemoryAltPath,
      source: SOURCE_PROJECT_MEMORY,
      displayName: getDisplayName(projectMemoryAltPath, SOURCE_PROJECT_MEMORY),
      isGlobal: true,
      estimatedTokens: projectAltTokens,
      firstSeenInGroup: aiGroupId,
    });
  }

  // 4. Project rules (*.md files in .claude/rules/)
  const projectRulesPath = joinPaths(projectRoot, '.claude/rules/*.md');
  const projectRulesTokens = getTokens('project-rules');
  if (projectRulesTokens > 0) {
    injections.push({
      id: generateInjectionId(projectRulesPath),
      path: projectRulesPath,
      source: 'project-rules',
      displayName: getDisplayName(projectRulesPath, 'project-rules'),
      isGlobal: true,
      estimatedTokens: projectRulesTokens,
      firstSeenInGroup: aiGroupId,
    });
  }

  // 5. Project local
  const projectLocalPath = joinPaths(projectRoot, 'CLAUDE.local.md');
  const projectLocalTokens = getTokens('project-local');
  if (projectLocalTokens > 0) {
    injections.push({
      id: generateInjectionId(projectLocalPath),
      path: projectLocalPath,
      source: 'project-local',
      displayName: getDisplayName(projectLocalPath, 'project-local'),
      isGlobal: true,
      estimatedTokens: projectLocalTokens,
      firstSeenInGroup: aiGroupId,
    });
  }

  // 6. User rules (~/.claude/rules/**/*.md)
  const userRulesPath = '~/.claude/rules/**/*.md';
  const userRulesTokens = getTokens('user-rules');
  if (userRulesTokens > 0) {
    injections.push({
      id: generateInjectionId(userRulesPath),
      path: userRulesPath,
      source: 'user-rules',
      displayName: getDisplayName(userRulesPath, 'user-rules'),
      isGlobal: true,
      estimatedTokens: userRulesTokens,
      firstSeenInGroup: aiGroupId,
    });
  }

  // 7. Auto memory (~/.claude/projects/<encoded>/memory/MEMORY.md)
  const autoMemoryPath =
    tokenData?.['auto-memory']?.path ?? '~/.claude/projects/.../memory/MEMORY.md';
  const autoMemoryTokens = getTokens('auto-memory');
  if (autoMemoryTokens > 0) {
    injections.push({
      id: generateInjectionId(autoMemoryPath),
      path: autoMemoryPath,
      source: 'auto-memory',
      displayName: getDisplayName(autoMemoryPath, 'auto-memory'),
      isGlobal: true,
      estimatedTokens: autoMemoryTokens,
      firstSeenInGroup: aiGroupId,
    });
  }

  return injections;
}

export function createDirectoryInjection(path: string, aiGroupId: string): ClaudeMdInjection {
  return {
    id: generateInjectionId(path),
    path,
    source: 'directory',
    displayName: getDisplayName(path, 'directory'),
    isGlobal: false,
    estimatedTokens: DEFAULT_ESTIMATED_TOKENS,
    firstSeenInGroup: aiGroupId,
  };
}
