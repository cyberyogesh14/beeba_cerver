import User from "../models/User.js";
import { generateAccessToken } from "../utils/jwt.js";

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