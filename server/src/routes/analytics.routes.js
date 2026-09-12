import { Router } from "express";

import {
  getAnalyticsOverview,
  getAnalyticsServices,
  getAnalyticsHourly,
  getAnalyticsCounters,
  getFullDashboard,
} from "../controllers/analytics.controller.js";

import { authenticate } from "../middleware/auth.middleware.js";
import { authorizeRoles } from "../middleware/role.middleware.js";

const router = Router();

router.use(authenticate, authorizeRoles("admin"));

router.get("/overview", getAnalyticsOverview);

router.get("/services", getAnalyticsServices);

router.get("/hourly", getAnalyticsHourly);

router.get("/counters", getAnalyticsCounters);

router.get("/dashboard", getFullDashboard);

export default router;
