import { Router } from "express";

import {
  getCustomerByPhone,
  listCustomers,
  getCustomerById,
  getCustomerTokens,
} from "../controllers/customer.controller.js";

import { authenticate } from "../middleware/auth.middleware.js";
import { authorizeRoles } from "../middleware/role.middleware.js";

const router = Router();

router.get(
  "/phone/:phone",
  authenticate,
  authorizeRoles("admin", "staff"),
  getCustomerByPhone
);

// Admin catalog: list/search customers, view a customer's details
// and their token history. Route order matters: /phone/:phone is
// declared before /:id so "phone" is never captured as an id.
router.get(
  "/",
  authenticate,
  authorizeRoles("admin"),
  listCustomers
);

router.get(
  "/:id",
  authenticate,
  authorizeRoles("admin"),
  getCustomerById
);

router.get(
  "/:id/tokens",
  authenticate,
  authorizeRoles("admin"),
  getCustomerTokens
);

export default router;