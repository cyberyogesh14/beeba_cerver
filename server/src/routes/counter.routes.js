import { Router } from "express";

import {
  listCounters,
  getSingleCounter,
  createNewCounter,
  updateExistingCounter,
  removeCounter,
} from "../controllers/counter.controller.js";

import { authenticate } from "../middleware/auth.middleware.js";
import { authorizeRoles } from "../middleware/role.middleware.js";

const router = Router();

router.get("/", authenticate, listCounters);

router.get(
  "/:id",
  authenticate,
  getSingleCounter
);

router.post(
  "/",
  authenticate,
  authorizeRoles("admin"),
  createNewCounter
);

router.put(
  "/:id",
  authenticate,
  authorizeRoles("admin"),
  updateExistingCounter
);

router.delete(
  "/:id",
  authenticate,
  authorizeRoles("admin"),
  removeCounter
);

export default router;