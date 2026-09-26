import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import cookieParser from "cookie-parser";

import authRoutes from "./routes/auth.routes.js";
import userRoutes from "./routes/user.routes.js";
import serviceRoutes from "./routes/service.routes.js";
import tokenRoutes from "./routes/token.routes.js";
import customerRoutes from "./routes/customer.routes.js";
import notificationRoutes from "./routes/notification.routes.js";
import analyticsRoutes from "./routes/analytics.routes.js";
import mediaRoutes from "./routes/media.routes.js";
import liveQueueRoutes from "./routes/liveQueue.routes.js";

import {
  notFoundHandler,
  errorHandler,
} from "./middleware/error.middleware.js";

import { corsOriginCheck } from "./config/cors.js";
import {
  cleanupStaleUploads,
  getUploadsRoot,
  initMediaStorage,
} from "./services/providers/media.provider.js";

const app = express();

app.disable("x-powered-by");

// The app is served exclusively through a single Nginx reverse proxy on
// the same host (http://127.0.0.1:5000). Trust the X-Forwarded-For header
// only when the direct peer is loopback so that:
//   * express-rate-limit / req.ip see the real client IP (not 127.0.0.1),
//   * a direct connection to :5000 that bypasses Nginx is never trusted,
//   * the express-rate-limit X-Forwarded-For validation stops firing.
app.set("trust proxy", "loopback");

app.use(helmet());

app.use(
  cors({
    origin: corsOriginCheck,
    credentials: true,
    methods: [
      "GET",
      "POST",
      "PUT",
      "PATCH",
      "DELETE",
      "OPTIONS",
    ],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

// General API limiter: generous enough for many customers
// and staff using the queue simultaneously, while still
// protecting the API from flood abuse.
app.use(
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 300,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      success: false,
      message:
        "Too many requests, please try again later",
    },
  })
);

// Stricter limiter for authentication endpoints to
// hinder credential brute-force attempts.
app.use(
  "/api/auth",
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      success: false,
      message:
        "Too many login attempts, please try again later",
    },
  })
);

app.use(express.json({ limit: "10kb" }));

app.use(
  express.urlencoded({
    extended: true,
    limit: "10kb",
  })
);

app.use(cookieParser());

// Uploaded media (images/videos) must be embeddable by the live display
// and admin preview even when they run on a different origin, so override
// helmet's CORP "same-origin" for the /uploads subtree only.
app.use("/uploads", (req, res, next) => {
  res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
  next();
});
app.use(
  "/uploads",
  express.static(getUploadsRoot(), {
    index: false,
    fallthrough: true,
  })
);

app.get("/api/health", (req, res) => {
  res.status(200).json({
    success: true,
    message: "Beeba Queue Management API is running",
    environment: process.env.NODE_ENV,
    timestamp: new Date().toISOString(),
  });
});

app.use("/api/auth", authRoutes);

app.use("/api/users", userRoutes);

app.use("/api/services", serviceRoutes);

app.use("/api/tokens", tokenRoutes);

app.use("/api/customers", customerRoutes);

app.use("/api/notifications", notificationRoutes);

app.use("/api/analytics", analyticsRoutes);

app.use("/api/media", mediaRoutes);

app.use("/api/live-queue", liveQueueRoutes);

app.use(notFoundHandler);

app.use(errorHandler);

// Boot-time upload-storage self-check (probes the local driver's directory
// for existence + write access and logs a clear warning). Async by design:
// it never blocks the HTTP server from starting.
void initMediaStorage();

// Sweep temp uploads orphaned by a crash or hard restart. A process that
// died mid-upload leaves its file in uploads/tmp; anything older than an
// hour can never belong to an in-flight request. uploads/media is never
// touched.
void cleanupStaleUploads().then(
  (removed) => {
    if (removed > 0) {
      console.log(`[media] removed ${removed} stale temp upload(s) at boot`);
    }
  },
  (error) => {
    console.warn("[media] stale temp cleanup skipped:", error.message);
  }
);

export default app;