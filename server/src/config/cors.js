/**
 * Resolve the list of allowed CORS origins.
 *
 * Sources (merged, in this order of precedence):
 *   1. Canonical default origins (always included so the deployed
 *      production frontends keep working even if env is incomplete):
 *      the customer site, its apex/HTTPS variants and the admin site.
 *   2. CLIENT_URLS  (comma-separated list, preferred)
 *   3. CLIENT_URL   (single origin, legacy)
 *   4. CORS_ORIGINS (comma-separated, optional extra list)
 *
 * Returned origins are deduplicated and normalized
 * (trailing slashes stripped) for exact matching.
 *
 * Native mobile apps (React Native, Expo Go) do NOT send
 * an Origin header, so the "no origin" branch in the shared
 * origin callback already permits them without listing origins
 * here.  This list only governs browser-based clients that
 * DO send an Origin header (web app, Expo Web dev server).
 */
const DEFAULT_ORIGINS = [
  "https://www.beebaboys.tech",
  "https://beebaboys.tech",
  "https://admin.beebaboys.tech",
  "https://queqebeebaboys.vercel.app",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:5174",
  "http://127.0.0.1:5174",
  "http://localhost:8081",
  "http://localhost:19006",
];

const normalizeOrigins = (values) =>
  values
    .flatMap((value) => value.split(","))
    .map((origin) => origin.trim().replace(/\/+$/, ""))
    .filter(Boolean);

export const getCorsOrigins = () => {
  const sources = [
    process.env.CLIENT_URLS,
    process.env.CLIENT_URL,
    process.env.CORS_ORIGINS,
  ];

  const origins = normalizeOrigins(sources.filter(Boolean));

  return [...new Set([...DEFAULT_ORIGINS, ...origins])];
};

/**
 * Shared CORS origin callback used by BOTH the REST cors middleware
 * and the Socket.IO server so the rules never drift apart.
 *
 * Requests with no Origin header (curl, native mobile apps, same-origin
 * fetches) are allowed. Disallowed origins are rejected with a 403
 * (instead of a hanging preflight or a misleading 500), and the error
 * handler surfaces "Origin not allowed by CORS" to the client.
 */
export const corsOriginCheck = (origin, callback) => {
  if (!origin || getCorsOrigins().includes(origin)) {
    return callback(null, true);
  }

  const error = new Error("Origin not allowed by CORS");
  error.statusCode = 403;
  return callback(error, false);
};