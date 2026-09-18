import mongoose from "mongoose";

/**
 * Singleton document holding the live-queue playback configuration.
 * The display reads these values and the admin updates them; all
 * updates are broadcast to connected clients via Socket.IO.
 */
const liveQueueSettingSchema = new mongoose.Schema(
  {
    /** Seconds the LIVE QUEUE screen stays visible. */
    queueDisplayDuration: {
      type: Number,
      default: 10,
      min: 5,
      max: 60,
    },

    /** Seconds each MEDIA item stays visible (videos loop to fill it). */
    mediaDisplayDuration: {
      type: Number,
      default: 10,
      min: 5,
      max: 60,
    },

    /** When false, the display never switches to MEDIA mode. */
    mediaEnabled: {
      type: Boolean,
      default: true,
    },

    /** When false, the display shows media continuously. */
    queueEnabled: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  }
);

liveQueueSettingSchema.methods.toSafeObject = function () {
  return {
    queueDisplayDuration: this.queueDisplayDuration,
    mediaDisplayDuration: this.mediaDisplayDuration,
    mediaEnabled: this.mediaEnabled,
    queueEnabled: this.queueEnabled,
    updatedAt: this.updatedAt,
  };
};

const LiveQueueSetting = mongoose.model("LiveQueueSetting", liveQueueSettingSchema);

export default LiveQueueSetting;