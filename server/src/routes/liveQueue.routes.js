import { Router } from "express";

import {
  getLiveQueueSettingsController,
  getLiveQueueStateController,
  updateLiveQueueSettingsController,
} from "../controllers/liveQueue.controller.js";
import { authenticate } from "../middleware/auth.middleware.js";
import { authorizeRoles } from "../middleware/role.middleware.js";

const router = Router();

// Public — the live display reads its configuration and active
// playlist from these endpoints. No admin/private data is included.
router.get("/state", getLiveQueueStateController);
router.get("/settings", getLiveQueueSettingsController);

// Admin-only configuration updates.
router.patch(
  "/settings",
  authenticate,
  authorizeRoles("admin"),
  updateLiveQueueSettingsController
);

export default router;