import mongoose from "mongoose";
import bcrypt from "bcryptjs";

import { ROLES } from "../constants/roles.js";

const userSchema = new mongoose.Schema(
  {
    // -----------------------------------------
    // Basic Information
    // -----------------------------------------
    name: {
      type: String,
      required: [true, "Name is required"],
      trim: true,
      minlength: [2, "Name must be at least 2 characters"],
      maxlength: [100, "Name cannot exceed 100 characters"],
    },

    // -----------------------------------------
    // Email
    // -----------------------------------------
    email: {
      type: String,
      required: [true, "Email is required"],
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
      match: [
        /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
        "Please enter a valid email address",
      ],
    },

    // -----------------------------------------
    // Password
    // -----------------------------------------
    password: {
      type: String,
      required: [true, "Password is required"],
      minlength: [8, "Password must be at least 8 characters"],
      select: false,
    },

    // -----------------------------------------
    // Role
    // -----------------------------------------
    role: {
      type: String,
      enum: {
        values: Object.values(ROLES),
        message: "Invalid user role",
      },
      default: ROLES.STAFF,
      index: true,
    },

    // -----------------------------------------
    // Phone
    // -----------------------------------------
    phone: {
      type: String,
      trim: true,
      maxlength: [20, "Phone number cannot exceed 20 characters"],
    },

    // -----------------------------------------
    // Account Status
    // -----------------------------------------
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
  },
  {
    timestamps: true,
  }
);

// =====================================================
// Password Hashing Middleware
// =====================================================
//
// IMPORTANT:
// Do not use `next` with async middleware.
//
// Mongoose waits for this async function to finish.
// =====================================================

userSchema.pre("save", async function () {
  // Password hasn't changed.
  // No need to hash it again.
  if (!this.isModified("password")) {
    return;
  }

  const salt = await bcrypt.genSalt(12);

  this.password = await bcrypt.hash(this.password, salt);
});

// =====================================================
// Compare Password
// =====================================================

userSchema.methods.comparePassword = async function (password) {
  return bcrypt.compare(password, this.password);
};

// =====================================================
// Safe User Object
// =====================================================

userSchema.methods.toSafeObject = function () {
  return {
    id: this._id,
    name: this.name,
    email: this.email,
    role: this.role,
    phone: this.phone,
    isActive: this.isActive,
    createdAt: this.createdAt,
    updatedAt: this.updatedAt,
  };
};

// =====================================================
// Model
// =====================================================

const User = mongoose.model("User", userSchema);

export default User;

