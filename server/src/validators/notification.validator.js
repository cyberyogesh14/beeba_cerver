import Joi from "joi";

export const markReadSchema = Joi.object({
  ids: Joi.array()
    .items(
      Joi.string().hex().length(24)
    )
    .min(1)
    .required(),
});

export const listNotificationsQuerySchema =
  Joi.object({
    limit: Joi.number().integer().min(1).max(100)
      .default(50),
    read: Joi.string().valid("read", "unread").allow("", null),
  });
