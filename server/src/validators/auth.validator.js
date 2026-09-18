import Joi from "joi";

export const signupSchema = Joi.object({
  name: Joi.string()
    .trim()
    .min(2)
    .max(100)
    .required()
    .messages({
      "string.min": "Name must contain at least 2 characters",
      "any.required": "Name is required",
    }),

  email: Joi.string().email().required().messages({
    "string.email": "Please provide a valid email address",
    "any.required": "Email is required",
  }),

  password: Joi.string().min(8).max(128).required().messages({
    "string.min": "Password must contain at least 8 characters",
    "string.max": "Password cannot exceed 128 characters",
    "any.required": "Password is required",
  }),
});

export const loginSchema = Joi.object({
  email: Joi.string().email().required().messages({
    "string.email": "Please provide a valid email address",
    "any.required": "Email is required",
  }),

  password: Joi.string().min(8).required().messages({
    "string.min": "Password must contain at least 8 characters",
    "any.required": "Password is required",
  }),
});