import mongoose from "mongoose";

import { TOKEN_STATUS } from "../constants/queue.js";

const queueHistorySchema = new mongoose.Schema(
  {
    token: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Token",
      required: true,
      index: true,
    },

    action: {
      type: String,
      required: true,
      index: true,
    },

    previousStatus: {
      type: String,
      enum: Object.values(TOKEN_STATUS),
      default: null,
    },

    newStatus: {
      type: String,
      enum: Object.values(TOKEN_STATUS),
      required: true,
    },

    performedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  {
    timestamps: true,
  }
);

queueHistorySchema.index({
  token: 1,
  createdAt: -1,
});

queueHistorySchema.index({
  performedBy: 1,
  createdAt: -1,
});

const QueueHistory = mongoose.model(
  "QueueHistory",
  queueHistorySchema
);

export default QueueHistory;
