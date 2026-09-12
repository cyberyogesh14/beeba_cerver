import { NOTIFICATION_PROVIDER } from "../../constants/notification.js";

import mockProvider from "./mock.provider.js";
import emailProvider from "./email.provider.js";
import smsProvider from "./sms.provider.js";
import whatsappProvider from "./whatsapp.provider.js";

const providers = {
  [NOTIFICATION_PROVIDER.MOCK]: mockProvider,
  [NOTIFICATION_PROVIDER.EMAIL]: emailProvider,
  [NOTIFICATION_PROVIDER.SMS]: smsProvider,
  [NOTIFICATION_PROVIDER.WHATSAPP]: whatsappProvider,
};

/**
 * Resolve a notification provider by channel.
 *
 * Defaults to the mock provider so the application is
 * always usable without external services configured.
 *
 * @param {string} channel – NOTIFICATION_CHANNEL value
 * @returns {object} provider with a `send(payload)` method
 */
export const getProvider = (channel) => {
  // EMAIL channel: use the real SMTP email provider unless the
  // global NOTIFICATION_PROVIDER is explicitly "mock" (default in
  // development), in which case deliveries are mocked and recorded
  // as SENT without contacting an SMTP server.
  if (channel === "EMAIL") {
    return process.env.NOTIFICATION_PROVIDER ===
      NOTIFICATION_PROVIDER.MOCK
      ? mockProvider
      : emailProvider;
  }

  const configured = process.env.NOTIFICATION_PROVIDER;

  if (configured && providers[configured]) {
    return providers[configured];
  }

  // SMS channel → SMS provider (or mock fallback)
  if (channel === "SMS") {
    return providers[NOTIFICATION_PROVIDER.SMS] || mockProvider;
  }

  // WHATSAPP channel → WhatsApp provider (or mock fallback)
  if (channel === "WHATSAPP") {
    return providers[NOTIFICATION_PROVIDER.WHATSAPP] || mockProvider;
  }

  // Default: mock provider for SOCKET and everything else
  return mockProvider;
};

export {
  mockProvider,
  emailProvider,
  smsProvider,
  whatsappProvider,
};
