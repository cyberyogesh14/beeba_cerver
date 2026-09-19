import mongoose from "mongoose";

import { MEDIA_TYPE, MEDIA_CATEGORY } from "../constants/media.js";

const mediaSchema = new mongoose.Schema(
  {
    /** Purpose of the media on the live display (ad vs reel). */
    category: {
      type: String,
      enum: Object.values(MEDIA_CATEGORY),
      default: MEDIA_CATEGORY.REEL,
      index: true,
    },

    name: {
      type: String,
      required: [true, "Media name is required"],
      trim: true,
      minlength: 1,
      maxlength: 120,
    },

    type: {
      type: String,
      enum: Object.values(MEDIA_TYPE),
      required: [true, "Media type is required"],
      index: true,
    },

    /** Public URL used by the live display / previews. */
    url: {
      type: String,
      required: true,
      trim: true,
    },

    /** Optional poster or preview image URL. */
    thumbnailUrl: {
      type: String,
      trim: true,
      default: null,
    },

    /** Storage-provider key used to delete the stored object. */
    storageKey: {
      type: String,
      required: true,
      trim: true,
    },

    mimeType: {
      type: String,
      required: true,
    },

    /** File size in bytes. */
    size: {
      type: Number,
      required: true,
      min: 1,
    },

    /** Duration in seconds for videos (null for images). */
    duration: {
      type: Number,
      min: 1,
      max: 86400,
      default: null,
    },

    isActive: {
      type: Boolean,
      default: false,
      index: true,
    },

    sortOrder: {
      type: Number,
      default: 0,
    },

    uploadedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

mediaSchema.index({
  isActive: 1,
  sortOrder: 1,
  createdAt: 1,
});

mediaSchema.index({
  category: 1,
  isActive: 1,
  sortOrder: 1,
});

mediaSchema.methods.toSafeObject = function () {
  return {
    id: this._id,
    category: this.category,
    name: this.name,
    type: this.type,
    url: this.url,
    thumbnailUrl: this.thumbnailUrl,
    mimeType: this.mimeType,
    size: this.size,
    duration: this.duration,
    isActive: this.isActive,
    sortOrder: this.sortOrder,
    uploadedBy: this.uploadedBy ?? null,
    createdAt: this.createdAt,
    updatedAt: this.updatedAt,
  };
};

const Media = mongoose.model("Media", mediaSchema);

export default Media;