import { Router } from "express";

import {
  createNewToken,
  getSingleToken,
  lookupTokensByEmail,
  listTokens,
  getNextToken,
  listQueue,
  callExistingToken,
  preCallExistingToken,
  recallExistingToken,
  startExistingToken,
  completeExistingToken,
  skipExistingToken,
  cancelExistingToken,
  noShowExistingToken,
  getPublicQueue,
} from "../controllers/token.controller.js";

import { authenticate } from "../middleware/auth.middleware.js";
import { authorizeRoles } from "../middleware/role.middleware.js";

const router = Router();

// Public: customer generates a token.
router.post(
  "/",
  createNewToken
);

// Staff/admin: list tokens with filtering and pagination.
router.get(
  "/",
  authenticate,
  authorizeRoles("staff", "admin"),
  listTokens
);

// Staff: view the waiting queue.
router.get(
  "/queue",
  authenticate,
  authorizeRoles("staff", "admin"),
  listQueue
);

// Staff: get next eligible waiting token across all services.
router.get(
  "/next",
  authenticate,
  authorizeRoles("staff", "admin"),
  getNextToken
);

// Staff/admin: queue process actions.
router.post(
  "/:id/call",
  authenticate,
  authorizeRoles("staff", "admin"),
  callExistingToken
);

// Staff/admin: send the pre-call ("you're up soon") email now.
router.post(
  "/:id/pre-call",
  authenticate,
  authorizeRoles("staff", "admin"),
  preCallExistingToken
);

router.post(
  "/:id/recall",
  authenticate,
  authorizeRoles("staff", "admin"),
  recallExistingToken
);

router.post(
  "/:id/start",
  authenticate,
  authorizeRoles("staff", "admin"),
  startExistingToken
);

router.post(
  "/:id/complete",
  authenticate,
  authorizeRoles("staff", "admin"),
  completeExistingToken
);

router.post(
  "/:id/skip",
  authenticate,
  authorizeRoles("staff", "admin"),
  skipExistingToken
);

// Public: a customer cancels their own WAITING booking using the
// token id as the bearer proof (same trust model as GET /:id).
// Staff/admin are also permitted and, when authenticated, the
// action is recorded against their account.
router.post(
  "/:id/cancel",
  cancelExistingToken
);

// Staff/admin: mark a CALLED token as a no-show.
router.post(
  "/:id/no-show",
  authenticate,
  authorizeRoles("staff", "admin"),
  noShowExistingToken
);

// Public: current live queue (serving + waiting).
// Must be declared before the general "/:id" route below.
router.get(
  "/public-queue",
  getPublicQueue
);

// Public: customer looks up all their tokens by email.
// Must be declared before the general "/:id" route below.
router.get(
  "/lookup",
  lookupTokensByEmail
);

// Public: customer tracks their token.
router.get(
  "/:id",
  getSingleToken
);

export default router;
