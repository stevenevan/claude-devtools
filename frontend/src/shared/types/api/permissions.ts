// Permissions consolidation editor types (Week 19). Rows merge
// permissions.{allow,deny,ask} across global settings.json, a project's
// committed settings.json, and its settings.local.json. Only global and
// project-local rows are writable; committed-project and nested-anomaly rows
// are display-only.

export type PermissionList = 'allow' | 'deny' | 'ask';

// PermissionScope names a writable settings file. `kind` is 'global'
// (~/.claude/settings.json) or 'project-local' ({projectRoot}/.claude/
// settings.local.json); `projectRoot` is only used for the project-local kind.
export interface PermissionScope {
  kind: string;
  projectRoot: string;
}

export interface PermissionRuleRow {
  rule: string;
  list: string;
  sourceKind: string;
  sourcePath: string;
  writable: boolean;
}

export interface PermissionRulesView {
  rows: PermissionRuleRow[];
}
