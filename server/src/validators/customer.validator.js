import Joi from "joi";

export const createCustomerSchema = Joi.object({
  name: Joi.string()
    .trim()
    .min(2)
    .max(100)
    .required(),

  phone: Joi.string()
    .trim()
    .min(7)
    .max(20)
    .required(),

  email: Joi.string()
    .email()
    .allow("", null),
});