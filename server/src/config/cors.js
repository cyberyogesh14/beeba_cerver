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