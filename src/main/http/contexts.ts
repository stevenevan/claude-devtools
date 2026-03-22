/**
 * HTTP route handlers for Context Operations.
 *
 * In standalone/sidecar mode there is only a single local context.
 * These routes satisfy the renderer's context API calls.
 *
 * Routes:
 * - GET  /api/contexts        - List available contexts
 * - GET  /api/contexts/active  - Get active context ID
 * - POST /api/contexts/switch  - Switch context (no-op in standalone)
 */

import type { FastifyInstance } from 'fastify';

export function registerContextRoutes(app: FastifyInstance): void {
  app.get('/api/contexts', async () => {
    return [{ id: 'local', type: 'local' }];
  });

  app.get('/api/contexts/active', async () => {
    return 'local';
  });

  app.post('/api/contexts/switch', async () => {
    return { contextId: 'local' };
  });
}
