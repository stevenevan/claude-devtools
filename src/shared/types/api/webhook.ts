// Webhook API (sprint 41)

import type { WebhookEndpoint } from '../notifications';

export interface WebhookAPI {
  testSend: (endpoint: WebhookEndpoint) => Promise<void>;
}
