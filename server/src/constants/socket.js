/**
 * Socket.IO event names shared between client and server.
 */
export const SOCKET_EVENTS = Object.freeze({
  // Client -> Server
  JOIN_ADMIN: "join:admin",
  JOIN_STAFF: "join:staff",
  JOIN_DISPLAY: "join:display",
  JOIN_QUEUE: "join:queue",
  JOIN_CUSTOMER: "join:customer",

  // Server -> Client
  QUEUE_UPDATED: "queue:updated",
  TOKEN_CREATED: "token:created",
  TOKEN_CALLED: "token:called",
  TOKEN_RECALLED: "token:recalled",
  TOKEN_STARTED: "token:started",
  TOKEN_COMPLETED: "token:completed",
  TOKEN_SKIPPED: "token:skipped",
  TOKEN_CANCELLED: "token:cancelled",
  TOKEN_NO_SHOW: "token:no-show",
  NOTIFICATION: "notification",
  CUSTOMER_NOTIFICATION: "customer:notification",

  // Live Queue display configuration
  LIVE_QUEUE_MEDIA_UPDATED: "liveQueue:mediaUpdated",
  LIVE_QUEUE_SETTINGS_UPDATED: "liveQueue:settingsUpdated",
});
