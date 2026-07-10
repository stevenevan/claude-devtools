export interface EnvFlag {
  key: string;
  kind: 'bool' | 'int';
  description: string;
}

// Seeded from flags actually observed in real `env` blocks — zero-hallucination.
// Any additional flag must be verified against an authoritative source before
// its name/type/default is hardcoded here.
export const ENV_FLAG_CATALOG: EnvFlag[] = [
  { key: 'DISABLE_TELEMETRY', kind: 'bool', description: 'Opt out of usage telemetry.' },
  {
    key: 'MCP_CONNECTION_NONBLOCKING',
    kind: 'bool',
    description: 'Do not block startup on MCP server connections.',
  },
  {
    key: 'DISABLE_FEEDBACK_COMMAND',
    kind: 'bool',
    description: 'Disable the /feedback command.',
  },
  {
    key: 'CLAUDE_CODE_ENABLE_FINE_GRAINED_TOOL_STREAMING',
    kind: 'bool',
    description: 'Enable fine-grained tool-use streaming.',
  },
  {
    key: 'CLAUDE_CODE_MAX_TOOL_USE_CONCURRENCY',
    kind: 'int',
    description: 'Max concurrent tool executions.',
  },
];

export function lookupFlag(key: string): EnvFlag | undefined {
  return ENV_FLAG_CATALOG.find((flag) => flag.key === key);
}
