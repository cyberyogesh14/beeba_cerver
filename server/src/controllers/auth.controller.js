import {
  loginSchema,
  signupSchema,
} from "../validators/auth.validator.js";
import {
  loginUser,
  signupUser,
} from "../services/auth.service.js";
import { successResponse } from "../utils/apiResponse.js";

export const signup = async (req, res, next) => {
  try {
    const { error, value } = signupSchema.validate(req.body);

    if (error) {
      return res.status(400).json({
        success: false,
        message: "Validation failed",
        errors: error.details.map((item) => item.message),
      });
    }

    const result = await signupUser(
      value.name,
      value.email,
      value.password
    );

    return successResponse(res, {
      statusCode: 201,
      message: "Account created successfully",
      data: result,
    });
  } catch (error) {
    next(error);
  }
};

export const login = async (req, res, next) => {
  try {
    const { error, value } = loginSchema.validate(req.body);

    if (error) {
      return res.status(400).json({
        success: false,
        message: "Validation failed",
        errors: error.details.map((item) => item.message),
      });
    }

    const result = await loginUser(
      value.email,
      value.password
    );

    return successResponse(res, {
      message: "Login successful",
      data: result,
    });
  } catch (error) {
    next(error);
  }
};

export const logout = async (req, res) => {
  return successResponse(res, {
    message: "Logout successful",
  });
};

export const getCurrentUser = async (req, res) => {
  return successResponse(res, {
    message: "Authenticated user",
    data: {
      user: req.user.toSafeObject(),
    },
  });
};