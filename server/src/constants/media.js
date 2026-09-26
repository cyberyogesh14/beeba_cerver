/**
 * Media constants shared across upload validation, storage and the
 * Media model.
 */

export const MEDIA_TYPE = Object.freeze({
  IMAGE: "image",
  VIDEO: "video",
});

/**
 * Media "category" — what a media item is used FOR on the live display.
 * Distinct from MEDIA_TYPE (image/video rendering format).
 *
 * - AD: the permanent left-panel advertisement (one active ad shown).
 * - REEL: the right-panel rotation content (REEL <-> LIVE QUEUE cycle).
 */
export const MEDIA_CATEGORY = Object.freeze({
  ADVERTISEMENT: "advertisement",
  REEL: "reel",
});

/**
 * MIME -> { type, extension } mapping. This is the ONLY source of truth
 * (never trust the client-supplied filename extension).
 */
export const MEDIA_MIME = Object.freeze({
  "image/jpeg": { type: MEDIA_TYPE.IMAGE, ext: "jpg" },
  "image/png": { type: MEDIA_TYPE.IMAGE, ext: "png" },
  "image/webp": { type: MEDIA_TYPE.IMAGE, ext: "webp" },
  "video/mp4": { type: MEDIA_TYPE.VIDEO, ext: "mp4" },
  "video/webm": { type: MEDIA_TYPE.VIDEO, ext: "webm" },
});

const envMegabytes = (name, fallbackMb) => {
  const parsed = Number(process.env[name]);
  const megabytes = Number.isFinite(parsed) && parsed > 0 ? parsed : fallbackMb;
  return megabytes * 1024 * 1024;
};

/**
 * Per-type size caps in bytes (configurable via MEDIA_MAX_IMAGE_MB /
 * MEDIA_MAX_VIDEO_MB).
 */
export const MEDIA_LIMITS = Object.freeze({
  image: envMegabytes("MEDIA_MAX_IMAGE_MB", 10),
  video: envMegabytes("MEDIA_MAX_VIDEO_MB", 200),
});

/**
 * Hard ceiling for a single multipart upload.
 *
 * This is only the outermost bound enforced while the body is still being
 * received (multer aborts the stream once it is passed). The real,
 * per-type limits above stay MEDIA_MAX_IMAGE_MB / MEDIA_MAX_VIDEO_MB and are
 * checked against the finished upload, so the ceiling must be the largest
 * of the two or a legitimately-sized video would be rejected early.
 */
export const MAX_UPLOAD_BYTES = Math.max(MEDIA_LIMITS.image, MEDIA_LIMITS.video);

/** Human-friendly labels for display in the admin UI. */
export const MEDIA_TYPE_LABEL = Object.freeze({
  image: "Image",
  video: "Video",
});