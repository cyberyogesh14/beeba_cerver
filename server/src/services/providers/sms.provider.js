import { NOTIFICATION_PROVIDER } from "../../constants/notification.js";

/**
 * SMS Provider
 *
 * Abstraction for sending SMS messages via a third-party
 * API.  When no real provider is configured the module
 * returns a controlled failure result instead of crashing.
 *
 * Configuration (environment variables):
 *   SMS_PROVIDER  – provider identifier (e.g. "twilio")
 *   SMS_API_KEY   – API key (never logged)
 *   SMS_API_SECRET – API secret (never logged)
 */

const isConfigured = () => {
  return !!(
    process.env.SMS_PROVIDER &&
    process.env.SMS_API_KEY
  );
};

/**
 * Attempt to send an SMS.
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
      provider: NOTIFICATION_PROVIDER.SMS,
      error: "SMS provider not configured",
    };
  }

  //
  // Real SMS integration goes here.
  //
  // Example (pseudocode):
  //
  //   const client = new SMSClient({
  //     apiKey: process.env.SMS_API_KEY,
  //   });
  //
  //   const result = await client.send({
  //     to: payload.to,
  //     body: payload.body,
  //   });
  //
  //   return {
  //     success: true,
  //     provider: NOTIFICATION_PROVIDER.SMS,
  //     providerMessageId: result.id,
  //   };
  //

  return {
    success: false,
    provider: NOTIFICATION_PROVIDER.SMS,
    error: "SMS provider integration not implemented",
  };
};

export default { send };
