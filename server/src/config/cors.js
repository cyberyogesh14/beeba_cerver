/**
 * Resolve the list of allowed CORS origins from the
 * environment configuration.
 *
 * Supports both conventions:
 *   - CLIENT_URLS  (comma-separated list, preferred)
 *   - CLIENT_URL   (single origin, legacy)
 *
 * Returned origins are deduplicated and normalized
 * (trailing slashes stripped) for exact matching.
 *
 * Native mobile apps (React Native, Expo Go) do NOT send
 * an Origin header, so the "no origin" branch in the CORS
 * middleware already permits them without listing origins
 * here.  This list only governs browser-based clients that
 * DO send an Origin header (web app, Expo Web dev server).
 */
export const getCorsOrigins = () => {
  const sources = [
    process.env.CLIENT_URLS,
    process.env.CLIENT_URL,
  ];

  const origins = sources
    .filter(Boolean)
    .flatMap((value) => value.split(","))
    .map((origin) => origin.trim().replace(/\/+$/, ""))
    .filter(Boolean);

  return [...new Set(origins)];
};