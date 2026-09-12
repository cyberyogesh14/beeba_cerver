import Joi from "joi";

export const createUserSchema = Joi.object({
  name: Joi.string().min(2).max(100).trim().required(),

  email: Joi.string().email().required(),

  password: Joi.string().min(8).max(128).required(),

  role: Joi.string().valid("admin", "staff").required(),

  phone: Joi.string().max(20).allow("", null),

  isActive: Joi.boolean().default(true),
});

export const updateUserSchema = Joi.object({
  name: Joi.string().min(2).max(100).trim(),

  email: Joi.string().email(),

  password: Joi.string().min(8).max(128),

  role: Joi.string().valid("admin", "staff"),

  phone: Joi.string().max(20).allow("", null),

  isActive: Joi.boolean(),
}).min(1);