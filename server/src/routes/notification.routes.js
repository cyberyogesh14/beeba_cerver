import { Router } from "express";

import {
  listRecipientNotifications,
  listCustomerNotifications,
  listTokenNotifications,
  getSingleNotification,
  getUnreadCount,
  markRead,
  markAllRead,
  retryNotificationById,
} from "../controllers/notification.controller.js";

import { authenticate } from "../middleware/auth.middleware.js";
import { authorizeRoles } from "../middleware/role.middleware.js";

const router = Router();

// Authenticated staff/admin notification inbox.
router.get(
  "/",
  authenticate,
  authorizeRoles("staff", "admin"),
  listRecipientNotifications
);

router.get(
  "/unread/count",
  authenticate,
  authorizeRoles("staff", "admin"),
  getUnreadCount
);

router.patch(
  "/read",
  authenticate,
  authorizeRoles("staff", "admin"),
  markRead
);

router.patch(
  "/read-all",
  authenticate,
  authorizeRoles("staff", "admin"),
  markAllRead
);

// Public: customer tracking screen fetches its own
// notifications using the customer id from its token.
//
// SECURITY NOTE: This endpoint is intentionally public
// because customers are accountless by design.  However,
// anyone who knows a customer's MongoDB ObjectId can
// enumerate their notifications.  A full mitigation
// requires a token-based access key embedded in the
// customer's tracking URL (e.g. /track/:tokenNumber/:key)
// so the customerId alone is not sufficient.  This should
// be implemented when the frontend tracking page is built.
router.get(
  "/customer/:customerId",
  listCustomerNotifications
);

// Admin: notifications related to a token.
router.get(
  "/token/:tokenId",
  authenticate,
  authorizeRoles("admin"),
  listTokenNotifications
);

// Staff/admin: retry a failed notification delivery.
router.post(
  "/:id/retry",
  authenticate,
  authorizeRoles("staff", "admin"),
  retryNotificationById
);

router.get(
  "/:id",
  authenticate,
  authorizeRoles("staff", "admin"),
  getSingleNotification
);

export default router;
