import mongoose from "mongoose";

const serviceSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Service name is required"],
      trim: true,
      minlength: 2,
      maxlength: 100,
    },

    code: {
      type: String,
      required: [true, "Service code is required"],
      trim: true,
      uppercase: true,
      unique: true,
      maxlength: 20,
    },

    description: {
      type: String,
      trim: true,
      maxlength: 500,
      default: "",
    },

    prefix: {
      type: String,
      required: [true, "Token prefix is required"],
      trim: true,
      uppercase: true,
      maxlength: 5,
    },

    estimatedTime: {
      type: Number,
      required: [true, "Estimated service time is required"],
      min: 1,
      max: 480,
    },

    prioritySupported: {
      type: Boolean,
      default: false,
    },

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

serviceSchema.index({
  name: 1,
  isActive: 1,
});

serviceSchema.methods.toSafeObject = function () {
  return {
    id: this._id,
    name: this.name,
    code: this.code,
    description: this.description,
    prefix: this.prefix,
    estimatedTime: this.estimatedTime,
    prioritySupported: this.prioritySupported,
    isActive: this.isActive,
    createdAt: this.createdAt,
    updatedAt: this.updatedAt,
  };
};

const Service = mongoose.model("Service", serviceSchema);

export default Service;