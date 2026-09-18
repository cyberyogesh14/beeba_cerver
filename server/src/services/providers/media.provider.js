/**
 * Media storage abstraction.
 *
 * The provider is chosen via MEDIA_STORAGE_DRIVER (default "local").
 *
 * "local"     — stores files under server/uploads/media and serves them
 *               via express.static at GET /uploads/media/<key>.
 * "cloudinary" — stores the binary in a Cloudinary media library and
 *               serves it from the Cloudinary CDN. Image uploads also
 *               get an auto-generated thumbnailUrl (w_400 q_auto). Video
 *               uploads get a poster frame thumbnail, and duration is
 *               read back from Cloudinary as a fallback.
 *
 * To add another provider implement the same { store, remove } contract,
 * register it in the `drivers` map and configure it through environment
 * variables. `store` may additionally return `thumbnailUrl` and
 * `duration`. The Media model only ever stores the metadata returned
 * here — never the binary.
 */
import { randomUUID } from "crypto";
import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import cloudinaryLib from "cloudinary";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DEFAULT_ROOT = path.resolve(__dirname, "../../../uploads");

export const getUploadsRoot = () =>
  path.resolve(process.env.MEDIA_UPLOAD_DIR || DEFAULT_ROOT);

export const getPublicBaseUrl = () =>
  (process.env.PUBLIC_API_URL || "http://localhost:5002").replace(/\/+$/, "");

const localDriver = {
  async store({ buffer, extension }) {
    const dir = path.join(getUploadsRoot(), "media");
    await fs.mkdir(dir, { recursive: true });

    // Random filename kills path traversal and guessable URLs; the
    // client-provided name is never used on disk.
    const key = `${randomUUID()}.${extension}`;
    await fs.writeFile(path.join(dir, key), buffer);

    return {
      key,
      url: `${getPublicBaseUrl()}/uploads/media/${key}`,
    };
  },

  async remove({ key }) {
    if (!key) return;
    try {
      await fs.unlink(path.join(getUploadsRoot(), "media", key));
    } catch (error) {
      // A missing file is fine (already deleted or never stored).
      if (error.code !== "ENOENT") throw error;
    }
  },
};

const getCloudinaryConfig = () => {
  const cloud_name = process.env.CLOUDINARY_CLOUD_NAME;
  const api_key = process.env.CLOUDINARY_API_KEY;
  const api_secret = process.env.CLOUDINARY_API_SECRET;

  if (!cloud_name || !api_key || !api_secret) {
    throw Object.assign(
      new Error(
        "Cloudinary is the active MEDIA_STORAGE_DRIVER but CLOUDINARY_CLOUD_NAME / CLOUDINARY_API_KEY / CLOUDINARY_API_SECRET are not set. Fill them in server/.env and restart."
      ),
      { statusCode: 500 }
    );
  }

  return { cloud_name, api_key, api_secret, secure: true };
};

const getCloudinary = () => {
  const cloudinary = cloudinaryLib.v2;
  cloudinary.config(getCloudinaryConfig());
  return cloudinary;
};

const cloudinaryDriver = {
  /**
   * Uploads the buffer with the server-side SDK so the upload is signed and
   * the API key/secret never leak from the server. Returns the public_id as
   * the storage key (used later to destroy the asset).
   */
  async store({ buffer, mimeType }) {
    const cloudinary = getCloudinary();
    const resource_type = mimeType?.startsWith("video/") ? "video" : "image";

    const result = await new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        {
          folder: process.env.CLOUDINARY_FOLDER || "beeba/live-queue",
          resource_type,
          // Public IDs are random UUIDs so media URLs are unguessable; the
          // client-provided filename is never used.
          public_id: randomUUID(),
        },
        (error, uploadResult) => (error ? reject(error) : resolve(uploadResult))
      );
      stream.end(buffer);
    });

    const key = result.public_id;
    const url = result.secure_url;

    // Library thumbnails come from Cloudinary on-the-fly transformations so
    // the admin list never downloads full-size originals.
    const thumbnailUrl =
      resource_type === "image"
        ? cloudinary.url(key, {
            resource_type,
            width: 400,
            height: 400,
            crop: "fit",
            quality: "auto",
            fetch_format: "auto",
            secure: true,
          })
        : cloudinary.url(key, {
            resource_type: "video",
            width: 400,
            height: 300,
            crop: "fit",
            quality: "auto",
            fetch_format: "auto",
            secure: true,
          });

    return {
      key,
      url,
      thumbnailUrl,
      // Cloudinary reports real duration for video uploads (seconds);
      // used as a fallback when the client did not probe one.
      duration: resource_type === "video" ? result.duration : undefined,
    };
  },

  async remove({ key, mimeType }) {
    if (!key) return;
    const cloudinary = getCloudinary();
    const resource_type = mimeType?.startsWith("video/") ? "video" : "image";
    await new Promise((resolve, reject) => {
      cloudinary.uploader.destroy(
        key,
        { resource_type },
        (error, response) => (error ? reject(error) : resolve(response))
      );
    });
  },
};

const drivers = {
  local: localDriver,
  cloudinary: cloudinaryDriver,
};

const getDriver = () => {
  const name = process.env.MEDIA_STORAGE_DRIVER || "local";
  const driver = drivers[name];
  if (!driver) {
    throw Object.assign(
      new Error(
        `MEDIA_STORAGE_DRIVER "${name}" is not configured. Supported: local, cloudinary.`
      ),
      { statusCode: 500 }
    );
  }
  return driver;
};

export const storeMediaFile = (input) => getDriver().store(input);

export const deleteMediaFile = (input) => getDriver().remove(input);