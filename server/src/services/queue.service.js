import mongoose from "mongoose";

import Token from "../models/Token.js";

import { TOKEN_STATUS } from "../constants/queue.js";

import { logQueueEvent } from "../repositories/queue.repository.js";

/**
 * Call a specific token. Validates that the token is still
 * WAITING, then atomically moves it to CALLED. The counter
 * concept has been removed: any authenticated staff/admin may
 * manage the queue and the queue transition is the only rule.
 */
export const callToken = async (tokenId, { userId } = {}) => {
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

      const previousStatus = token.status;

      token.status = TOKEN_STATUS.CALLED;
      token.calledAt = new Date();

      token.history.push({
        action: "CALLED",
        previousStatus,
        newStatus: TOKEN_STATUS.CALLED,
        performedBy: userId,
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
 * Recall a SKIPPED token back to the CALLED state.
 */
export const recallToken = async (
  tokenId,
  { userId } = {}
) => {
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

      const previousStatus = token.status;

      token.status = TOKEN_STATUS.CALLED;
      token.calledAt = new Date();
      token.skippedAt = null;

      token.history.push({
        action: "RECALLED",
        previousStatus,
        newStatus: TOKEN_STATUS.CALLED,
        performedBy: userId,
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
 * Start serving a CALLED token, moving it to SERVING.
 */
export const startToken = async (
  tokenId,
  { userId } = {}
) => {
  const session = await mongoose.startSession();

  let result;

  try {
    await session.withTransaction(async () => {
      const token = await Token.findOne({
        _id: tokenId,
        status: TOKEN_STATUS.CALLED,
      }).session(session);

      if (!token) {
        throw Object.assign(
          new Error(
            "Token is not in a called state and cannot be started"
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
 * Skip the current token. Marks the token as SKIPPED.
 */
export const skipToken = async (
  tokenId,
  { userId } = {}
) => {
  const session = await mongoose.startSession();

  let result;

  try {
    await session.withTransaction(async () => {
      const token = await Token.findOne({
        _id: tokenId,
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
            "Token is not in a called or serving state and cannot be skipped"
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
 * Cancel a WAITING token. Customers may cancel their own booking
 * while it is still in the queue (accountless design: the token id
 * is the bearer proof). Staff/admin may cancel any waiting token.
 */
export const cancelToken = async (
  tokenId,
  { userId } = {}
) => {
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
            "Token is no longer waiting and cannot be cancelled"
          ),
          { statusCode: 409 }
        );
      }

      const previousStatus = token.status;

      token.status = TOKEN_STATUS.CANCELLED;

      token.history.push({
        action: "CANCELLED",
        previousStatus,
        newStatus: TOKEN_STATUS.CANCELLED,
        performedBy: userId ?? token.customer,
        metadata: userId
          ? { action: "CANCELLED" }
          : { action: "CUSTOMER_CANCELLED" },
      });

      await token.save({ session });

      await logQueueEvent(
        {
          token: token._id,
          action: "CANCELLED",
          previousStatus,
          newStatus: TOKEN_STATUS.CANCELLED,
          performedBy: userId ?? token.customer,
          metadata: userId
            ? { action: "CANCELLED" }
            : { action: "CUSTOMER_CANCELLED" },
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
 * Mark a CALLED token as a no-show. Staff decide the customer did
 * not arrive within a reasonable window.
 */
export const noShowToken = async (
  tokenId,
  { userId } = {}
) => {
  const session = await mongoose.startSession();

  let result;

  try {
    await session.withTransaction(async () => {
      const token = await Token.findOne({
        _id: tokenId,
        status: TOKEN_STATUS.CALLED,
      }).session(session);

      if (!token) {
        throw Object.assign(
          new Error(
            "Token is not in a called state and cannot be marked as no-show"
          ),
          { statusCode: 409 }
        );
      }

      const previousStatus = token.status;

      token.status = TOKEN_STATUS.NO_SHOW;

      token.history.push({
        action: "NO_SHOW",
        previousStatus,
        newStatus: TOKEN_STATUS.NO_SHOW,
        performedBy: userId,
      });

      await token.save({ session });

      await logQueueEvent(
        {
          token: token._id,
          action: "NO_SHOW",
          previousStatus,
          newStatus: TOKEN_STATUS.NO_SHOW,
          performedBy: userId,
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
 * Complete the current token, then automatically call the
 * next eligible WAITING token for the same service and
 * return the updated queue state.
 *
 * The next token is atomically claimed via findOneAndUpdate
 * with a status guard so two concurrent completions never
 * double-call the same token.
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
  { userId } = {}
) => {
  const session = await mongoose.startSession();

  let completed;
  let next = null;
  let nextWaiting;

  try {
    await session.withTransaction(async () => {
      // ── 1. Mark the current token as COMPLETED ──
      const token = await Token.findOne({
        _id: tokenId,
        status: TOKEN_STATUS.SERVING,
      }).session(session);

      if (!token) {
        throw Object.assign(
          new Error(
            "Token is not in a serving state and cannot be completed"
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
      });

      await token.save({ session });

      await logQueueEvent(
        {
          token: token._id,
          action: "COMPLETED",
          previousStatus,
          newStatus: TOKEN_STATUS.COMPLETED,
          performedBy: userId,
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
      // return null. The next token is chosen by the queue
      // rules: highest priority first, then earliest number.
      const serviceId = token.service;

      const claimed = await Token.findOneAndUpdate(
        {
          service: serviceId,
          status: TOKEN_STATUS.WAITING,
        },
        {
          $set: {
            status: TOKEN_STATUS.CALLED,
            calledAt: new Date(),
          },
          $push: {
            history: {
              action: "CALLED",
              previousStatus: TOKEN_STATUS.WAITING,
              newStatus: TOKEN_STATUS.CALLED,
              performedBy: userId,
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
      .sort({ calledAt: 1 })
      .limit(20),

    Token.find({
      status: TOKEN_STATUS.WAITING,
    })
      .populate("service")
      .populate("customer")
      .sort({
        priority: -1,
        sequenceNumber: 1,
      })
      .limit(100),
  ]);

  return { serving, waiting };
};