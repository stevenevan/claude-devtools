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
