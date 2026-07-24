// Read-only MCP status dashboard types (Week 22). Rows aggregate MCP server
// state from ~/.claude.json (top-level + per-project mcpServers), each
// project's .mcp.json, and the auth-needed connector cache. Every
// commandOrUrl is server-side masked; this surface writes nothing.

export interface MCPServerRow {
  name: string;
  transport: string;
  sourceKind: string;
  sourcePath: string;
  commandOrUrl: string;
  authNeeded: boolean;
  lastCheckedUnixMs: number;
  cacheAgeDays: number;
}

export interface MCPStatusView {
  servers: MCPServerRow[];
  mcpServersEmpty: boolean;
  connectorsFromCache: MCPServerRow[];
}

// Add/edit payload for a GLOBAL (top-level ~/.claude.json) MCP server. All
// fields optional so the same shape doubles as an update patch — only the
// fields present are written; everything else on the existing entry (masked
// secrets included) stays untouched.
export interface MCPServerConfig {
  type?: string;
  command?: string;
  url?: string;
  args?: string[];
  env?: Record<string, string>;
  headers?: Record<string, string>;
}
