import mongoose from "mongoose";

import {
  NOTIFICATION_TYPE,
  NOTIFICATION_RECIPIENT,
  NOTIFICATION_CHANNEL,
  NOTIFICATION_STATUS,
  NOTIFICATION_PROVIDER,
} from "../constants/notification.js";

const notificationSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: Object.values(NOTIFICATION_TYPE),
      required: true,
      index: true,
    },

    title: {
      type: String,
      trim: true,
      maxlength: 150,
      default: null,
    },

    message: {
      type: String,
      required: true,
      trim: true,
      maxlength: 500,
    },

    recipientType: {
      type: String,
      enum: Object.values(NOTIFICATION_RECIPIENT),
      required: true,
      index: true,
    },

    recipient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true,
    },

    customer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Customer",
      default: null,
      index: true,
    },

    token: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Token",
      default: null,
      index: true,
    },

    tokenNumber: {
      type: String,
      trim: true,
      uppercase: true,
      default: null,
    },

    counter: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Counter",
      default: null,
    },

    status: {
      type: String,
      enum: Object.values(NOTIFICATION_STATUS),
      default: NOTIFICATION_STATUS.PENDING,
      index: true,
    },

    channel: {
      type: String,
      enum: Object.values(NOTIFICATION_CHANNEL),
      default: NOTIFICATION_CHANNEL.SOCKET,
      index: true,
    },

    provider: {
      type: String,
      enum: Object.values(NOTIFICATION_PROVIDER),
      default: null,
    },

    sentAt: {
      type: Date,
      default: null,
    },

    error: {
      type: String,
      default: null,
    },

    read: {
      type: Boolean,
      default: false,
      index: true,
    },

    readAt: {
      type: Date,
      default: null,
    },

    deliveredAt: {
      type: Date,
      default: null,
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

notificationSchema.index({
  recipientType: 1,
  read: 1,
  createdAt: -1,
});

notificationSchema.index({
  customer: 1,
  createdAt: -1,
});

notificationSchema.index({
  recipient: 1,
  read: 1,
  createdAt: -1,
});

notificationSchema.index({
  status: 1,
  createdAt: -1,
});

notificationSchema.index({
  token: 1,
  createdAt: -1,
});

notificationSchema.methods.toSafeObject = function () {
  return {
    id: this._id,
    type: this.type,
    title: this.title,
    message: this.message,
    recipientType: this.recipientType,
    recipient: this.recipient,
    customer: this.customer,
    token: this.token,
    tokenNumber: this.tokenNumber,
    counter: this.counter,
    status: this.status,
    channel: this.channel,
    provider: this.provider,
    sentAt: this.sentAt,
    error: this.error,
    read: this.read,
    readAt: this.readAt,
    createdAt: this.createdAt,
  };
};

const Notification = mongoose.model(
  "Notification",
  notificationSchema
);

export default Notification;
