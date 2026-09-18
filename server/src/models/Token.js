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

    // Calendar day the token was issued (YYYY-MM-DD). The token
    // sequence resets daily, so uniqueness of tokenNumber is only
    // guaranteed within a single day via { dateKey, tokenNumber }.
    dateKey: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
    },

    // Frontend-generated idempotency key. A repeated token
    // generation request that reuses the same key returns the
    // original token instead of creating a duplicate. Sparse
    // unique: only present on tokens created with an explicit key.
    idempotencyKey: {
      type: String,
      trim: true,
      uppercase: true,
      maxlength: 128,
      default: undefined,
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

// tokenNumber is unique per day. The per-day sequence resets every
// dateKey, so a global unique tokenNumber index would break the daily
// reset; this compound index keeps numbers collision-free within a day
// while still allowing the daily roll-over.
tokenSchema.index(
  {
    dateKey: 1,
    tokenNumber: 1,
  },
  {
    unique: true,
  }
);

// Same request retried (same idempotency key handled up to twice
// concurrently) must always resolve to the same token. Sparse so that
// the many historical/legacy tokens without a key stay unaffected.
tokenSchema.index(
  {
    idempotencyKey: 1,
  },
  {
    unique: true,
    sparse: true,
  }
);

tokenSchema.methods.toSafeObject = function () {
  // Normalize nested references: a populated Service/Customer
  // document serializes to its safe object ({ id, name, ... }),
  // a raw ObjectId reference stays as-is. This keeps the token
  // shape identical across every endpoint and socket payload.
  const toSafe = (value) =>
    value && typeof value.toSafeObject === "function"
      ? value.toSafeObject()
      : value;

  return {
    id: this._id,
    tokenNumber: this.tokenNumber,
    sequenceNumber: this.sequenceNumber,
    service: toSafe(this.service),
    customer: toSafe(this.customer),
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