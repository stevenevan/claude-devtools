// Context API

/**
 * Context information for listing available contexts.
 */
export interface ContextInfo {
  id: string;
  type: 'local' | 'ssh';
}
