import Media from "../models/Media.js";

import { MEDIA_LIMITS, MEDIA_MIME } from "../constants/media.js";
import {
  storeMediaFile,
  deleteMediaFile,
  getPublicBaseUrl,
} from "./providers/media.provider.js";
import { broadcastLiveQueueMedia } from "../sockets/broadcast.js";

const MAX_NAME_LENGTH = 120;
const MAX_DURATION_SECONDS = 86400;

export const listMedia = async () =>
  Media.find().sort({ sortOrder: 1, createdAt: 1 });

export const getActiveMedia = () =>
  Media.find({ isActive: true }).sort({ sortOrder: 1 });

export const createMedia = async ({
  buffer,
  originalname,
  mimeType,
  duration,
  uploadedBy,
  request,
}) => {
  const meta = MEDIA_MIME[mimeType];
  if (!meta) {
    throw Object.assign(
      new Error(
        "Unsupported file type. Allowed: JPG, JPEG, PNG, WEBP, MP4, WebM."
      ),
      { statusCode: 400 }
    );
  }

  const maxBytes = MEDIA_LIMITS[meta.type];
  if (buffer.length > maxBytes) {
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
  const last = await Media.findOne().sort({ sortOrder: -1 }).select("sortOrder");
  if (last && typeof last.sortOrder === "number") {
    sortOrder = last.sortOrder + 1;
  }

  let media;
  try {
    media = await Media.create({
      name: name || `Uploaded ${meta.type}`,
      type: meta.type,
      url,
      thumbnailUrl: thumbnailUrl || null,
      storageKey: key,
      mimeType,
      size: buffer.length,
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
    const active = await getActiveMedia();
    broadcastLiveQueueMedia({
      media: active.map((item) => item.toSafeObject()),
    });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn("[media] broadcast skipped:", error.message);
  }
};