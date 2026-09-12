import mongoose from "mongoose";

const tokenSequenceSchema = new mongoose.Schema(
  {
    dateKey: {
      type: String,
      required: true,
    },

    service: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Service",
      required: true,
    },

    prefix: {
      type: String,
      required: true,
      uppercase: true,
    },

    sequence: {
      type: Number,
      default: 0,
      min: 0,
    },
  },
  {
    timestamps: true,
  }
);

tokenSequenceSchema.index(
  {
    dateKey: 1,
    service: 1,
  },
  {
    unique: true,
  }
);

const TokenSequence = mongoose.model(
  "TokenSequence",
  tokenSequenceSchema
);

export default TokenSequence;