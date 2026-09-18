import User from "../models/User.js";
import { generateAccessToken } from "../utils/jwt.js";

import { ROLES } from "../constants/roles.js";

/**
 * Self-registration for customer accounts.
 *
 * Customer signup only ever creates CUSTOMER accounts: staff/admin
 * accounts must be provisioned by an admin through /api/users. The
 * return shape matches login() so clients can treat signup as an
 * implicit login (token + user returned in one call).
 */
export const signupUser = async (name, email, password) => {
  const user = await User.create({
    name,
    email: email.toLowerCase().trim(),
    password,
    role: ROLES.CUSTOMER,
    isActive: true,
  });

  const token = generateAccessToken(user);

  return {
    token,
    user: user.toSafeObject(),
  };
};

export const loginUser = async (email, password) => {
  const user = await User.findOne({
    email: email.toLowerCase(),
  }).select("+password");

  if (!user) {
    throw Object.assign(
      new Error("Invalid email or password"),
      { statusCode: 401 }
    );
  }

  if (!user.isActive) {
    throw Object.assign(
      new Error("Your account has been deactivated"),
      { statusCode: 403 }
    );
  }

  const isPasswordValid = await user.comparePassword(password);

  if (!isPasswordValid) {
    throw Object.assign(
      new Error("Invalid email or password"),
      { statusCode: 401 }
    );
  }

  const token = generateAccessToken(user);

  return {
    token,
    user: user.toSafeObject(),
  };
};