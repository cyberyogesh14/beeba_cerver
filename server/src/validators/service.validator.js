import Joi from "joi";

export const createServiceSchema = Joi.object({
  name: Joi.string()
    .trim()
    .min(2)
    .max(100)
    .required(),

  code: Joi.string()
    .trim()
    .uppercase()
    .min(2)
    .max(20)
    .required(),

  description: Joi.string()
    .trim()
    .max(500)
    .allow("", null),

  prefix: Joi.string()
    .trim()
    .uppercase()
    .min(1)
    .max(5)
    .required(),

  estimatedTime: Joi.number()
    .integer()
    .min(1)
    .max(480)
    .required(),

  prioritySupported: Joi.boolean()
    .default(false),

  isActive: Joi.boolean()
    .default(true),
});

export const updateServiceSchema = Joi.object({
  name: Joi.string()
    .trim()
    .min(2)
    .max(100),

  code: Joi.string()
    .trim()
    .uppercase()
    .min(2)
    .max(20),

  description: Joi.string()
    .trim()
    .max(500)
    .allow("", null),

  prefix: Joi.string()
    .trim()
    .uppercase()
    .min(1)
    .max(5),

  estimatedTime: Joi.number()
    .integer()
    .min(1)
    .max(480),

  prioritySupported: Joi.boolean(),

  isActive: Joi.boolean(),
}).min(1);