import {
  getLiveQueueSettings,
  updateLiveQueueSettings,
  getLiveQueueState,
} from "../services/liveQueue.service.js";
import { updateSettingsSchema } from "../validators/liveQueue.validator.js";
import { successResponse } from "../utils/apiResponse.js";

export const getLiveQueueSettingsController = async (req, res, next) => {
  try {
    const settings = await getLiveQueueSettings();
    return successResponse(res, {
      data: { settings: settings.toSafeObject() },
    });
  } catch (error) {
    next(error);
  }
};

export const getLiveQueueStateController = async (req, res, next) => {
  try {
    const { settings, media } = await getLiveQueueState();
    return successResponse(res, {
      message: "Live queue state retrieved successfully",
      data: {
        settings: settings.toSafeObject(),
        media: media.map((item) => item.toSafeObject()),
      },
    });
  } catch (error) {
    next(error);
  }
};

export const updateLiveQueueSettingsController = async (req, res, next) => {
  try {
    const { error, value } = updateSettingsSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        message: "Validation failed",
        errors: error.details.map((item) => item.message),
      });
    }

    const settings = await updateLiveQueueSettings(value);
    return successResponse(res, {
      message: "Live queue settings updated successfully",
      data: { settings: settings.toSafeObject() },
    });
  } catch (error) {
    next(error);
  }
};