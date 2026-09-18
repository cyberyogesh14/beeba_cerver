import Joi from "joi";

/**
 * Playback settings validation. Durations are limited to an integer
 * between 5 and 60 seconds (inclusive) so the rotation never flashes
 * or sleeps for unreasonable lengths.
 */
export const updateSettingsSchema = Joi.object({
  queueDisplayDuration: Joi.number().integer().min(5).max(60).required(),
  mediaDisplayDuration: Joi.number().integer().min(5).max(60).required(),
  mediaEnabled: Joi.boolean().required(),
  queueEnabled: Joi.boolean().required(),
});