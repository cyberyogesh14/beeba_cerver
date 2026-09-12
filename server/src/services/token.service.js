import Service from "../models/Service.js";
import Token from "../models/Token.js";

import {
  createToken,
  findTokenById,
  countWaitingTokens,
  findTokens,
  findNextWaitingToken,
} from "../repositories/token.repository.js";

import { getNextSequence } from "../repositories/tokenSequence.repository.js";

import { findOrCreateCustomer } from "./customer.service.js";

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

export const generateToken = async ({
  serviceId,
  customer: customerData,
  priority = false,
}) => {
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

  // Count existing waiting tokens BEFORE creating ours,
  // so the returned position excludes the new token itself.
  const waitingBefore =
    await countWaitingTokens({
      serviceId: service._id,
      createdAfter: new Date(
        `${dateKey}T00:00:00`
      ),
    });

  const position = waitingBefore + 1;

  const estimatedWaitTime =
    (position - 1) * service.estimatedTime;

  const token = await createToken({
    tokenNumber,
    sequenceNumber,
    service: service._id,
    customer: customer._id,
    status: TOKEN_STATUS.WAITING,
    priority: priority
      ? TOKEN_PRIORITY.HIGH
      : TOKEN_PRIORITY.NORMAL,
  });

  return {
    token,
    customer,
    service,
    position,
    estimatedWaitTime,
  };
};

export const getToken = async (id) => {
  return findTokenById(id);
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

  let queue = null;

  if (token.status === TOKEN_STATUS.WAITING) {
    const serviceId = token.service?._id ?? token.service;

    if (serviceId) {
      const waitingAhead = await Token.countDocuments({
        service: serviceId,
        status: TOKEN_STATUS.WAITING,
        sequenceNumber: { $lt: token.sequenceNumber },
      });

      const position = waitingAhead + 1;

      queue = {
        position,
        estimatedWaitTime:
          (position - 1) *
          (token.service?.estimatedTime ?? 0),
      };
    }
  }

  return { token, queue };
};

export const listTokens = async (options) => {
  return findTokens(options);
};

export const getNextToken = async () => {
  return findNextWaitingToken();
};