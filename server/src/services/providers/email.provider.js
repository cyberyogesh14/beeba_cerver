import nodemailer from "nodemailer";

import { NOTIFICATION_PROVIDER } from "../../constants/notification.js";

/**
 * Email Provider
 *
 * Sends transactional emails (token created, turn called)
 * over SMTP using nodemailer. When no real SMTP server is
 * configured the module returns a controlled failure result
 * instead of crashing, so queue processing never depends on
 * email availability.
 *
 * Configuration (environment variables):
 *   EMAIL_HOST  – SMTP host
 *   EMAIL_PORT  – SMTP port (default 587)
 *   EMAIL_USER  – SMTP username
 *   EMAIL_PASS  – SMTP password (never logged)
 *   EMAIL_FROM  – sender address used in the From header
 *   EMAIL_SECURE – "true" to force TLS (auto for port 465)
 *
 * The transporter is created lazily on first use and cached.
 */

const isConfigured = () => {
  return !!(
    process.env.EMAIL_HOST &&
    process.env.EMAIL_USER &&
    process.env.EMAIL_PASS &&
    process.env.EMAIL_FROM
  );
};

let transporter = null;

const createTransporter = () => {
  const port = Number(process.env.EMAIL_PORT) || 587;
  const secure = process.env.EMAIL_SECURE
    ? process.env.EMAIL_SECURE === "true"
    : port === 465;

  return nodemailer.createTransport({
    host: process.env.EMAIL_HOST,
    port,
    secure,
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
  });
};

const getTransporter = () => {
  if (!transporter) {
    transporter = createTransporter();
  }

  return transporter;
};

/**
 * Attempt to send an email.
 *
 * @param {object} payload
 * @param {string} payload.to      – recipient email address
 * @param {string} payload.subject – email subject line
 * @param {string} payload.body    – plain-text email body
 * @param {string} [payload.html]  – optional HTML body. When present the
 *                                  message is sent as a multipart/alternative
 *                                  email (HTML for clients that render it,
 *                                  text as the fallback).
 * @returns {object} provider result
 */
const send = async (payload) => {
  if (!isConfigured()) {
    return {
      success: false,
      provider: NOTIFICATION_PROVIDER.EMAIL,
      error:
        "Email provider not configured (EMAIL_HOST, EMAIL_USER, EMAIL_PASS, EMAIL_FROM)",
    };
  }

  if (!payload?.to) {
    return {
      success: false,
      provider: NOTIFICATION_PROVIDER.EMAIL,
      error: "Email recipient address missing",
    };
  }

  try {
    const result = await getTransporter().sendMail({
      from: process.env.EMAIL_FROM,
      to: payload.to,
      subject: payload.subject || "",
      text: payload.body || "",
      ...(payload.html
        ? { html: payload.html }
        : {}),
    });

    return {
      success: true,
      provider: NOTIFICATION_PROVIDER.EMAIL,
      providerMessageId: result.messageId || null,
    };
  } catch (err) {
    return {
      success: false,
      provider: NOTIFICATION_PROVIDER.EMAIL,
      error: err.message || "Email send failed",
    };
  }
};

export const resetEmailTransporter = () => {
  transporter = null;
};

export default { send };