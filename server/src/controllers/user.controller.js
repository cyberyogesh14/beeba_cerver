import User from "../models/User.js";

import {
  createUserSchema,
  updateUserSchema,
} from "../validators/user.validator.js";

import { successResponse } from "../utils/apiResponse.js";

export const getUsers = async (req, res, next) => {
  try {
    const page = Math.max(
      1,
      parseInt(req.query.page) || 1
    );
    const limit = Math.min(
      100,
      Math.max(1, parseInt(req.query.limit) || 20)
    );
    const skip = (page - 1) * limit;

    const [users, total] = await Promise.all([
      User.find()
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      User.countDocuments(),
    ]);

    return successResponse(res, {
      message: "Users retrieved successfully",
      data: {
        users: users.map((user) => user.toSafeObject()),
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit),
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

export const getUserById = async (req, res, next) => {
  try {
    const user = await User.findById(req.params.id);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    return successResponse(res, {
      data: {
        user: user.toSafeObject(),
      },
    });
  } catch (error) {
    next(error);
  }
};

export const createUser = async (req, res, next) => {
  try {
    const { error, value } =
      createUserSchema.validate(req.body);

    if (error) {
      return res.status(400).json({
        success: false,
        message: "Validation failed",
        errors: error.details.map((item) => item.message),
      });
    }

    const existingUser = await User.findOne({
      email: value.email.toLowerCase(),
    });

    if (existingUser) {
      return res.status(409).json({
        success: false,
        message: "A user with this email already exists",
      });
    }

    const user = await User.create({
      ...value,
      email: value.email.toLowerCase(),
    });

    return successResponse(res, {
      statusCode: 201,
      message: "User created successfully",
      data: {
        user: user.toSafeObject(),
      },
    });
  } catch (error) {
    next(error);
  }
};

export const updateUser = async (req, res, next) => {
  try {
    const { error, value } =
      updateUserSchema.validate(req.body);

    if (error) {
      return res.status(400).json({
        success: false,
        message: "Validation failed",
        errors: error.details.map((item) => item.message),
      });
    }

    if (value.email) {
      value.email = value.email.toLowerCase();
    }

    const user = await User.findById(req.params.id);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    // Check duplicate email on update (excluding self)
    if (value.email && value.email !== user.email) {
      const existing = await User.findOne({
        email: value.email,
        _id: { $ne: user._id },
      });

      if (existing) {
        return res.status(409).json({
          success: false,
          message:
            "A user with this email already exists",
        });
      }
    }

    Object.assign(user, value);

    await user.save();

    return successResponse(res, {
      message: "User updated successfully",
      data: {
        user: user.toSafeObject(),
      },
    });
  } catch (error) {
    next(error);
  }
};

export const deleteUser = async (req, res, next) => {
  try {
    if (req.user._id.toString() === req.params.id) {
      return res.status(400).json({
        success: false,
        message: "You cannot delete your own account",
      });
    }

    const user = await User.findById(req.params.id);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    await user.deleteOne();

    return successResponse(res, {
      message: "User deleted successfully",
    });
  } catch (error) {
    next(error);
  }
};