import mongoose from "mongoose";

import Token from "../models/Token.js";

import { TOKEN_STATUS } from "../constants/queue.js";

export const createToken = async (data) => {
  return Token.create(data);
};

/**
 * Resolve the token previously created for an idempotency key.
 * Returns null when no token was ever created with that key. Kept
 * minimal (id + dateKey) because duplicate resolution reloads the
 * full populated token afterwards.
 */
export const findTokenByIdempotencyKey = async (key) => {
  if (!key) return null;

  return Token.findOne({
    idempotencyKey: String(key).trim().toUpperCase(),
  })
    .select("_id dateKey")
    .lean();
};

/**
 * Find a token by its MongoDB ObjectId or by its public
 * tokenNumber (e.g. "H-001"). Public tracking screens let
 * customers search by token number, so both lookups must be
 * supported. ObjectId inputs use the _id index; anything else
 * is matched on tokenNumber (uppercased), keeping the most
 * recently issued token when a daily sequence rolled over.
 */
export const findTokenById = async (input) => {
  const filter = mongoose.isValidObjectId(input)
    ? { _id: input }
    : { tokenNumber: String(input).trim().toUpperCase() };

  return Token.findOne(filter)
    .sort({ createdAt: -1 })
    .populate("service")
    .populate("customer");
};

/**
 * List tokens with filtering and pagination.
 *
 * @param {object} options
 * @param {number}  options.page  - 1-indexed page number
 * @param {number}  options.limit - items per page (max 100)
 * @param {string}  [options.status]  - filter by token status
 * @param {string}  [options.serviceId] - filter by service
 * @param {string}  [options.priority] - "HIGH" or "NORMAL"
 * @param {string}  [options.date]     - "today" or ISO date string
 * @returns {{ tokens: Token[], total: number, page: number, pages: number }}
 */
export const findTokens = async ({
  page = 1,
  limit = 20,
  status,
  serviceId,
  priority,
  date,
} = {}) => {
  const filter = {};

  if (status) {
    filter.status = status;
  }

  if (serviceId) {
    filter.service = serviceId;
  }

  if (priority) {
    filter.priority =
      priority === "HIGH" ? 1 : 0;
  }

  if (date === "today") {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    filter.createdAt = { $gte: start };
  } else if (date) {
    const start = new Date(date);
    start.setHours(0, 0, 0, 0);
    const end = new Date(date);
    end.setHours(23, 59, 59, 999);
    filter.createdAt = { $gte: start, $lte: end };
  }

  const skip = (page - 1) * limit;

  const [tokens, total] = await Promise.all([
    Token.find(filter)
      .populate("service")
      .populate("customer")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit),
    Token.countDocuments(filter),
  ]);

  return {
    tokens,
    total,
    page,
    pages: Math.ceil(total / limit),
  };
};

/**
 * Find the next eligible waiting token. Returns the
 * highest-priority, earliest-waiting token that is WAITING,
 * optionally restricted to a service. No counter involvement.
 *
 * @param {object} [options]
 * @param {string} [options.serviceId]
 * @returns {Token|null}
 */
export const findNextWaitingToken = async ({
  serviceId,
} = {}) => {
  const filter = {
    status: TOKEN_STATUS.WAITING,
  };

  if (serviceId) {
    filter.service = serviceId;
  }

  return Token.findOne(filter)
    .populate("service")
    .populate("customer")
    .sort({
      priority: -1,
      sequenceNumber: 1,
    });
};

export const countWaitingTokens = async ({
  serviceId,
  createdAfter,
}) => {
  return Token.countDocuments({
    service: serviceId,
    status: TOKEN_STATUS.WAITING,
    createdAt: {
      $gte: createdAfter,
    },
  });
};

export const getFirstWaitingForService = async (
  serviceId,
  dateKey
) => {
  const startOfDay = new Date(
    `${dateKey}T00:00:00`
  );

  const next = await Token.findOne({
    service: serviceId,
    status: TOKEN_STATUS.WAITING,
    createdAt: {
      $gte: startOfDay,
    },
  }).sort({
    priority: -1,
    sequenceNumber: 1,
  });

  return next;
};
