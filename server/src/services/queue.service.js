import mongoose from "mongoose";

import Token from "../models/Token.js";

import Counter from "../models/Counter.js";

import { TOKEN_STATUS } from "../constants/queue.js";

import { getFirstWaitingForService } from "../repositories/token.repository.js";
import { findTokenById } from "../repositories/token.repository.js";

import { logQueueEvent } from "../repositories/queue.repository.js";

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

/**
 * Ensure the requesting user is allowed to act on a counter.
 * Staff members are restricted to the counter assigned to them.
 * Admins may act on any active counter (the admin Token List
 * manages tokens across all counters).
 */
export const assertStaffCounter = async (
  userId,
  counterId,
  role
) => {
  const counter =
    role === "admin"
      ? await Counter.findOne({
          _id: counterId,
          isActive: true,
        })
      : await Counter.findOne({
          _id: counterId,
          isActive: true,
          assignedStaff: userId,
        });

  if (!counter) {
    throw Object.assign(
      new Error(
        role === "admin"
          ? "Counter is not active or does not exist"
          : "You are not assigned to this counter"
      ),
      { statusCode: 403 }
    );
  }

  return counter;
};

/**
 * Call a specific token. Validates that the token
 * is still WAITING, the counter is free and supports
 * the token's service, then atomically moves it to
 * CALLED.
 */
export const callToken = async (
  tokenId,
  { userId, counterId, role }
) => {
  const counter = await assertStaffCounter(
    userId,
    counterId,
    role
  );

  const session = await mongoose.startSession();

  let result;

  try {
    await session.withTransaction(async () => {
      const token = await Token.findOne({
        _id: tokenId,
        status: TOKEN_STATUS.WAITING,
      }).session(session);

      if (!token) {
        throw Object.assign(
          new Error(
            "Token is no longer in the waiting queue"
          ),
          { statusCode: 409 }
        );
      }

      if (
        !counter.services.some(
          (serviceId) =>
            serviceId.toString() ===
            token.service.toString()
        )
      ) {
        throw Object.assign(
          new Error(
            "This counter does not support the token's service"
          ),
          { statusCode: 403 }
        );
      }

      const active = await Token.findOne({
        _id: {
          $ne: token._id,
        },
        counter: counter._id,
        status: {
          $in: [
            TOKEN_STATUS.CALLED,
            TOKEN_STATUS.SERVING,
          ],
        },
      }).session(session);

      if (active) {
        throw Object.assign(
          new Error(
            "This counter is already serving or has called another token"
          ),
          { statusCode: 409 }
        );
      }

      const previousStatus = token.status;

      token.status = TOKEN_STATUS.CALLED;
      token.counter = counter._id;
      token.calledAt = new Date();

      token.history.push({
        action: "CALLED",
        previousStatus,
        newStatus: TOKEN_STATUS.CALLED,
        performedBy: userId,
        counter: counter._id,
      });

      await token.save({
        session,
      });

      await logQueueEvent(
        {
          token: token._id,
          action: "CALLED",
          previousStatus,
          newStatus: TOKEN_STATUS.CALLED,
          performedBy: userId,
          counter: counter._id,
        },
        session
      );

      result = token;
    });

    return result;
  } finally {
    await session.endSession();
  }
};

/**
 * Recall a SKIPPED token back to the CALLED state for
 * the same counter.
 */
export const recallToken = async (
  tokenId,
  { userId, counterId, role }
) => {
  const counter = await assertStaffCounter(
    userId,
    counterId,
    role
  );

  const session = await mongoose.startSession();

  let result;

  try {
    await session.withTransaction(async () => {
      const token = await Token.findOne({
        _id: tokenId,
        status: TOKEN_STATUS.SKIPPED,
      }).session(session);

      if (!token) {
        throw Object.assign(
          new Error(
            "Token is not in a skipped state and cannot be recalled"
          ),
          { statusCode: 409 }
        );
      }

      const active = await Token.findOne({
        _id: {
          $ne: token._id,
        },
        counter: counter._id,
        status: {
          $in: [
            TOKEN_STATUS.CALLED,
            TOKEN_STATUS.SERVING,
          ],
        },
      }).session(session);

      if (active) {
        throw Object.assign(
          new Error(
            "This counter is already serving or has called another token"
          ),
          { statusCode: 409 }
        );
      }

      const previousStatus = token.status;

      token.status = TOKEN_STATUS.CALLED;
      token.counter = counter._id;
      token.calledAt = new Date();
      token.skippedAt = null;

      token.history.push({
        action: "RECALLED",
        previousStatus,
        newStatus: TOKEN_STATUS.CALLED,
        performedBy: userId,
        counter: counter._id,
      });

      await token.save({
        session,
      });

      await logQueueEvent(
        {
          token: token._id,
          action: "RECALLED",
          previousStatus,
          newStatus: TOKEN_STATUS.CALLED,
          performedBy: userId,
          counter: counter._id,
        },
        session
      );

      result = token;
    });

    return result;
  } finally {
    await session.endSession();
  }
};

/**
 * Assign (or reassign) a counter to a token.
 *
 * Safe for WAITING, CALLED and SKIPPED tokens. A SERVING
 * token is never silently reassigned; terminal tokens are
 * immutable. Reassigning a CALLED token requires the target
 * counter to be free (same invariant as callToken).
 */
export const assignTokenCounter = async (
  tokenId,
  { userId, counterId, role }
) => {
  const counter = await assertStaffCounter(
    userId,
    counterId,
    role
  );

  const session = await mongoose.startSession();

  let result;

  try {
    await session.withTransaction(async () => {
      const token = await Token.findById(
        tokenId
      ).session(session);

      if (!token) {
        throw Object.assign(
          new Error("Token not found"),
          { statusCode: 404 }
        );
      }

      if (
        [
          TOKEN_STATUS.COMPLETED,
          TOKEN_STATUS.CANCELLED,
          TOKEN_STATUS.NO_SHOW,
        ].includes(token.status)
      ) {
        throw Object.assign(
          new Error(
            "Token is no longer active and cannot be assigned a counter"
          ),
          { statusCode: 409 }
        );
      }

      if (token.status === TOKEN_STATUS.SERVING) {
        throw Object.assign(
          new Error(
            "Token is currently being served and cannot be reassigned"
          ),
          { statusCode: 409 }
        );
      }

      if (
        !counter.services.some(
          (serviceId) =>
            serviceId.toString() ===
            token.service.toString()
        )
      ) {
        throw Object.assign(
          new Error(
            "This counter does not support the token's service"
          ),
          { statusCode: 403 }
        );
      }

      // Keep the call/recall busy-counter invariant: a CALLED
      // token may only be moved to a counter that has no other
      // active token.
      if (token.status === TOKEN_STATUS.CALLED) {
        const active = await Token.findOne({
          _id: {
            $ne: token._id,
          },
          counter: counter._id,
          status: {
            $in: [
              TOKEN_STATUS.CALLED,
              TOKEN_STATUS.SERVING,
            ],
          },
        }).session(session);

        if (active) {
          throw Object.assign(
            new Error(
              "This counter is already serving or has called another token"
            ),
            { statusCode: 409 }
          );
        }
      }

      const previousStatus = token.status;
      const previousCounterId = token.counter;

      token.counter = counter._id;

      token.history.push({
        action: "COUNTER_ASSIGNED",
        previousStatus,
        newStatus: previousStatus,
        performedBy: userId,
        counter: counter._id,
        metadata: {
          previousCounterId:
            previousCounterId ?? null,
        },
      });

      await token.save({
        session,
      });

      await logQueueEvent(
        {
          token: token._id,
          action: "COUNTER_ASSIGNED",
          previousStatus,
          newStatus: previousStatus,
          performedBy: userId,
          counter: counter._id,
          metadata: {
            previousCounterId:
              previousCounterId ?? null,
          },
        },
        session
      );

      result = token._id;
    });

    return findTokenById(result);
  } finally {
    await session.endSession();
  }
};

/**
 * Start serving a CALLED token, moving it to SERVING.
 */
export const startToken = async (
  tokenId,
  { userId, counterId, role }
) => {
  const counter = await assertStaffCounter(
    userId,
    counterId,
    role
  );

  const session = await mongoose.startSession();

  let result;

  try {
    await session.withTransaction(async () => {
      const token = await Token.findOne({
        _id: tokenId,
        status: TOKEN_STATUS.CALLED,
        counter: counter._id,
      }).session(session);

      if (!token) {
        throw Object.assign(
          new Error(
            "Token is not in a called state for this counter"
          ),
          { statusCode: 409 }
        );
      }

      const previousStatus = token.status;

      token.status = TOKEN_STATUS.SERVING;
      token.startedAt = new Date();

      token.history.push({
        action: "STARTED",
        previousStatus,
        newStatus: TOKEN_STATUS.SERVING,
        performedBy: userId,
        counter: counter._id,
      });

      await token.save({
        session,
      });

      await logQueueEvent(
        {
          token: token._id,
          action: "STARTED",
          previousStatus,
          newStatus: TOKEN_STATUS.SERVING,
          performedBy: userId,
          counter: counter._id,
        },
        session
      );

      result = token;
    });

    return result;
  } finally {
    await session.endSession();
  }
};

/**
 * Skip the current token. Marks the token as SKIPPED
 * and frees the counter so the next token can be called.
 */
export const skipToken = async (
  tokenId,
  { userId, counterId, role }
) => {
  const counter = await assertStaffCounter(
    userId,
    counterId,
    role
  );

  const session = await mongoose.startSession();

  let result;

  try {
    await session.withTransaction(async () => {
      const token = await Token.findOne({
        _id: tokenId,
        counter: counter._id,
        status: {
          $in: [
            TOKEN_STATUS.CALLED,
            TOKEN_STATUS.SERVING,
          ],
        },
      }).session(session);

      if (!token) {
        throw Object.assign(
          new Error(
            "Token is not currently assigned to this counter"
          ),
          { statusCode: 409 }
        );
      }

      const previousStatus = token.status;

      token.status = TOKEN_STATUS.SKIPPED;
      token.skippedAt = new Date();

      token.history.push({
        action: "SKIPPED",
        previousStatus,
        newStatus: TOKEN_STATUS.SKIPPED,
        performedBy: userId,
        counter: counter._id,
      });

      await token.save({
        session,
      });

      await logQueueEvent(
        {
          token: token._id,
          action: "SKIPPED",
          previousStatus,
          newStatus: TOKEN_STATUS.SKIPPED,
          performedBy: userId,
          counter: counter._id,
        },
        session
      );

      result = token;
    });

    return result;
  } finally {
    await session.endSession();
  }
};

/**
 * Complete the current token, then automatically call
 * the next eligible WAITING token for the same service
 * and return the updated queue state.
 *
 * The next token is atomically claimed via
 * findOneAndUpdate with a status guard so two
 * concurrent completions never double-call the same
 * token.
 *
 * Returns:
 * {
 *   completedToken,
 *   nextToken,   // null if the queue is empty
 *   nextWaiting  // tokens still waiting after the auto-call
 * }
 */
export const completeToken = async (
  tokenId,
  { userId, counterId, role }
) => {
  const counter = await assertStaffCounter(
    userId,
    counterId,
    role
  );

  const session = await mongoose.startSession();

  let completed;
  let next = null;
  let nextWaiting;

  try {
    await session.withTransaction(async () => {
      // ── 1. Mark the current token as COMPLETED ──
      const token = await Token.findOne({
        _id: tokenId,
        counter: counter._id,
        status: TOKEN_STATUS.SERVING,
      }).session(session);

      if (!token) {
        throw Object.assign(
          new Error(
            "Token is not in a serving state for this counter"
          ),
          { statusCode: 409 }
        );
      }

      const previousStatus = token.status;
      const completedAt = new Date();

      token.status = TOKEN_STATUS.COMPLETED;
      token.completedAt = completedAt;

      token.history.push({
        action: "COMPLETED",
        previousStatus,
        newStatus: TOKEN_STATUS.COMPLETED,
        performedBy: userId,
        counter: counter._id,
      });

      await token.save({ session });

      await logQueueEvent(
        {
          token: token._id,
          action: "COMPLETED",
          previousStatus,
          newStatus: TOKEN_STATUS.COMPLETED,
          performedBy: userId,
          counter: counter._id,
        },
        session
      );

      completed = token;

      // ── 2. Find & atomically claim the next waiting token ──
      //
      // We use findOneAndUpdate with a status guard so a
      // concurrent transaction cannot claim the same token.
      // The update only succeeds if the token is still
      // WAITING — any other status causes the update to
      // return null.
      const serviceId = token.service;

      // First check whether the counter actually supports
      // this service.  If not, we stop here — the completed
      // token is saved but no next token is called.
      const counterSupportsService = counter.services.some(
        (s) => s.toString() === serviceId.toString()
      );

      if (!counterSupportsService) {
        // Counter cannot serve the next token's service.
        // Leave the queue as-is; do not corrupt state.
        nextWaiting = await Token.find({
          service: serviceId,
          status: TOKEN_STATUS.WAITING,
        })
          .session(session)
          .sort({
            priority: -1,
            sequenceNumber: 1,
          })
          .limit(10);

        return;
      }

      // Attempt to atomically claim the highest-priority,
      // earliest waiting token for this service.
      const claimed = await Token.findOneAndUpdate(
        {
          service: serviceId,
          status: TOKEN_STATUS.WAITING,
        },
        {
          $set: {
            status: TOKEN_STATUS.CALLED,
            counter: counter._id,
            calledAt: new Date(),
          },
          $push: {
            history: {
              action: "CALLED",
              previousStatus: TOKEN_STATUS.WAITING,
              newStatus: TOKEN_STATUS.CALLED,
              performedBy: userId,
              counter: counter._id,
              metadata: {
                autoCalled: true,
                completedTokenId: token._id,
              },
            },
          },
        },
        {
          session,
          // Sort is applied before the update so we pick
          // the correct "first" token.
          sort: {
            priority: -1,
            sequenceNumber: 1,
          },
          returnDocument: "after",
        }
      );

      if (claimed) {
        next = claimed;

        await logQueueEvent(
          {
            token: claimed._id,
            action: "CALLED",
            previousStatus: TOKEN_STATUS.WAITING,
            newStatus: TOKEN_STATUS.CALLED,
            performedBy: userId,
            counter: counter._id,
            metadata: {
              autoCalled: true,
              completedTokenId: token._id,
            },
          },
          session
        );
      }

      // ── 3. Snapshot remaining waiting tokens ──
      nextWaiting = await Token.find({
        service: serviceId,
        status: TOKEN_STATUS.WAITING,
      })
        .session(session)
        .sort({
          priority: -1,
          sequenceNumber: 1,
        })
        .limit(10);
    });
  } finally {
    await session.endSession();
  }

  return {
    completedToken: completed,
    nextToken: next,
    nextWaiting,
  };
};

/**
 * List the tokens currently in the waiting queue,
 * ordered by priority then sequence number.
 */
export const getQueue = async (query = {}) => {
  const filter = {};

  if (query.serviceId) {
    filter.service = query.serviceId;
  }

  const tokens = await Token.find({
    ...filter,
    status: TOKEN_STATUS.WAITING,
  })
    .populate("service")
    .populate("customer")
    .sort({
      priority: -1,
      sequenceNumber: 1,
    });

  return tokens;
};

/**
 * Public live queue state: the tokens currently being
 * served (CALLED/SERVING) and the tokens waiting, all
 * populated so the display screen can render names. The
 * caller is responsible for stripping sensitive fields.
 */
export const getPublicQueueState = async () => {
  const [serving, waiting] = await Promise.all([
    Token.find({
      status: {
        $in: [
          TOKEN_STATUS.CALLED,
          TOKEN_STATUS.SERVING,
        ],
      },
    })
      .populate("service")
      .populate("customer")
      .populate("counter")
      .sort({ calledAt: 1 })
      .limit(20),

    Token.find({
      status: TOKEN_STATUS.WAITING,
    })
      .populate("service")
      .populate("customer")
      .populate("counter")
      .sort({
        priority: -1,
        sequenceNumber: 1,
      })
      .limit(100),
  ]);

  return { serving, waiting };
};

/**
 * Get the token currently being served, plus the next
 * token in line for a given counter.
 */
export const getCounterState = async ({
  userId,
  counterId,
  role,
}) => {
  const counter = await assertStaffCounter(
    userId,
    counterId,
    role
  );

  const active = await Token.findOne({
    counter: counter._id,
    status: {
      $in: [
        TOKEN_STATUS.CALLED,
        TOKEN_STATUS.SERVING,
      ],
    },
  })
    .populate("customer")
    .populate("service");

  const serviceId =
    active?.service?._id ?? active?.service;

  let next = null;

  if (serviceId) {
    // Next in line for the currently served service.
    next = await getFirstWaitingForService(
      serviceId,
      getDateKey()
    );
  } else {
    // Counter is idle: surface the earliest waiting token
    // across the services this counter supports.
    const supportedServices =
      counter.services || [];

    for (const supported of supportedServices) {
      const candidate =
        await getFirstWaitingForService(
          supported._id
            ? supported._id
            : supported,
          getDateKey()
        );

      if (candidate) {
        next = candidate;
        break;
      }
    }
  }

  return {
    counter,
    active,
    next,
  };
};
