import {
  findNotificationsForRecipient,
  findNotificationsForCustomer,
  findNotificationById,
  findNotificationsForToken,
  markNotificationsRead,
  markAllNotificationsRead,
  countUnreadNotifications,
} from "../repositories/notification.repository.js";

import {
  retryNotification,
} from "../services/notification.service.js";

import {
  listNotificationsQuerySchema,
  markReadSchema,
} from "../validators/notification.validator.js";

import { successResponse } from "../utils/apiResponse.js";

/**
 * List notifications for the authenticated staff/admin
 * recipient, newest first.
 */
export const listRecipientNotifications = async (
  req,
  res,
  next
) => {
  try {
    const { value, error } =
      listNotificationsQuerySchema.validate(
        req.query
      );

    if (error) {
      return res.status(400).json({
        success: false,
        message: "Validation failed",
        errors: error.details.map(
          (item) => item.message
        ),
      });
    }

    const notifications =
      await findNotificationsForRecipient(
        req.user._id,
        {
          limit: value.limit,
          readOnly: value.read || null,
        }
      );

    return successResponse(res, {
      message: "Notifications retrieved successfully",
      data: {
        count: notifications.length,
        notifications: notifications.map(
          (n) => n.toSafeObject()
        ),
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * List notifications for a specific customer, used by the
 * public customer tracking screen.
 */
export const listCustomerNotifications = async (
  req,
  res,
  next
) => {
  try {
    const { value, error } =
      listNotificationsQuerySchema.validate(
        req.query
      );

    if (error) {
      return res.status(400).json({
        success: false,
        message: "Validation failed",
        errors: error.details.map(
          (item) => item.message
        ),
      });
    }

    const notifications =
      await findNotificationsForCustomer(
        req.params.customerId,
        {
          limit: value.limit,
          readOnly: value.read || null,
        }
      );

    return successResponse(res, {
      message: "Customer notifications retrieved successfully",
      data: {
        count: notifications.length,
        notifications: notifications.map(
          (n) => n.toSafeObject()
        ),
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * List notifications for a token (admin/debug use).
 */
export const listTokenNotifications = async (
  req,
  res,
  next
) => {
  try {
    const notifications =
      await findNotificationsForToken(
        req.params.tokenId
      );

    return successResponse(res, {
      message: "Token notifications retrieved successfully",
      data: {
        count: notifications.length,
        notifications: notifications.map(
          (n) => n.toSafeObject()
        ),
      },
    });
  } catch (error) {
    next(error);
  }
};

export const getSingleNotification = async (
  req,
  res,
  next
) => {
  try {
    const notification =
      await findNotificationById(req.params.id);

    if (!notification) {
      return res.status(404).json({
        success: false,
        message: "Notification not found",
      });
    }

    return successResponse(res, {
      data: {
        notification:
          notification.toSafeObject(),
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Unread notification count for the authenticated
 * recipient.
 */
export const getUnreadCount = async (
  req,
  res,
  next
) => {
  try {
    const count =
      await countUnreadNotifications({
        recipient: req.user._id,
      });

    return successResponse(res, {
      message: "Unread count retrieved",
      data: {
        count,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Mark one or more notifications as read for the
 * authenticated recipient.
 */
export const markRead = async (
  req,
  res,
  next
) => {
  try {
    const { value, error } =
      markReadSchema.validate(req.body);

    if (error) {
      return res.status(400).json({
        success: false,
        message: "Validation failed",
        errors: error.details.map(
          (item) => item.message
        ),
      });
    }

    await markNotificationsRead(value.ids, {
      recipientId: req.user._id,
    });

    return successResponse(res, {
      message: "Notifications marked as read",
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Mark every notification as read for the authenticated
 * recipient.
 */
export const markAllRead = async (
  req,
  res,
  next
) => {
  try {
    await markAllNotificationsRead({
      recipient: req.user._id,
    });

    return successResponse(res, {
      message: "All notifications marked as read",
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Retry a failed notification.
 *
 * Resets the status to PENDING, re-attempts provider
 * delivery and updates the record to SENT or FAILED.
 */
export const retryNotificationById = async (
  req,
  res,
  next
) => {
  try {
    const notification =
      await retryNotification(req.params.id);

    return successResponse(res, {
      message: "Notification retried",
      data: {
        notification:
          notification.toSafeObject(),
      },
    });
  } catch (error) {
    next(error);
  }
};
