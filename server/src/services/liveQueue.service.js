import LiveQueueSetting from "../models/LiveQueueSetting.js";

import { getActiveAdvertisements, getActiveReels } from "./media.service.js";
import { broadcastLiveQueueSettings } from "../sockets/broadcast.js";

const DEFAULTS = Object.freeze({
  queueDisplayDuration: 10,
  mediaDisplayDuration: 10,
  mediaEnabled: true,
  queueEnabled: true,
});

/**
 * Read the singleton live-queue settings, creating the default document
 * atomically when it does not exist yet. Safe under concurrent boots.
 */
export const getLiveQueueSettings = async () => {
  const settings = await LiveQueueSetting.findOneAndUpdate(
    {},
    { $setOnInsert: { ...DEFAULTS } },
    { upsert: true, returnDocument: "after", setDefaultsOnInsert: true }
  );
  return settings;
};

export const updateLiveQueueSettings = async (data) => {
  const settings = await LiveQueueSetting.findOneAndUpdate(
    {},
    { $set: data },
    { upsert: true, returnDocument: "after", setDefaultsOnInsert: true }
  );
  broadcastLiveQueueSettings({ settings: settings.toSafeObject() });
  return settings;
};

/**
 * Public state consumed by the live display: playback settings +
 * active media split into advertisements (permanent left panel) and
 * reels (right-panel rotation). Admin-only fields are never included.
 */
export const getLiveQueueState = async () => {
  const [settings, advertisements, reels] = await Promise.all([
    getLiveQueueSettings(),
    getActiveAdvertisements(),
    getActiveReels(),
  ]);
  return { settings, advertisements, reels };
};