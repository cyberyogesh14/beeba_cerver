import {
  createNotification,
  findNotificationById,
  updateNotificationStatus,
  findExistingNotification,
} from "../repositories/notification.repository.js";

import {
  emitToCustomer,
  emitToDisplay,
  emitToAdmins,
} from "../sockets/emitter.js";

import { SOCKET_EVENTS } from "../constants/socket.js";

import Customer from "../models/Customer.js";

import {
  NOTIFICATION_RECIPIENT,
  NOTIFICATION_CHANNEL,
  NOTIFICATION_STATUS,
  NOTIFICATION_PROVIDER,
  NOTIFICATION_TYPE,
} from "../constants/notification.js";

import { getProvider } from "./providers/index.js";

const { CUSTOMER_NOTIFICATION, NOTIFICATION } = SOCKET_EVENTS;

// Email is sent exactly once for these once-per-token events.
// Recall has its own TOKEN_RECALLED event so it never reuses
// TOKEN_CALLED, and repeated recalls are distinct events.
const EMAIL_SINGLE_FIRE_TYPES = new Set([
  NOTIFICATION_TYPE.TOKEN_CREATED,
  NOTIFICATION_TYPE.TOKEN_PRECALL,
  NOTIFICATION_TYPE.TOKEN_CALLED,
]);

/**
 * Deliver a real-time Socket.IO push to the appropriate
 * audience room.  This is separate from provider-based
 * delivery (SMS / WhatsApp).
 */
const deliverSocket = (notification) => {
  const payload = notification.toSafeObject();

  if (
    notification.recipientType ===
    NOTIFICATION_RECIPIENT.CUSTOMER
  ) {
    if (notification.customer) {
      emitToCustomer(
        notification.customer.toString(),
        CUSTOMER_NOTIFICATION,
        payload
      );
    }
    return;
  }

  if (
    notification.recipientType ===
    NOTIFICATION_RECIPIENT.ADMIN
  ) {
    emitToAdmins(NOTIFICATION, payload);
    return;
  }

  emitToDisplay(NOTIFICATION, payload);
};

/**
 * Attempt to send via the configured provider for the
 * notification's channel.
 *
 * Returns the provider result object.
 */
const deliverProvider = async (notification) => {
  const channel = notification.channel;

  // SOCKET-only notifications do not need provider delivery.
  if (!channel || channel === NOTIFICATION_CHANNEL.SOCKET) {
    return { success: true, provider: "socket" };
  }

  const provider = getProvider(channel);

  // EMAIL delivery resolves the customer's email address and
  // sends subject (title) + plain-text body (message). If the
  // customer has no email the delivery fails cleanly instead
  // of throwing. An optional HTML body (e.g. a tracking button)
  // is carried through the notification metadata so the email
  // provider can render it while keeping the plain-text
  // fallback in the message field.
  if (channel === NOTIFICATION_CHANNEL.EMAIL) {
    const customer = notification.customer
      ? await Customer.findById(
          notification.customer
        ).select("email")
      : null;

    const to = customer?.email ?? null;

    if (!to) {
      return {
        success: false,
        provider: NOTIFICATION_PROVIDER.EMAIL,
        error: "Customer has no email address",
      };
    }

    return provider.send({
      to,
      subject: notification.title,
      body: notification.message,
      html: notification.metadata?.html ?? undefined,
    });
  }

  const result = await provider.send({
    to: notification.customer?.toString?.() ?? null,
    tokenNumber: notification.tokenNumber,
    message: notification.message,
    title: notification.title,
  });

  return result;
};

/**
 * Create a persistent notification record and deliver it.
 *
 * Flow:
 *   1. Persist the record with status PENDING.
 *   2. Push via Socket.IO (best-effort).
 *   3. Attempt provider delivery (best-effort).
 *   4. Update status to SENT or FAILED.
 *
 * Notifications are intentionally created outside any
 * queue transaction so that a delivery failure never
 * rolls back a queue state change.
 *
 * @param {object} data notification fields
 * @returns {Promise<object>} saved Notification document
 */
export const notify = async (data) => {
  const channel = data.channel || NOTIFICATION_CHANNEL.SOCKET;

  // Guard against duplicate emails: for once-per-token events
  // (TOKEN_CREATED, TOKEN_CALLED) a PENDING/SENT email for the
  // same token is never re-created.
  if (
    channel === NOTIFICATION_CHANNEL.EMAIL &&
    data.token &&
    EMAIL_SINGLE_FIRE_TYPES.has(data.type)
  ) {
    const existing = await findExistingNotification(
      data.token,
      data.type,
      channel
    );

    if (existing) {
      return existing;
    }
  }

  // 1. Create record with PENDING status.
  const [notification] = await createNotification({
    ...data,
    channel,
    status: NOTIFICATION_STATUS.PENDING,
  });

  // 2. Real-time Socket.IO push (best-effort).
  try {
    deliverSocket(notification);
  } catch (err) {
    console.error("Socket delivery failed:", err.message);
  }

  // 3. Provider-based delivery (best-effort).
  try {
    const result = await deliverProvider(notification);

    if (result.success) {
      await updateNotificationStatus(notification._id, {
        status: NOTIFICATION_STATUS.SENT,
        sentAt: new Date(),
        provider: result.provider || null,
        deliveredAt: new Date(),
      });
      notification.status = NOTIFICATION_STATUS.SENT;
      notification.sentAt = new Date();
      notification.deliveredAt = new Date();
      notification.provider = result.provider || null;
    } else {
      const safeError = result.error || "Delivery failed";
      await updateNotificationStatus(notification._id, {
        status: NOTIFICATION_STATUS.FAILED,
        provider: result.provider || null,
        error: safeError,
      });
      notification.status = NOTIFICATION_STATUS.FAILED;
      notification.error = safeError;
      notification.provider = result.provider || null;
    }
  } catch (err) {
    const safeError =
      err.message || "Provider delivery failed";
    console.error(
      "Notification provider delivery failed:",
      safeError
    );
    await updateNotificationStatus(notification._id, {
      status: NOTIFICATION_STATUS.FAILED,
      error: safeError,
    });
    notification.status = NOTIFICATION_STATUS.FAILED;
    notification.error = safeError;
  }

  return notification;
};

/**
 * Retry a failed notification.
 *
 * Resets status to PENDING, clears the previous error,
 * re-attempts provider delivery and updates the record.
 *
 * @param {string} notificationId
 * @returns {Promise<object>} updated Notification
 */
export const retryNotification = async (notificationId) => {
  const notification =
    await findNotificationById(notificationId);

  if (!notification) {
    throw Object.assign(
      new Error("Notification not found"),
      { statusCode: 404 }
    );
  }

  if (
    notification.status !== NOTIFICATION_STATUS.FAILED
  ) {
    throw Object.assign(
      new Error("Only failed notifications can be retried"),
      { statusCode: 400 }
    );
  }

  // Reset to PENDING before attempting delivery.
  await updateNotificationStatus(notification._id, {
    status: NOTIFICATION_STATUS.PENDING,
    error: null,
  });

  notification.status = NOTIFICATION_STATUS.PENDING;
  notification.error = null;

  // Attempt Socket.IO push (best-effort).
  try {
    deliverSocket(notification);
  } catch (err) {
    console.error("Socket delivery failed on retry:", err.message);
  }

  // Attempt provider delivery.
  try {
    const result = await deliverProvider(notification);

    if (result.success) {
      await updateNotificationStatus(notification._id, {
        status: NOTIFICATION_STATUS.SENT,
        sentAt: new Date(),
        provider: result.provider || null,
        deliveredAt: new Date(),
      });
      notification.status = NOTIFICATION_STATUS.SENT;
      notification.sentAt = new Date();
      notification.deliveredAt = new Date();
      notification.provider = result.provider || null;
    } else {
      const safeError = result.error || "Delivery failed";
      await updateNotificationStatus(notification._id, {
        status: NOTIFICATION_STATUS.FAILED,
        provider: result.provider || null,
        error: safeError,
      });
      notification.status = NOTIFICATION_STATUS.FAILED;
      notification.error = safeError;
      notification.provider = result.provider || null;
    }
  } catch (err) {
    const safeError =
      err.message || "Provider delivery failed";
    console.error(
      "Notification retry delivery failed:",
      safeError
    );
    await updateNotificationStatus(notification._id, {
      status: NOTIFICATION_STATUS.FAILED,
      error: safeError,
    });
    notification.status = NOTIFICATION_STATUS.FAILED;
    notification.error = safeError;
  }

  return notification;
};
