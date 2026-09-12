import QueueHistory from "../models/QueueHistory.js";

export const logQueueEvent = (data, session) => {
  const options = session ? { session } : {};

  return QueueHistory.create([data], options);
};

export const findTokenHistory = (tokenId) => {
  return QueueHistory.find({
    token: tokenId,
  })
    .sort({
      createdAt: -1,
    })
    .populate({
      path: "performedBy",
      select: "name email role",
    })
    .populate({
      path: "counter",
      select: "name number",
    });
};
