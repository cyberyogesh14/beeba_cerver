import Service from "../models/Service.js";
import Token from "../models/Token.js";

import {
  createToken,
  findTokenById,
  findTokenByIdempotencyKey,
  findTokens,
  findNextWaitingToken,
} from "../repositories/token.repository.js";

import { getNextSequence } from "../repositories/tokenSequence.repository.js";

import { findOrCreateCustomer } from "./customer.service.js";

import { findCustomerByEmail } from "../repositories/customer.repository.js";

import {
  TOKEN_PRIORITY,
  TOKEN_STATUS,
} from "../constants/queue.js";

const getDateKey = () => {
  const now = new Date();

  const year = now.getFullYear();
  const month = String(
    now.getMonth() + 1
  ).padStart(2, "0");

  const day = String(
    now.getDate()
  ).padStart(2, "0");

  return `${year}-${month}-${day}`;
};

const padSequence = (sequence) => {
  return String(sequence).padStart(3, "0");
};

/**
 * Current queue position of a token: how many WAITING tokens for the
 * same service and day have an earlier sequence number, plus one.
 * Used for both freshly created and idempotently replayed tokens so
 * a duplicate request reports a consistent position.
 */
const getQueuePosition = async ({
  serviceId,
  sequenceNumber,
  dateKey,
}) => {
  const waitingAhead = await Token.countDocuments({
    service: serviceId,
    status: TOKEN_STATUS.WAITING,
    dateKey,
    sequenceNumber: { $lt: sequenceNumber },
  });

  return waitingAhead + 1;
};

const isDuplicateKeyErrorOn = (error, field) =>
  error &&
  error.code === 11000 &&
  error.keyPattern &&
  error.keyPattern[field];

/**
 * Replay a previously created token for an idempotent request and
 * return its current queue position. Never triggers creation side
 * effects (socket broadcast / email) again.
 */
const replayExistingToken = async (tokenId, dateKey) => {
  const token = await findTokenById(tokenId);

  if (!token) {
    return null;
  }

  const serviceId = token.service?._id ?? token.service;

  const position = await getQueuePosition({
    serviceId,
    sequenceNumber: token.sequenceNumber,
    dateKey: token.dateKey || dateKey,
  });

  const estimatedWaitTime =
    (position - 1) *
    (token.service?.estimatedTime ?? 0);

  return {
    token,
    customer: token.customer,
    service: token.service,
    position,
    estimatedWaitTime,
    duplicate: true,
  };
};

export const generateToken = async ({
  serviceId,
  customer: customerData,
  priority = false,
  idempotencyKey,
}) => {
  // Idempotent replay: if the same key already produced a token,
  // return that token without consuming another sequence number or
  // running any creation side effects.
  if (idempotencyKey) {
    const existing =
      await findTokenByIdempotencyKey(idempotencyKey);

    if (existing) {
      const replay = await replayExistingToken(
        existing._id,
        existing.dateKey
      );

      if (replay) {
        return replay;
      }
    }
  }

  const service = await Service.findOne({
    _id: serviceId,
    isActive: true,
  });

  if (!service) {
    throw Object.assign(
      new Error("Selected service is unavailable"),
      { statusCode: 400 }
    );
  }

  if (
    priority &&
    !service.prioritySupported
  ) {
    throw Object.assign(
      new Error(
        "Priority queue is not supported for this service"
      ),
      { statusCode: 400 }
    );
  }

  const customer =
    await findOrCreateCustomer(customerData);

  const dateKey = getDateKey();

  const sequence =
    await getNextSequence({
      dateKey,
      serviceId: service._id,
      prefix: service.prefix,
    });

  const sequenceNumber = sequence.sequence;

  const tokenNumber =
    `${service.prefix}-${padSequence(
      sequenceNumber
    )}`;

  // Token creation never depends on a counter: the token is
  // simply WAITING with its number, service, customer, priority
  // and timestamps.
  let token;

  try {
    token = await createToken({
      tokenNumber,
      sequenceNumber,
      service: service._id,
      customer: customer._id,
      dateKey,
      status: TOKEN_STATUS.WAITING,
      priority: priority
        ? TOKEN_PRIORITY.HIGH
        : TOKEN_PRIORITY.NORMAL,
      ...(idempotencyKey
        ? { idempotencyKey }
        : {}),
    });
  } catch (error) {
    // Two concurrent requests carrying the same idempotency key can
    // pass the pre-check together; the unique idempotencyKey index
    // resolves the race. Whichever insert wins is the one we return.
    if (
      idempotencyKey &&
      isDuplicateKeyErrorOn(error, "idempotencyKey")
    ) {
      const existing =
        await findTokenByIdempotencyKey(idempotencyKey);

      if (existing) {
        const replay = await replayExistingToken(
          existing._id,
          existing.dateKey || dateKey
        );

        if (replay) {
          return replay;
        }
      }
    }

    throw error;
  }

  // Populate service + customer so the created token serializes
  // with full objects ({ id, name, prefix, ... }) instead of raw
  // ObjectId strings. Both the HTTP response and the token:created
  // socket broadcast go through toSafeObject, so both benefit.
  await token.populate([
    { path: "service" },
    { path: "customer" },
  ]);

  const position = await getQueuePosition({
    serviceId: service._id,
    sequenceNumber,
    dateKey,
  });

  const estimatedWaitTime =
    (position - 1) * service.estimatedTime;

  return {
    token,
    customer,
    service,
    position,
    estimatedWaitTime,
    duplicate: false,
  };
};

export const getToken = async (id) => {
  return findTokenById(id);
};

/**
 * Compute the current queue position and estimated wait for a
 * WAITING token. Returns null for tokens that are not waiting.
 */
const computeQueueForToken = async (token) => {
  if (token.status !== TOKEN_STATUS.WAITING) {
    return null;
  }

  const serviceId = token.service?._id ?? token.service;

  if (!serviceId) {
    return null;
  }

  const waitingAhead = await Token.countDocuments({
    service: serviceId,
    status: TOKEN_STATUS.WAITING,
    sequenceNumber: { $lt: token.sequenceNumber },
  });

  const position = waitingAhead + 1;

  return {
    position,
    estimatedWaitTime:
      (position - 1) *
      (token.service?.estimatedTime ?? 0),
  };
};

/**
 * Public tracking lookup: resolve a token by ObjectId or
 * tokenNumber and compute its current queue position and
 * estimated wait when it is still waiting.
 */
export const getTokenWithQueue = async (id) => {
  const token = await findTokenById(id);

  if (!token) {
    return { token: null, queue: null };
  }

  const queue = await computeQueueForToken(token);

  return { token, queue };
};

/**
 * Public tracking lookup by email: find every token belonging to
 * a customer (by their email address) with its current queue
 * position. Used by the public track screen so customers can see
 * all their tokens without remembering a token reference.
 */
export const getTokensByEmail = async (email) => {
  const customer = await findCustomerByEmail(email);

  if (!customer) {
    return { customer: null, items: [] };
  }

  const tokens = await Token.find({
    customer: customer._id,
  })
    .populate("service")
    .populate("customer")
    .sort({ createdAt: -1 });

  const items = await Promise.all(
    tokens.map(async (token) => ({
      token,
      queue: await computeQueueForToken(token),
    }))
  );

  return { customer, items };
};

export const listTokens = async (options) => {
  return findTokens(options);
};

export const getNextToken = async () => {
  return findNextWaitingToken();
};