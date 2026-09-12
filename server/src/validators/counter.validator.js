import Joi from "joi";

export const createCounterSchema = Joi.object({
  name: Joi.string()
    .trim()
    .min(2)
    .max(100)
    .required(),

  number: Joi.number()
    .integer()
    .min(1)
    .required(),

  assignedStaff: Joi.string()
    .hex()
    .length(24)
    .allow(null, ""),

  services: Joi.array()
    .items(
      Joi.string()
        .hex()
        .length(24)
    )
    .default([]),

  isActive: Joi.boolean()
    .default(true),
});

export const updateCounterSchema = Joi.object({
  name: Joi.string()
    .trim()
    .min(2)
    .max(100),

  number: Joi.number()
    .integer()
    .min(1),

  assignedStaff: Joi.string()
    .hex()
    .length(24)
    .allow(null, ""),

  services: Joi.array().items(
    Joi.string()
      .hex()
      .length(24)
  ),

  isActive: Joi.boolean(),
}).min(1);