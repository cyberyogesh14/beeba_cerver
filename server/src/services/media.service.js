import { promises as fs } from "node:fs";

import Media from "../models/Media.js";

import {
  MEDIA_LIMITS,
  MEDIA_MIME,
  MEDIA_CATEGORY,
} from "../constants/media.js";
import {
  storeMediaFile,
  deleteMediaFile,
  getPublicBaseUrl,
} from "./providers/media.provider.js";
import { removeTempUpload } from "../utils/uploadTemp.js";
import { broadcastLiveQueueMedia } from "../sockets/broadcast.js";

const MAX_NAME_LENGTH = 120;
const MAX_DURATION_SECONDS = 86400;

/**
 * Byte size of the incoming upload without ever loading it into memory:
 * stat() on the temp file, or the legacy in-memory buffer's own length.
 */
const resolveUploadSize = async ({ filePath, buffer }) => {
  if (typeof buffer?.length === "number") return buffer.length;
  if (!filePath) return 0;
  const stats = await fs.stat(filePath);
  return stats.size;
};

export const listMedia = async () =>
  Media.find().sort({ sortOrder: 1, createdAt: 1 });

/** Active advertisements — permanent left-panel display. */
export const getActiveAdvertisements = async () => {
  const items = await Media.find({
    isActive: true,
    category: MEDIA_CATEGORY.ADVERTISEMENT,
  }).sort({ sortOrder: 1, createdAt: 1 });
  return items;
};

/** Active reels — the right-panel rotation playlist. */
export const getActiveReels = async () => {
  const items = await Media.find({
    isActive: true,
    category: MEDIA_CATEGORY.REEL,
  }).sort({ sortOrder: 1, createdAt: 1 });
  return items;
};

export const createMedia = async ({
  filePath,
  buffer,
  originalname,
  mimeType,
  category = MEDIA_CATEGORY.REEL,
  duration,
  uploadedBy,
  request,
}) => {
  // The temp file is this request's scratch space. Whatever happens below —
  // rejected MIME, size-limit failure, provider outage, a failed metadata
  // save, an unexpected throw — it must not outlive the request.
  try {
    const meta = MEDIA_MIME[mimeType];
    if (!meta) {
      throw Object.assign(
        new Error(
          "Unsupported file type. Allowed: JPG, JPEG, PNG, WEBP, MP4, WebM."
        ),
        { statusCode: 400 }
      );
    }

    // Prefer the on-disk size: it is the real uploaded byte count and costs
    // nothing to read, whereas buffer.length only exists on the legacy
    // in-memory path.
    const size = await resolveUploadSize({ filePath, buffer });

    const normalizedCategory =
      category === MEDIA_CATEGORY.ADVERTISEMENT ||
      category === MEDIA_CATEGORY.REEL
        ? category
        : MEDIA_CATEGORY.REEL;

    // Per-type cap: an image is never measured against the video limit.
    const maxBytes = MEDIA_LIMITS[meta.type];
    if (size > maxBytes) {
      throw Object.assign(
        new Error(
          `File exceeds the ${meta.type} size limit of ${Math.round(
            maxBytes / (1024 * 1024)
          )} MB.`
        ),
        { statusCode: 413 }
      );
    }

    const name = String(originalname || "")
      .trim()
      .slice(0, MAX_NAME_LENGTH);

    let stored;
    try {
      stored = await storeMediaFile({
        filePath,
        buffer,
        extension: meta.ext,
        mimeType,
        baseUrl: getPublicBaseUrl(request),
      });
    } catch (error) {
      // Storage failures (unwritable dir, provider outage, disk full) are
      // genuine server errors; the central handler logs the detail and
      // surfaces a safe generic message to the client.
      throw Object.assign(error, { statusCode: error.statusCode || 500 });
    }

    const { key, url, thumbnailUrl, duration: providerDuration } = stored;

    // Client-reported duration wins; otherwise fall back to what the
    // storage provider detected (Cloudinary reports real video duration).
    const parsedDuration =
      meta.type === "video"
        ? (typeof duration === "number" &&
            Number.isFinite(duration) &&
            duration > 0 &&
            Math.min(Math.round(duration), MAX_DURATION_SECONDS)) ||
          (typeof providerDuration === "number" &&
            Number.isFinite(providerDuration) &&
            providerDuration > 0 &&
            Math.min(Math.round(providerDuration), MAX_DURATION_SECONDS)) ||
          null
        : null;

    let sortOrder = 0;
    const last = await Media.findOne()
      .sort({ sortOrder: -1 })
      .select("sortOrder");
    if (last && typeof last.sortOrder === "number") {
      sortOrder = last.sortOrder + 1;
    }

    let media;
    try {
      media = await Media.create({
        category: normalizedCategory,
        name: name || `Uploaded ${meta.type}`,
        type: meta.type,
        url,
        thumbnailUrl: thumbnailUrl || null,
        storageKey: key,
        mimeType,
        size,
        duration: parsedDuration,
        isActive: false,
        sortOrder,
        uploadedBy: uploadedBy ?? null,
      });
    } catch (error) {
      // The binary is already on disk/cloud but the metadata save failed;
      // remove the stored object so a crash never leaves an orphan file.
      try {
        await deleteMediaFile({ key, mimeType });
      } catch {
        // Best-effort cleanup only.
      }
      throw error;
    }

    await broadcastMediaChanged();
    return media;
  } finally {
    await removeTempUpload(filePath);
  }
};

export const updateMedia = async (id, data) => {
  const media = await Media.findById(id);
  if (!media) {
    throw Object.assign(new Error("Media not found"), { statusCode: 404 });
  }

  if (data.name !== undefined) {
    const name = String(data.name).trim();
    if (!name) {
      throw Object.assign(new Error("Media name cannot be empty"), {
        statusCode: 400,
      });
    }
    media.name = name.slice(0, MAX_NAME_LENGTH);
  }

  if (typeof data.isActive === "boolean") {
    media.isActive = data.isActive;
  }

  if (
    data.category === MEDIA_CATEGORY.ADVERTISEMENT ||
    data.category === MEDIA_CATEGORY.REEL
  ) {
    media.category = data.category;
  }

  await media.save();
  await broadcastMediaChanged();
  return media;
};

export const reorderMedia = async (orderedIds) => {
  const ids = [...new Set((orderedIds || []).map((id) => String(id)))];
  if (ids.length === 0) {
    throw Object.assign(new Error("Reorder list cannot be empty"), {
      statusCode: 400,
    });
  }

  const total = await Media.countDocuments();
  if (ids.length !== total) {
    throw Object.assign(new Error("Reorder list must include every media item"), {
      statusCode: 400,
    });
  }

  await Promise.all(
    ids.map((id, index) =>
      Media.updateOne({ _id: id }, { $set: { sortOrder: index } })
    )
  );

  await broadcastMediaChanged();
  return Media.find().sort({ sortOrder: 1, createdAt: 1 });
};

export const deleteMedia = async (id) => {
  const media = await Media.findById(id);
  if (!media) {
    throw Object.assign(new Error("Media not found"), { statusCode: 404 });
  }

  try {
    await deleteMediaFile({ key: media.storageKey, mimeType: media.mimeType });
  } catch (error) {
    // Deleting the database record must succeed even if the stored
    // object is missing or a provider hiccups.
    // eslint-disable-next-line no-console
    console.warn("[media] storage delete failed:", error.message);
  }

  await media.deleteOne();
  await broadcastMediaChanged();
  return media;
};

/**
 * Best-effort push of the current active playlist to every connected
 * client (admin preview + live displays) so they adapt without a
 * manual refresh. Never fails the originating mutation.
 */
const broadcastMediaChanged = async () => {
  try {
    const [ads, reels] = await Promise.all([
      getActiveAdvertisements(),
      getActiveReels(),
    ]);
    broadcastLiveQueueMedia({
      advertisements: ads.map((item) => item.toSafeObject()),
      reels: reels.map((item) => item.toSafeObject()),
    });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn("[media] broadcast skipped:", error.message);
  }
};