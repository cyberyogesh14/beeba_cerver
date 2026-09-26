/**
 * Temporary upload-file helpers.
 *
 * Multipart uploads are streamed straight to disk so a 2 GB video is never
 * held in Node process RAM. A file lives in <MEDIA_UPLOAD_DIR>/tmp for the
 * lifetime of a single request and is removed the moment the storage
 * provider has the bytes (or the request fails). The permanent folder
 * (uploads/media) is written only by the local storage driver.
 *
 * Every helper here is deliberately narrow: the temp dir is created on
 * demand, removal is idempotent + restricted to the temp dir, and the boot
 * sweep only ever touches files directly inside uploads/tmp (never
 * uploads/media, never a nested path).
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DEFAULT_ROOT = path.resolve(__dirname, "../../../uploads");

/** Sub-folder holding in-flight multipart uploads. */
export const UPLOAD_TMP_DIR_NAME = "tmp";

/**
 * A temp file older than this is an orphan left behind by a crash or a hard
 * restart, and is swept at boot. One hour is far longer than any real
 * request, so an in-flight upload is never deleted underneath itself.
 */
export const STALE_TMP_MAX_AGE_MS = 60 * 60 * 1000;

export const getUploadsRoot = () =>
  path.resolve(process.env.MEDIA_UPLOAD_DIR || DEFAULT_ROOT);

export const getUploadTmpDir = () =>
  path.join(getUploadsRoot(), UPLOAD_TMP_DIR_NAME);

/** Memoised mkdir - the temp dir is created once per resolved path. */
let ensuredDir = null;
let ensuredPromise = null;

/**
 * Creates uploads/tmp if missing. Safe to call per request; a failed mkdir
 * is not cached so a later request can retry (e.g. fixed permissions).
 */
export const ensureUploadTmpDir = async () => {
  const dir = getUploadTmpDir();
  if (ensuredDir === dir && ensuredPromise) return ensuredPromise;

  const promise = fs
    .mkdir(dir, { recursive: true })
    .then(() => dir)
    .catch((error) => {
      if (ensuredDir === dir) {
        ensuredDir = null;
        ensuredPromise = null;
      }
      throw error;
    });

  ensuredDir = dir;
  ensuredPromise = promise;
  return promise;
};

/**
 * Deletes a temp upload. Idempotent (safe to call twice for the same file,
 * which happens when both the controller and the service clean up) and
 * path-guarded: anything outside uploads/tmp is ignored, so a crafted
 * request field can never make the server unlink an arbitrary file.
 */
export const removeTempUpload = async (filePath) => {
  if (!filePath) return;

  const target = path.resolve(String(filePath));
  if (path.dirname(target) !== getUploadTmpDir()) return;

  try {
    await fs.rm(target, { force: true });
  } catch (error) {
    if (error.code !== "ENOENT") {
      // eslint-disable-next-line no-console
      console.warn("[media] temp cleanup failed:", error.message);
    }
  }
};

/**
 * Boot-time sweep for temp files orphaned by a crash/restart. Removes only
 * files directly inside uploads/tmp older than `maxAgeMs`; uploads/media is
 * never touched. Returns how many files were removed. Never throws.
 */
export const cleanupStaleUploads = async (
  maxAgeMs = STALE_TMP_MAX_AGE_MS
) => {
  const dir = getUploadTmpDir();

  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return 0;
    throw error;
  }

  const cutoff = Date.now() - maxAgeMs;
  let removed = 0;

  for (const entry of entries) {
    if (!entry.isFile()) continue;

    const filePath = path.join(dir, entry.name);
    try {
      const stats = await fs.stat(filePath);
      if (stats.mtimeMs >= cutoff) continue;
      await fs.rm(filePath, { force: true });
      removed += 1;
    } catch {
      // Best effort: a file that vanished or is locked is simply skipped.
    }
  }

  return removed;
};
