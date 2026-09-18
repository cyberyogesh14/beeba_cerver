import { Router } from "express";

import {
  signup,
  login,
  logout,
  getCurrentUser,
} from "../controllers/auth.controller.js";

import { authenticate } from "../middleware/auth.middleware.js";

const router = Router();

// Self-registration. Always creates a CUSTOMER-role account.
router.post("/signup", signup);

router.post("/login", login);

router.post("/logout", authenticate, logout);

router.get("/me", authenticate, getCurrentUser);

export default router;