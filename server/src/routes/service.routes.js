import { Router } from "express";

import {
  listServices,
  getSingleService,
  createNewService,
  updateExistingService,
  removeService,
} from "../controllers/service.controller.js";

import { authenticate } from "../middleware/auth.middleware.js";
import { authorizeRoles } from "../middleware/role.middleware.js";

const router = Router();

// Public: customers fetch active services when booking a token.
router.get("/", listServices);

router.get(
  "/:id",
  authenticate,
  getSingleService
);

router.post(
  "/",
  authenticate,
  authorizeRoles("admin"),
  createNewService
);

router.put(
  "/:id",
  authenticate,
  authorizeRoles("admin"),
  updateExistingService
);

router.delete(
  "/:id",
  authenticate,
  authorizeRoles("admin"),
  removeService
);

export default router;