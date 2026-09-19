import {
  listMedia,
  createMedia,
  updateMedia,
  reorderMedia,
  deleteMedia,
} from "../services/media.service.js";
import { successResponse } from "../utils/apiResponse.js";

export const listMediaItems = async (req, res, next) => {
  try {
    const media = await listMedia();
    return successResponse(res, {
      message: "Media retrieved successfully",
      data: { media: media.map((item) => item.toSafeObject()) },
    });
  } catch (error) {
    next(error);
  }
};

export const uploadNewMedia = async (req, res, next) => {
  try {
    if (!req.file) {
      return res
        .status(400)
        .json({ success: false, message: "No file uploaded" });
    }

    const rawDuration = req.body?.duration;
    const duration =
      rawDuration !== undefined && rawDuration !== ""
        ? Number(rawDuration)
        : null;

    if (duration !== null && (!Number.isFinite(duration) || duration <= 0)) {
      return res
        .status(400)
        .json({ success: false, message: "Duration must be a positive number" });
    }

    const media = await createMedia({
      buffer: req.file.buffer,
      originalname: req.file.originalname,
      mimeType: req.file.mimetype,
      category: req.body?.category,
      duration,
      uploadedBy: req.user?._id,
      // Used to build public media URLs that resolve from the outside
      // (request origin when PUBLIC_API_URL is missing/dev in production).
      request: req,
    });

    return successResponse(res, {
      statusCode: 201,
      message: "Media uploaded successfully",
      data: { media: media.toSafeObject() },
    });
  } catch (error) {
    next(error);
  }
};

export const updateExistingMedia = async (req, res, next) => {
  try {
    const data = {};
    if (req.body.name !== undefined) data.name = req.body.name;
    if (req.body.isActive !== undefined) {
      if (typeof req.body.isActive !== "boolean") {
        return res
          .status(400)
          .json({ success: false, message: "isActive must be a boolean" });
      }
      data.isActive = req.body.isActive;
    }
    if (req.body.category !== undefined) {
      if (
        req.body.category !== "advertisement" &&
        req.body.category !== "reel"
      ) {
        return res.status(400).json({
          success: false,
          message: "category must be 'advertisement' or 'reel'",
        });
      }
      data.category = req.body.category;
    }

    const media = await updateMedia(req.params.id, data);
    return successResponse(res, {
      message: "Media updated successfully",
      data: { media: media.toSafeObject() },
    });
  } catch (error) {
    next(error);
  }
};

export const reorderMediaItems = async (req, res, next) => {
  try {
    if (!Array.isArray(req.body?.orderedIds)) {
      return res
        .status(400)
        .json({ success: false, message: "orderedIds must be an array" });
    }

    const media = await reorderMedia(req.body.orderedIds);
    return successResponse(res, {
      message: "Media order updated successfully",
      data: { media: media.map((item) => item.toSafeObject()) },
    });
  } catch (error) {
    next(error);
  }
};

export const removeMedia = async (req, res, next) => {
  try {
    const media = await deleteMedia(req.params.id);
    return successResponse(res, {
      message: "Media deleted successfully",
      data: { media: media.toSafeObject() },
    });
  } catch (error) {
    next(error);
  }
};