export const TOKEN_STATUS = Object.freeze({
  WAITING: "WAITING",
  CALLED: "CALLED",
  SERVING: "SERVING",
  COMPLETED: "COMPLETED",
  SKIPPED: "SKIPPED",
  CANCELLED: "CANCELLED",
  NO_SHOW: "NO_SHOW",
});

export const TOKEN_PRIORITY = Object.freeze({
  NORMAL: 0,
  HIGH: 1,
});