import { randomUUID } from "node:crypto";

import multer from "multer";

import { MEDIA_MIME, MAX_UPLOAD_BYTES } from "../constants/media.js";
import { ensureUploadTmpDir } from "../utils/uploadTemp.js";

/**
 * Upload middleware.
 *
 * Files are streamed to a temporary directory on disk (never into a Node
 * Buffer) so uploading a 2 GB video costs a constant amount of RAM. The
 * temp file is streamed to Cloudinary by the storage provider and then
 * deleted by the service/controller; uploads/media is only written by the
 * local driver.
 */
const ALLOWED = new Set(Object.keys(MEDIA_MIME));

/**
 * Multipart framing (boundaries, part headers) adds a few hundred bytes on
 * top of the file, so the Content-Length pre-check allows a small slack
 * before refusing a request outright.
 */
const MULTIPART_OVERHEAD_SLACK_BYTES = 64 * 1024;

const storage = multer.diskStorage({
  // uploads/tmp only. Created on demand so the folder is safe to delete
  // between restarts and still self-heals on the first upload.
  destination: (req, file, cb) => {
    ensureUploadTmpDir().then(
      (dir) => cb(null, dir),
      (error) => cb(error)
    );
  },
  filename: (req, file, cb) => {
    // Random filename — the client-provided name is never used on disk.
    // The extension comes from the validated MIME map, not from the request.
    const ext = MEDIA_MIME[file.mimetype]?.ext || "bin";
    cb(null, `${randomUUID()}.${ext}`);
  },
});

const fileFilter = (req, file, cb) => {
  if (ALLOWED.has(file.mimetype)) return cb(null, true);

  return cb(
    Object.assign(
      new Error("Unsupported file type. Allowed: JPG, JPEG, PNG, WEBP, MP4, WebM."),
      { statusCode: 400 }
    )
  );
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    // Hard ceiling only. The per-type caps (MEDIA_MAX_IMAGE_MB /
    // MEDIA_MAX_VIDEO_MB) are enforced separately against the file on disk
    // so an image is never measured against the (much larger) video limit.
    fileSize: MAX_UPLOAD_BYTES,
    files: 1,
  },
});

// Same wording as the per-type message in the media service, so the client
// sees one consistent error family.
const tooLargeMessage = () =>
  `File exceeds the maximum upload size limit of ${Math.round(
    MAX_UPLOAD_BYTES / (1024 * 1024)
  )} MB.`;

/**
 * Multer reports problems through next(err) rather than a thrown error, so
 * they are translated here into the same { success, message } envelope the
 * rest of the API uses:
 *   - LIMIT_FILE_SIZE            -> 413
 *   - other multer/busboy errors -> 400 (bad field, malformed multipart)
 * Anything else (e.g. an unwritable temp dir) keeps its own status so the
 * central handler still reports it as a genuine 500.
 */
const withUploadStatus = (error) => {
  if (
    Number.isInteger(error?.statusCode) &&
    error.statusCode >= 400 &&
    error.statusCode < 500
  ) {
    return error;
  }

  if (error?.code === "LIMIT_FILE_SIZE") {
    return Object.assign(new Error(tooLargeMessage()), { statusCode: 413 });
  }

  const isMalformedMultipart =
    /Unexpected end of form|Unexpected end of multipart/i.test(
      error?.message || ""
    );

  if (error?.name === "MulterError" || isMalformedMultipart) {
    return Object.assign(
      new Error("Malformed or invalid multipart upload request."),
      { statusCode: 400 }
    );
  }

  return error;
};

export const uploadMediaFile = (req, res, next) => {
  // Cheap early rejection: refuse a declared body that is larger than the
  // ceiling before reading a single byte, so an oversized upload never
  // reaches the disk. Bodies without Content-Length (chunked) are still
  // bounded by multer's fileSize limit.
  const declaredLength = Number(req.headers["content-length"]);
  if (
    Number.isFinite(declaredLength) &&
    declaredLength > MAX_UPLOAD_BYTES + MULTIPART_OVERHEAD_SLACK_BYTES
  ) {
    return res
      .status(413)
      .json({ success: false, message: tooLargeMessage() });
  }

  return upload.single("file")(req, res, (error) => {
    if (error) return next(withUploadStatus(error));
    return next();
  });
};
