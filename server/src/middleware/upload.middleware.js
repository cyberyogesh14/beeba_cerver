import multer from "multer";

import { MAX_UPLOAD_BYTES, MEDIA_MIME } from "../constants/media.js";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_UPLOAD_BYTES,
    files: 1,
  },
  fileFilter: (req, file, cb) => {
    const meta = MEDIA_MIME[file.mimetype];
    if (!meta) {
      return cb(
        Object.assign(
          new Error(
            "Unsupported file type. Allowed: JPG, JPEG, PNG, WEBP, MP4, WebM."
          ),
          { statusCode: 400 }
        )
      );
    }
    return cb(null, true);
  },
});

/**
 * Multer `.single("file")` wrapper that normalizes Multer errors into
 * status-bearing errors for the central error handler.
 */
export const uploadMediaFile = (req, res, next) => {
  upload.single("file")(req, res, (error) => {
    if (!error) return next();

    if (error instanceof multer.MulterError) {
      if (error.code === "LIMIT_FILE_SIZE") {
        return next(
          Object.assign(new Error("File is too large for the allowed limit"), {
            statusCode: 413,
          })
        );
      }
      return next(
        Object.assign(new Error(`Upload error: ${error.message}`), {
          statusCode: 400,
        })
      );
    }

    return next(error);
  });
};