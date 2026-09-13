import Notification from "../models/Notification.js";

import { NOTIFICATION_STATUS } from "../constants/notification.js";

const populateRefs = (query) =>
  query
    .populate({
      path: "customer",
      select: "name phone email",
    })
    .populate({
      path: "recipient",
      select: "name email role",
    })
    .populate({
      path: "token",
      select: "tokenNumber status",
    });

const createNotificationData = (data) => {
  const doc = { ...data };

  // Carry over the token number for quick reference.
  if (data.tokenNumber) {
    doc.tokenNumber = data.tokenNumber;
  }

  return doc;
};

export const createNotification = (data, session) => {
  const options = session ? { session } : {};

  return Notification.create(
    [createNotificationData(data)],
    options
  );
};

/**
 * List notifications for a staff/admin recipient, newest first.
 */
export const findNotificationsForRecipient = (
  recipientId,
  { limit = 50, readOnly = false } = {}
) => {
  const filter = {
    recipient: recipientId,
  };

  if (readOnly) {
    filter.read = readOnly === "unread" ? false : true;
  }

  return populateRefs(
    Notification.find(filter)
      .sort({ createdAt: -1 })
      .limit(limit)
  );
};

/**
 * List notifications for a customer by their customer id,
 * newest first. Used by the public customer tracking screen.
 */
export const findNotificationsForCustomer = (
  customerId,
  { limit = 50, readOnly = false } = {}
) => {
  const filter = {
    customer: customerId,
  };

  if (readOnly) {
    filter.read = readOnly === "unread" ? false : true;
  }

  return populateRefs(
    Notification.find(filter)
      .sort({ createdAt: -1 })
      .limit(limit)
  );
};

export const findNotificationById = (id) =>
  populateRefs(Notification.findById(id));

export const findNotificationsForToken = (tokenId) =>
  populateRefs(
    Notification.find({ token: tokenId }).sort({
      createdAt: -1,
    })
  );

/**
 * Find a recent notification for the same token, event type
 * and channel that was already created (PENDING or SENT).
 *
 * Used to guard against duplicate emails when a single token
 * event might otherwise be notified more than once.
 */
export const findExistingNotification = async (
  tokenId,
  type,
  channel,
  { windowMs = 60 * 60 * 1000 } = {}
) => {
  return Notification.findOne({
    token: tokenId,
    type,
    channel,
    status: {
      $in: [
        NOTIFICATION_STATUS.PENDING,
        NOTIFICATION_STATUS.SENT,
      ],
    },
    createdAt: { $gte: new Date(Date.now() - windowMs) },
  }).sort({ createdAt: -1 });
};

/**
 * Mark notification(s) as read.
 *
 * When `recipientId` is provided the update is scoped so
 * only notifications belonging to that recipient are
 * touched — preventing one user from marking another
 * user's notifications as read.
 *
 * @param {string|string[]} ids single id or array of ids
 * @param {object} [options]
 * @param {string} [options.recipientId] scope the update
 */
export const markNotificationsRead = async (
  ids,
  { recipientId } = {}
) => {
  const list = Array.isArray(ids) ? ids : [ids];

  const unique = [...new Set(list)];

  if (unique.length === 0) {
    return { acknowledged: true };
  }

  const filter = {
    _id: { $in: unique },
  };

  if (recipientId) {
    filter.recipient = recipientId;
  }

  return Notification.updateMany(filter, {
    $set: {
      read: true,
      readAt: new Date(),
    },
  });
};

export const markAllNotificationsRead = (
  { recipient, customer } = {}
) => {
  const filter = { read: false };

  if (recipient) {
    filter.recipient = recipient;
  }

  if (customer) {
    filter.customer = customer;
  }

  return Notification.updateMany(filter, {
    $set: {
      read: true,
      readAt: new Date(),
    },
  });
};

export const countUnreadNotifications = ({
  recipient,
  customer,
} = {}) => {
  const filter = { read: false };

  if (recipient) {
    filter.recipient = recipient;
  }

  if (customer) {
    filter.customer = customer;
  }

  return Notification.countDocuments(filter);
};

/**
 * Update delivery status fields on a notification.
 *
 * @param {string} notificationId
 * @param {object} fields – e.g. { status, sentAt, provider, error }
 */
export const updateNotificationStatus = async (
  notificationId,
  fields
) => {
  return Notification.findByIdAndUpdate(
    notificationId,
    { $set: fields },
    { returnDocument: "after" }
  );
};
