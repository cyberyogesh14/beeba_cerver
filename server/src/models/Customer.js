import mongoose from "mongoose";

const customerSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Customer name is required"],
      trim: true,
      minlength: 2,
      maxlength: 100,
    },

    phone: {
      type: String,
      trim: true,
      maxlength: 20,
      index: true,
      default: null,
    },

    email: {
      type: String,
      trim: true,
      lowercase: true,
      maxlength: 150,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

 

customerSchema.index({
  email: 1,
});

customerSchema.methods.toSafeObject = function () {
  return {
    id: this._id,
    name: this.name,
    phone: this.phone,
    email: this.email,
    createdAt: this.createdAt,
    updatedAt: this.updatedAt,
  };
};

const Customer = mongoose.model(
  "Customer",
  customerSchema
);

export default Customer;