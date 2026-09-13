import Joi from "joi";

import { TOKEN_STATUS } from "../constants/queue.js";

export const createTokenSchema = Joi.object({
  serviceId: Joi.string()
    .hex()
    .length(24)
    .required(),

  customer: Joi.object({
    name: Joi.string()
      .trim()
      .min(2)
      .max(100)
      .required(),

    phone: Joi.string()
      .trim()
      .min(7)
      .max(20)
      .allow("", null),

    email: Joi.string()
      .email()
      .allow("", null),
  }).required(),

  priority: Joi.boolean().default(false),

  // Frontend-generated idempotency key: retrying the same token
  // generation request with the same key returns the original
  // token instead of creating a duplicate.
  idempotencyKey: Joi.string()
    .trim()
    .max(128)
    .allow("", null)
    .optional(),
});

// Queue actions no longer carry any payload: the counter
// dependency was removed and the transition is the only rule.
// Keep an empty schema so controller validation flow stays put.
export const queueActionSchema = Joi.object({});

export const listTokensQuerySchema = Joi.object({
  page: Joi.number()
    .integer()
    .min(1)
    .default(1),

  limit: Joi.number()
    .integer()
    .min(1)
    .max(100)
    .default(20),

  status: Joi.string()
    .valid(...Object.values(TOKEN_STATUS))
    .optional(),

  serviceId: Joi.string()
    .hex()
    .length(24)
    .optional(),

  priority: Joi.string()
    .valid("HIGH", "NORMAL")
    .optional(),

  date: Joi.string()
    .isoDate()
    .optional()
    .allow("today"),
});
