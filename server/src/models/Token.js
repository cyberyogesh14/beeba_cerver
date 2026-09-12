import mongoose from "mongoose";

import {
  TOKEN_STATUS,
  TOKEN_PRIORITY,
} from "../constants/queue.js";

const tokenSchema = new mongoose.Schema(
  {
    tokenNumber: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
    },

    sequenceNumber: {
      type: Number,
      required: true,
      min: 1,
    },

    service: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Service",
      required: true,
      index: true,
    },

    customer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Customer",
      required: true,
      index: true,
    },

    counter: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Counter",
      default: null,
      index: true,
    },

    status: {
      type: String,
      enum: Object.values(TOKEN_STATUS),
      default: TOKEN_STATUS.WAITING,
      index: true,
    },

    priority: {
      type: Number,
      enum: Object.values(TOKEN_PRIORITY),
      default: TOKEN_PRIORITY.NORMAL,
      index: true,
    },

    calledAt: {
      type: Date,
      default: null,
    },

    startedAt: {
      type: Date,
      default: null,
    },

    completedAt: {
      type: Date,
      default: null,
    },

    skippedAt: {
      type: Date,
      default: null,
    },

    history: [
      {
        action: {
          type: String,
          required: true,
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
        },

        counter: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "Counter",
          default: null,
        },

        metadata: {
          type: mongoose.Schema.Types.Mixed,
          default: {},
        },

        at: {
          type: Date,
          default: Date.now,
        },
      },
    ],
  },
  {
    timestamps: true,
  }
);

tokenSchema.index({
  createdAt: 1,
  status: 1,
});

tokenSchema.index({
  service: 1,
  status: 1,
  priority: -1,
  sequenceNumber: 1,
});

tokenSchema.index({
  tokenNumber: 1,
});

tokenSchema.methods.toSafeObject = function () {
  return {
    id: this._id,
    tokenNumber: this.tokenNumber,
    sequenceNumber: this.sequenceNumber,
    service: this.service,
    customer: this.customer,
    counter: this.counter,
    status: this.status,
    priority: this.priority,
    calledAt: this.calledAt,
    startedAt: this.startedAt,
    completedAt: this.completedAt,
    skippedAt: this.skippedAt,
    history: this.history,
    createdAt: this.createdAt,
    updatedAt: this.updatedAt,
  };
};

const Token = mongoose.model("Token", tokenSchema);

export default Token;