import { NOTIFICATION_PROVIDER } from "../../constants/notification.js";

/**
 * WhatsApp Provider
 *
 * Abstraction for sending messages via the WhatsApp
 * Business API.  When no real provider is configured the
 * module returns a controlled failure result instead of
 * crashing.
 *
 * Configuration (environment variables):
 *   WHATSAPP_PROVIDER  – provider identifier
 *   WHATSAPP_API_KEY   – API key (never logged)
 *   WHATSAPP_API_SECRET – API secret (never logged)
 *   WHATSAPP_PHONE_ID  – sender phone number ID
 */

const isConfigured = () => {
  return !!(
    process.env.WHATSAPP_PROVIDER &&
    process.env.WHATSAPP_API_KEY &&
    process.env.WHATSAPP_PHONE_ID
  );
};

/**
 * Attempt to send a WhatsApp message.
 *
 * @param {object} payload
 * @param {string} payload.to   – recipient phone number
 * @param {string} payload.body – message text
 * @returns {object} provider result
 */
const send = async (payload) => {
  if (!isConfigured()) {
    return {
      success: false,
      provider: NOTIFICATION_PROVIDER.WHATSAPP,
      error: "WhatsApp provider not configured",
    };
  }

  //
  // Real WhatsApp integration goes here.
  //
  // Example (pseudocode):
  //
  //   const client = new WhatsAppClient({
  //     apiKey: process.env.WHATSAPP_API_KEY,
  //     phoneNumberId: process.env.WHATSAPP_PHONE_ID,
  //   });
  //
  //   const result = await client.send({
  //     to: payload.to,
  //     body: payload.body,
  //   });
  //
  //   return {
  //     success: true,
  //     provider: NOTIFICATION_PROVIDER.WHATSAPP,
  //     providerMessageId: result.id,
  //   };
  //

  return {
    success: false,
    provider: NOTIFICATION_PROVIDER.WHATSAPP,
    error: "WhatsApp provider integration not implemented",
  };
};

export default { send };
