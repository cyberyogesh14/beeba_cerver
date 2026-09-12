import mongoose from "mongoose";

const counterSchema = new mongoose.Schema(
  {
    // ==========================================
    // Counter Information
    // ==========================================
    name: {
      type: String,
      required: [true, "Counter name is required"],
      trim: true,
      minlength: [2, "Counter name must be at least 2 characters"],
      maxlength: [100, "Counter name cannot exceed 100 characters"],
    },

    number: {
      type: Number,
      required: [true, "Counter number is required"],
      unique: true,
      min: [1, "Counter number must be at least 1"],
    },

    // ==========================================
    // Assigned Staff
    // ==========================================
    assignedStaff: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true,
    },

    // ==========================================
    // Supported Services
    // ==========================================
    services: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Service",
      },
    ],

    // ==========================================
    // Counter Status
    // ==========================================
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

// ==========================================
// Indexes
// ==========================================

counterSchema.index({
  assignedStaff: 1,
  isActive: 1,
});

counterSchema.index({
  services: 1,
  isActive: 1,
});

// ==========================================
// Safe Object
// ==========================================
//
// This method expects assignedStaff and services
// to be populated.
//
// Example:
//
// Counter.find()
//   .populate("assignedStaff", "name email phone")
//   .populate(
//      "services",
//      "name code prefix estimatedTime prioritySupported isActive"
//   );
//
// ==========================================

counterSchema.methods.toSafeObject = function () {
  return {
    id: this._id,
    name: this.name,
    number: this.number,

    assignedStaff:
      this.assignedStaff &&
      typeof this.assignedStaff === "object" &&
      this.assignedStaff._id
        ? {
            id: this.assignedStaff._id,
            name: this.assignedStaff.name,
            email: this.assignedStaff.email,
            phone: this.assignedStaff.phone,
          }
        : null,

    services: Array.isArray(this.services)
      ? this.services
          .filter(
            (service) =>
              service &&
              typeof service === "object" &&
              service._id
          )
          .map((service) => ({
            id: service._id,
            name: service.name,
            code: service.code,
            prefix: service.prefix,
            estimatedTime: service.estimatedTime,
            prioritySupported: service.prioritySupported,
            isActive: service.isActive,
          }))
      : [],

    isActive: this.isActive,
    createdAt: this.createdAt,
    updatedAt: this.updatedAt,
  };
};

// ==========================================
// Model
// ==========================================

const Counter = mongoose.model("Counter", counterSchema);

export default Counter;