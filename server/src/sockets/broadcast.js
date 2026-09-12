import {
  emitToAll,
  emitToDisplay,
  emitToQueue,
} from "./emitter.js";

import { SOCKET_EVENTS } from "../constants/socket.js";

const {
  QUEUE_UPDATED,
  TOKEN_CREATED,
  TOKEN_CALLED,
  TOKEN_RECALLED,
  TOKEN_STARTED,
  TOKEN_COMPLETED,
  TOKEN_SKIPPED,
  NOTIFICATION,
} = SOCKET_EVENTS;

const serviceIdOf = (token) => {
  if (!token) return null;
  return token.service?._id ?? token.service ?? null;
};

/**
 * Broadcast a queue event to every audience.
 *
 * payload: {
 *   token,        // safe token object (or null)
 *   serviceId,    // service the token belongs to
 *   waiting,      // optional updated waiting list
 *   next,         // optional next token
 *   counter,      // optional counter reference
 * }
 */
export const broadcastQueueEvent = (
  event,
  payload = {}
) => {
  const { token } = payload;

  const serviceId =
    payload.serviceId ||
    serviceIdOf(token);

  const base = {
    event,
    ...payload,
  };

  // Everyone: admins, staff, displays and general listeners.
  emitToAll(QUEUE_UPDATED, base);

  // Target the service-specific queue room.
  if (serviceId) {
    emitToQueue(serviceId, event, base);
  }
};

export const broadcastTokenCreated = (payload) => {
  emitToAll(TOKEN_CREATED, payload);
  broadcastQueueEvent(TOKEN_CREATED, payload);
};

export const broadcastTokenCalled = (payload) => {
  emitToAll(TOKEN_CALLED, payload);
  broadcastQueueEvent(TOKEN_CALLED, payload);
  emitToDisplay(NOTIFICATION, {
    message:
      payload.token?.tokenNumber
        ? `Token ${payload.token.tokenNumber}, please proceed to Counter ${payload.counterNumber ?? payload.token?.counter?.number ?? ""}.`
        : "",
    ...payload,
  });
};

export const broadcastTokenRecalled = (payload) => {
  emitToAll(TOKEN_RECALLED, payload);
  broadcastQueueEvent(TOKEN_RECALLED, payload);
  emitToDisplay(NOTIFICATION, {
    message: `Token ${payload.token?.tokenNumber} has been recalled.`,
    ...payload,
  });
};

export const broadcastTokenStarted = (payload) => {
  emitToAll(TOKEN_STARTED, payload);
  broadcastQueueEvent(TOKEN_STARTED, payload);
};

export const broadcastTokenCompleted = (payload) => {
  emitToAll(TOKEN_COMPLETED, payload);
  broadcastQueueEvent(TOKEN_COMPLETED, payload);

  // When a token completes, the next eligible customer is
  // effectively called: notify the public display so they
  // can proceed to the counter.
  const next = payload.nextToken;

  if (next?.tokenNumber && payload.message) {
    emitToDisplay(NOTIFICATION, {
      message: payload.message,
      token: next,
      ...payload,
    });
  }
};

export const broadcastTokenSkipped = (payload) => {
  emitToAll(TOKEN_SKIPPED, payload);
  broadcastQueueEvent(TOKEN_SKIPPED, payload);
};
