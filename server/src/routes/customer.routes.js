import { Router } from "express";

import {
  getCustomerByPhone,
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

export default router;