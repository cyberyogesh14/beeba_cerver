import Token from "../models/Token.js";

import { TOKEN_STATUS } from "../constants/queue.js";

import { notify } from "./notification.service.js";

import {
  NOTIFICATION_TYPE,
  NOTIFICATION_RECIPIENT,
  NOTIFICATION_CHANNEL,
  NOTIFICATION_STATUS,
} from "../constants/notification.js";

/**
 * Pre-call email scheduling.
 *
 * A token booked with a long enough expected wait gets a
 * `preCallAt` timestamp (expected turn - lead time). A small
 * in-process sweep then sends the customer a "you're up soon"
 * email when that moment arrives, while the token is still
 * WAITING.
 *
 * Delivery guarantees:
 *  - Exactly-once claim: the token is atomically claimed via
 *    findOneAndUpdate (status WAITING + preCallSentAt null), so
 *    concurrent workers (PM2 cluster) and overlapping sweeps can
 *    never send a second pre-call.
 *  - Restart-safe: preCallAt persists; after a restart the sweep
 *    re-claims any due-but-unsent tokens on the first pass.
 *  - Best-effort email: a failed send is recorded on the
 *    Notification (never on the token), consistent with the rest
 *    of the queue's email handling, and is never retried so the
 *    customer cannot receive duplicates.
 */

// How long before the expected turn the pre-call email fires.
export const PRE_CALL_LEAD_MS = 10 * 60 * 1000;

const DEFAULT_SWEEP_INTERVAL_MS = 60 * 1000;

const BUSINESS_NAME =
  process.env.BUSINESS_NAME || "Beeba Boys Hair Studio";

const TRACKING_URL =
  process.env.TRACKING_URL ||
  "https://queqebeebaboys.vercel.app/track";

/**
 * Compute the moment the pre-call email should fire for a token
 * whose expected wait is `estimatedWaitTimeMinutes` minutes from
 * `now` (inception). Returns null when the wait is shorter than
 * the pre-call lead time — pre-calling then would arrive at or
 * after the customer's actual turn.
 */
export const computePreCallAt = ({
  now = new Date(),
  estimatedWaitTimeMinutes = 0,
} = {}) => {
  const waitMs = estimatedWaitTimeMinutes * 60 * 1000;
  const preCallAt = new Date(
    now.getTime() + waitMs - PRE_CALL_LEAD_MS
  );

  if (preCallAt.getTime() <= now.getTime()) {
    return null;
  }

  return preCallAt;
};

/**
 * Best-effort send of the pre-call email for a populated token.
 * Returns a status object; never throws on provider failures.
 */
const sendPreCallEmail = async (token) => {
  const email = token.customer?.email;

  if (!email) {
    return {
      sent: false,
      status: "SKIPPED",
      provider: null,
      error: "Customer has no email address",
    };
  }

  const serviceName = token.service?.name ?? null;

  const message = [
    `Hi ${token.customer.name},`,
    "",
    `You're almost up at ${BUSINESS_NAME}.`,
    ...(serviceName ? [`Service: ${serviceName}`] : []),
    `Your token: ${token.tokenNumber}`,
    "",
    "Your number will be called in about 10 minutes.",
    "Please be ready at the studio so you don't miss your turn.",
    "",
    "TRACK YOUR TOKEN",
    TRACKING_URL,
  ].join("\n");

  const notification = await notify({
    type: NOTIFICATION_TYPE.TOKEN_PRECALL,
    title: `Your Turn is Soon - ${token.tokenNumber}`,
    message,
    recipientType: NOTIFICATION_RECIPIENT.CUSTOMER,
    customer: token.customer._id,
    token: token._id,
    tokenNumber: token.tokenNumber,
    channel: NOTIFICATION_CHANNEL.EMAIL,
  });

  return {
    sent:
      notification.status === NOTIFICATION_STATUS.SENT,
    status: notification.status,
    provider: notification.provider || null,
    error: notification.error || null,
  };
};

/**
 * Send the pre-call email for a single token now (manual action).
 *
 * Atomically claims the token by setting preCallSentAt, so a
 * second request (or a concurrent sweep) cannot send again.
 *
 * Accepts any WAITING token. Returns:
 *   { token, preCall: { sent, status, provider, error, preCallSentAt } }
 *
 * Throws 404 when the token does not exist, 409 when the token is
 * no longer WAITING and has never been pre-called.
 */
export const preCallToken = async (tokenId) => {
  const claimed = await Token.findOneAndUpdate(
    {
      _id: tokenId,
      status: TOKEN_STATUS.WAITING,
      preCallSentAt: null,
    },
    {
      $set: { preCallSentAt: new Date() },
    },
    {
      returnDocument: "after",
    }
  )
    .populate("service")
    .populate("customer");

  if (!claimed) {
    const existing = await Token.findById(tokenId).select(
      "status preCallSentAt"
    );

    if (!existing) {
      throw Object.assign(
        new Error("Token not found"),
        { statusCode: 404 }
      );
    }

    if (existing.preCallSentAt) {
      // Already pre-called earlier — idempotent no-op so repeated
      // clicks (or double submits) never send a second email.
      const doc = await Token.findById(tokenId)
        .populate("service")
        .populate("customer");

      return {
        token: doc,
        preCall: {
          sent: false,
          status: "ALREADY_SENT",
          provider: null,
          error: null,
          preCallSentAt: doc.preCallSentAt,
        },
      };
    }

    throw Object.assign(
      new Error(
        "Token is no longer waiting and cannot be pre-called"
      ),
      { statusCode: 409 }
    );
  }

  const result = await sendPreCallEmail(claimed);

  return {
    token: claimed,
    preCall: {
      ...result,
      preCallSentAt: claimed.preCallSentAt,
    },
  };
};

/**
 * Sweep the queue for due pre-calls and send them.
 *
 * Each token is claimed atomically (findOneAndUpdate with the
 * WAITING status guard and preCallSentAt null), so overlapping
 * sweeps or multiple processes never double-send. Returns the
 * number of pre-call emails actually sent.
 */
export const runPreCallSweep = async () => {
  const now = new Date();

  let sentCount = 0;
  let claimed;

  do {
    claimed = await Token.findOneAndUpdate(
      {
        status: TOKEN_STATUS.WAITING,
        preCallAt: { $ne: null, $lte: now },
        preCallSentAt: null,
      },
      {
        $set: { preCallSentAt: new Date() },
      },
      {
        sort: { preCallAt: 1 },
        returnDocument: "after",
      }
    )
      .populate("service")
      .populate("customer");

    if (!claimed) break;

    try {
      const result = await sendPreCallEmail(claimed);
      if (result.sent) sentCount += 1;
    } catch (error) {
      console.error(
        "Pre-call email delivery failed:",
        error.message
      );
    }
  } while (claimed);

  return sentCount;
};

let intervalHandle = null;

/**
 * Start the background pre-call sweeper. Runs one immediate sweep
 * (so pre-calls that became due while the process was down are
 * delivered right after boot) and then keeps sweeping on a fixed
 * interval. Idempotent: starting twice keeps the first timer.
 *
 * The timer is unref()'d so it never keeps the process alive on
 * its own (tests and one-shot scripts can exit normally).
 */
export const startPreCallScheduler = (
  intervalMs = DEFAULT_SWEEP_INTERVAL_MS
) => {
  if (intervalHandle) return intervalHandle;

  runPreCallSweep().catch((error) => {
    console.error("Pre-call sweep failed:", error.message);
  });

  intervalHandle = setInterval(() => {
    runPreCallSweep().catch((error) => {
      console.error("Pre-call sweep failed:", error.message);
    });
  }, intervalMs);

  if (typeof intervalHandle.unref === "function") {
    intervalHandle.unref();
  }

  return intervalHandle;
};

/**
 * Stop the background sweeper. Used by tests to leave the process
 * clean; a no-op when the scheduler was never started.
 */
export const stopPreCallScheduler = () => {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
};