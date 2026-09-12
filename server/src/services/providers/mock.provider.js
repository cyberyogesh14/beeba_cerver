import { randomUUID } from "node:crypto";

import { NOTIFICATION_PROVIDER } from "../../constants/notification.js";

/**
 * Mock Provider
 *
 * Simulates successful delivery without contacting
 * any external service.  Used for development, testing
 * and when no real provider is configured.
 */
const send = async (payload) => {
  return {
    success: true,
    provider: NOTIFICATION_PROVIDER.MOCK,
    providerMessageId: `mock-${randomUUID()}`,
  };
};

export default { send };
