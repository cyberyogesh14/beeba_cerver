import {
  createTokenSchema,
  queueActionSchema,
  listTokensQuerySchema,
} from "../validators/token.validator.js";

import {
  generateToken,
  getTokenWithQueue,
  getTokensByEmail,
  listTokens as listTokensService,
  getNextToken as getNextTokenService,
} from "../services/token.service.js";

import {
  callToken,
  recallToken,
  startToken,
  skipToken,
  completeToken,
  getQueue,
  getPublicQueueState,
} from "../services/queue.service.js";

import {
  broadcastTokenCreated,
  broadcastTokenCalled,
  broadcastTokenRecalled,
  broadcastTokenStarted,
  broadcastTokenCompleted,
  broadcastTokenSkipped,
} from "../sockets/broadcast.js";

import Service from "../models/Service.js";
import Customer from "../models/Customer.js";

import { notify } from "../services/notification.service.js";

import {
  NOTIFICATION_TYPE,
  NOTIFICATION_RECIPIENT,
  NOTIFICATION_CHANNEL,
  NOTIFICATION_STATUS,
} from "../constants/notification.js";

import { successResponse } from "../utils/apiResponse.js";

const serviceIdOf = (token) => {
  if (!token) return null;
  return token.service?._id ?? token.service ?? null;
};

/**
 * Minimal public view of a token. Only exposes safe fields:
 * token number, service name/code, customer name (no
 * phone/email), status and timestamps. Internal history is
 * never exposed publicly.
 */
const toPublicTokenView = (token) => {
  const service = token.service;
  const customer = token.customer;

  return {
    id: token._id,
    tokenNumber: token.tokenNumber,
    sequenceNumber: token.sequenceNumber,
    status: token.status,
    priority: token.priority,
    service:
      service &&
      typeof service === "object" &&
      service._id
        ? {
            id: service._id,
            name: service.name,
            code: service.code,
            prefix: service.prefix,
          }
        : service?._id ?? service ?? null,
    customer:
      customer &&
      typeof customer === "object" &&
      customer._id
        ? {
            id: customer._id,
            name: customer.name,
          }
        : customer?._id ?? customer ?? null,
    calledAt: token.calledAt,
    startedAt: token.startedAt,
    completedAt: token.completedAt,
    skippedAt: token.skippedAt,
    createdAt: token.createdAt,
    updatedAt: token.updatedAt,
  };
};

/**
 * Best-effort: send a real-time notification to a customer.
 * Delivery must never break the main token operation, so
 * failures are logged and swallowed.
 */
const notifyCustomer = (payload) => {
  const customerId = payload.customer;

  if (!customerId) return;

  notify({
    type: payload.type,
    title: payload.title,
    message: payload.message,
    recipientType: NOTIFICATION_RECIPIENT.CUSTOMER,
    customer: customerId,
    token: payload.tokenId,
    tokenNumber: payload.tokenNumber,
    status: payload.status,
    metadata: payload.metadata || {},
  }).catch((error) => {
    console.error("Notification delivery failed:", error);
  });
};

const BUSINESS_NAME =
  process.env.BUSINESS_NAME || "Beeba Boys Hair Studio";

const resolveRef = (ref) => {
  return ref &&
    typeof ref === "object" &&
    ref._id
    ? ref._id
    : ref;
};

const getServiceName = async (serviceRef) => {
  const serviceId = resolveRef(serviceRef);
  if (!serviceId) return null;

  try {
    const service = await Service.findById(
      serviceId
    ).select("name");
    return service?.name ?? null;
  } catch {
    return null;
  }
};

const getCustomerEmail = async (customerRef) => {
  const customerId = resolveRef(customerRef);
  if (!customerId) return null;

  try {
    return await Customer.findById(customerId).select(
      "name email"
    );
  } catch {
    return null;
  }
};

/**
 * Fire-and-forget runner for email delivery jobs. Queue and
 * token operations never wait on SMTP/provider availability,
 * so an email failure can never break queue processing.
 */
const runAsync = (job) => {
  Promise.resolve()
    .then(job)
    .catch((error) => {
      console.error(
        "Customer email delivery failed:",
        error.message
      );
    });
};

/**
 * Create an EMAIL-channel Notification record (best-effort).
 * Provider failures are recorded on the Notification itself
 * and never propagate to the caller.
 */
const notifyCustomerEmail = ({
  type,
  subject,
  body,
  customerId,
  tokenId,
  tokenNumber,
}) => {
  return notify({
    type,
    title: subject,
    message: body,
    recipientType: NOTIFICATION_RECIPIENT.CUSTOMER,
    customer: customerId,
    token: tokenId,
    tokenNumber,
    channel: NOTIFICATION_CHANNEL.EMAIL,
  }).catch((error) => {
    console.error(
      "Customer email notification failed:",
      error.message
    );
    return {
      status: NOTIFICATION_STATUS.FAILED,
      provider: null,
      error: error.message,
    };
  });
};

/**
 * TOKEN_CREATED email sent after the token has been
 * successfully created and persisted.
 *
 * Returns the Notification outcome (or null when the customer
 * has no email) so the API can report delivery status to the
 * booking screen. Never throws.
 */
const sendTokenCreatedEmail = async ({
  serviceName,
  tokenNumber,
  customer,
  position,
  estimatedWaitTime,
  tokenId,
}) => {
  if (!customer?.email) return null;

  const body = [
    `Hi ${customer.name},`,
    "",
    `Your token ${tokenNumber} for ${serviceName} at ${BUSINESS_NAME} is ready.`,
    `Service: ${serviceName}`,
    `Position in queue: #${position ?? "-"}`,
    `Estimated wait time: ${
      typeof estimatedWaitTime === "number"
        ? estimatedWaitTime
        : "-"
    } min`,
    "",
    "You can track your token live while you wait.",
    `Your token reference is ${tokenNumber}.`,
  ].join("\n");

  return notifyCustomerEmail({
    type: NOTIFICATION_TYPE.TOKEN_CREATED,
    subject: `Your Queue Token - ${tokenNumber}`,
    body,
    customerId: customer._id,
    tokenId,
    tokenNumber,
  });
};

/**
 * TOKEN_CALLED / TOKEN_RECALLED email sent only when the
 * token actually transitions to CALLED (manual call, recall,
 * or the auto-call of the next token after completion).
 */
const sendTurnEmail = async ({
  type,
  customerRef,
  serviceRef,
  tokenNumber,
  tokenId,
}) => {
  const customer = await getCustomerEmail(customerRef);
  if (!customer?.email) return;

  const serviceName = await getServiceName(serviceRef);
  const isRecall =
    type === NOTIFICATION_TYPE.TOKEN_RECALLED;

  const body = isRecall
    ? [
        `Hi ${customer.name},`,
        "",
        `Token ${tokenNumber} has been recalled at ${BUSINESS_NAME}.`,
        ...(serviceName ? [`Service: ${serviceName}`] : []),
        "",
        "It is your turn now. Please proceed.",
        `Your token reference is ${tokenNumber}.`,
      ].join("\n")
    : [
        `Hi ${customer.name},`,
        "",
        `It is your turn now at ${BUSINESS_NAME}.`,
        ...(serviceName ? [`Service: ${serviceName}`] : []),
        `Your token: ${tokenNumber}`,
        "",
        "It is your turn. Please proceed.",
      ].join("\n");

  notifyCustomerEmail({
    type,
    subject: `Your Turn is Now - ${tokenNumber}`,
    body,
    customerId: customer._id,
    tokenId,
    tokenNumber,
  });
};

export const createNewToken = async (
  req,
  res,
  next
) => {
  try {
    const {
      error,
      value,
    } = createTokenSchema.validate(
      req.body
    );

    if (error) {
      return res.status(400).json({
        success: false,
        message: "Validation failed",
        errors: error.details.map(
          (item) => item.message
        ),
      });
    }

    const result =
      await generateToken(value);

    // Idempotent replay (same idempotency key resubmitted): return
    // the original token and never re-broadcast or re-email.
    if (!result.duplicate) {
      broadcastTokenCreated({
        token: result.token.toSafeObject(),
        customer: result.customer.toSafeObject(),
        serviceId: value.serviceId,
        queue: {
          position: result.position,
          estimatedWaitTime:
            result.estimatedWaitTime,
        },
      });
    }

    let emailInfo;

    if (result.duplicate) {
      // Side effects already happened for this token on the original
      // request; the email (if any) was already sent then.
      emailInfo = {
        sent: Boolean(result.customer?.email),
        status: result.customer?.email
          ? NOTIFICATION_STATUS.SENT
          : "SKIPPED",
        provider: null,
        error: result.customer?.email
          ? null
          : "Customer has no email address",
        to: result.customer?.email ?? null,
        reused: true,
      };
    } else {
      // Email the customer after the token is safely created,
      // and report delivery status to the booking screen. This
      // is still best-effort: a failure never breaks the token
      // response, it is only reflected in the email field.
      emailInfo = {
        sent: false,
        status: NOTIFICATION_STATUS.FAILED,
        provider: null,
        error: "Email delivery failed",
        to: result.customer.email,
      };

      try {
        const notification =
          await sendTokenCreatedEmail({
            serviceName: result.service?.name,
            tokenNumber: result.token.tokenNumber,
            customer: result.customer,
            position: result.position,
            estimatedWaitTime:
              result.estimatedWaitTime,
            tokenId: result.token._id,
          });

        if (!notification) {
          emailInfo = {
            sent: false,
            status: "SKIPPED",
            provider: null,
            error: "Customer has no email address",
            to: result.customer.email,
          };
        } else {
          emailInfo = {
            sent:
              notification.status ===
              NOTIFICATION_STATUS.SENT,
            status: notification.status,
            provider: notification.provider || null,
            error: notification.error || null,
            to: result.customer.email,
          };
        }
      } catch (error) {
        emailInfo = {
          sent: false,
          status: NOTIFICATION_STATUS.FAILED,
          provider: null,
          error: error.message,
          to: result.customer.email,
        };
      }
    }

    return successResponse(res, {
      statusCode: 201,
      message: "Token generated successfully",
      data: {
        token:
          result.token.toSafeObject(),

        customer:
          result.customer.toSafeObject(),

        queue: {
          position: result.position,
          estimatedWaitTime:
            result.estimatedWaitTime,
        },

        email: emailInfo,

        duplicate: Boolean(result.duplicate),
      },
    });
  } catch (error) {
    next(error);
  }
};

export const getSingleToken = async (
  req,
  res,
  next
) => {
  try {
    const { token, queue } =
      await getTokenWithQueue(req.params.id);

    if (!token) {
      return res.status(404).json({
        success: false,
        message: "Token not found",
      });
    }

    return successResponse(res, {
      data: {
        token: toPublicTokenView(token),
        queue,
      },
    });
  } catch (error) {
    next(error);
  }
};

export const getPublicQueue = async (
  req,
  res,
  next
) => {
  try {
    const { serving, waiting } =
      await getPublicQueueState();

    return successResponse(res, {
      message: "Queue retrieved successfully",
      data: {
        serving: serving.map(toPublicTokenView),
        waiting: waiting.map(toPublicTokenView),
      },
    });
  } catch (error) {
    next(error);
  }
};

const EMAIL_PATTERN =
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const lookupTokensByEmail = async (
  req,
  res,
  next
) => {
  try {
    const email = String(
      req.query.email || ""
    )
      .trim()
      .toLowerCase();

    if (!EMAIL_PATTERN.test(email)) {
      return res.status(400).json({
        success: false,
        message:
          "A valid email address is required",
      });
    }

    const { customer, items } =
      await getTokensByEmail(email);

    return successResponse(res, {
      message:
        items.length > 0
          ? "Tokens retrieved successfully"
          : "No tokens found for this email",
      data: {
        customer: customer
          ? {
              id: customer._id,
              name: customer.name,
            }
          : null,
        tokens: items.map(
          ({ token, queue }) => ({
            token: toPublicTokenView(token),
            queue,
          })
        ),
      },
    });
  } catch (error) {
    next(error);
  }
};

export const listTokens = async (
  req,
  res,
  next
) => {
  try {
    const { error, value } =
      listTokensQuerySchema.validate(req.query);

    if (error) {
      return res.status(400).json({
        success: false,
        message: "Validation failed",
        errors: error.details.map(
          (item) => item.message
        ),
      });
    }

    const result = await listTokensService(value);

    return successResponse(res, {
      message: "Tokens retrieved successfully",
      data: {
        tokens: result.tokens.map((t) =>
          t.toSafeObject()
        ),
        pagination: {
          page: result.page,
          limit: value.limit,
          total: result.total,
          pages: result.pages,
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

export const getNextToken = async (
  req,
  res,
  next
) => {
  try {
    const token = await getNextTokenService();

    if (!token) {
      return successResponse(res, {
        message: "No waiting tokens in queue",
        data: { token: null },
      });
    }

    return successResponse(res, {
      message: "Next token retrieved",
      data: {
        token: token.toSafeObject(),
      },
    });
  } catch (error) {
    next(error);
  }
};

export const listQueue = async (
  req,
  res,
  next
) => {
  try {
    const tokens = await getQueue({
      serviceId: req.query.serviceId,
    });

    return successResponse(res, {
      message: "Queue retrieved successfully",
      data: {
        count: tokens.length,
        tokens: tokens.map((token) =>
          token.toSafeObject()
        ),
      },
    });
  } catch (error) {
    next(error);
  }
};

export const callExistingToken = async (
  req,
  res,
  next
) => {
  try {
    const { value, error } =
      queueActionSchema.validate(req.body);

    if (error) {
      return res.status(400).json({
        success: false,
        message: "Validation failed",
        errors: error.details.map(
          (item) => item.message
        ),
      });
    }

    const token = await callToken(
      req.params.id,
      {
        userId: req.user._id,
        role: req.user.role,
      }
    );

    // Email the customer that it is their turn. Only fires
    // after the token transitioned to CALLED.
    runAsync(() =>
      sendTurnEmail({
        type: NOTIFICATION_TYPE.TOKEN_CALLED,
        customerRef: token.customer,
        serviceRef: token.service,
        tokenNumber: token.tokenNumber,
        tokenId: token._id,
      })
    );

    notifyCustomer({
      type: NOTIFICATION_TYPE.TOKEN_CALLED,
      title: "Your turn is now",
      message: `Token ${token.tokenNumber} is now called. Please proceed.`,
      customer: token.customer,
      tokenId: token._id,
      tokenNumber: token.tokenNumber,
    });

    broadcastTokenCalled({
      token: token.toSafeObject(),
      serviceId: serviceIdOf(token),
      next: null,
    });

    return successResponse(res, {
      message: "Token called successfully",
      data: {
        token: token.toSafeObject(),
      },
    });
  } catch (error) {
    next(error);
  }
};

export const recallExistingToken = async (
  req,
  res,
  next
) => {
  try {
    const { value, error } =
      queueActionSchema.validate(req.body);

    if (error) {
      return res.status(400).json({
        success: false,
        message: "Validation failed",
        errors: error.details.map(
          (item) => item.message
        ),
      });
    }

    const token = await recallToken(
      req.params.id,
      {
        userId: req.user._id,
        role: req.user.role,
      }
    );

    // Email the customer via the TOKEN_RECALLED event (its own
    // event type) so a recall never duplicates TOKEN_CALLED.
    runAsync(() =>
      sendTurnEmail({
        type: NOTIFICATION_TYPE.TOKEN_RECALLED,
        customerRef: token.customer,
        serviceRef: token.service,
        tokenNumber: token.tokenNumber,
        tokenId: token._id,
      })
    );

    notifyCustomer({
      type: NOTIFICATION_TYPE.TOKEN_RECALLED,
      title: "Your turn is now",
      message: `Token ${token.tokenNumber} has been recalled. Please proceed.`,
      customer: token.customer,
      tokenId: token._id,
      tokenNumber: token.tokenNumber,
    });

    broadcastTokenRecalled({
      token: token.toSafeObject(),
      serviceId: serviceIdOf(token),
    });

    return successResponse(res, {
      message: "Token recalled successfully",
      data: {
        token: token.toSafeObject(),
      },
    });
  } catch (error) {
    next(error);
  }
};

export const startExistingToken = async (
  req,
  res,
  next
) => {
  try {
    const { value, error } =
      queueActionSchema.validate(req.body);

    if (error) {
      return res.status(400).json({
        success: false,
        message: "Validation failed",
        errors: error.details.map(
          (item) => item.message
        ),
      });
    }

    const token = await startToken(
      req.params.id,
      {
        userId: req.user._id,
        role: req.user.role,
      }
    );

    broadcastTokenStarted({
      token: token.toSafeObject(),
      serviceId: serviceIdOf(token),
    });

    return successResponse(res, {
      message: "Service started successfully",
      data: {
        token: token.toSafeObject(),
      },
    });
  } catch (error) {
    next(error);
  }
};

export const completeExistingToken = async (
  req,
  res,
  next
) => {
  try {
    const { value, error } =
      queueActionSchema.validate(req.body);

    if (error) {
      return res.status(400).json({
        success: false,
        message: "Validation failed",
        errors: error.details.map(
          (item) => item.message
        ),
      });
    }

    const result = await completeToken(
      req.params.id,
      {
        userId: req.user._id,
        role: req.user.role,
      }
    );

    const completedSafe =
      result.completedToken.toSafeObject();

    const serviceId =
      completedSafe.service?._id ??
      completedSafe.service;

    const nextSafe = result.nextToken
      ? result.nextToken.toSafeObject()
      : null;

    // The next token was automatically called inside
    // completeToken(). Notify that customer so they know
    // it is their turn.
    if (
      nextSafe?.customer &&
      result.nextToken.customer
    ) {
      // Email the auto-called customer that it is their turn.
      runAsync(() =>
        sendTurnEmail({
          type: NOTIFICATION_TYPE.TOKEN_CALLED,
          customerRef:
            result.nextToken.customer,
          serviceRef: result.nextToken.service,
          tokenNumber: nextSafe.tokenNumber,
          tokenId:
            nextSafe.id ?? nextSafe._id ?? null,
        })
      );

      notifyCustomer({
        type: NOTIFICATION_TYPE.TOKEN_CALLED,
        title: "Your turn is now",
        message: `Token ${nextSafe.tokenNumber} is now called. Please proceed.`,
        customer:
          result.nextToken.customer,
        tokenId: nextSafe.id ?? nextSafe._id ?? null,
        tokenNumber: nextSafe.tokenNumber,
      });
    }

    broadcastTokenCompleted({
      token: completedSafe,
      serviceId,
      nextToken: nextSafe,
      waiting: result.nextWaiting.map(
        (token) => token.toSafeObject()
      ),
      message: nextSafe
        ? `Token ${nextSafe.tokenNumber}, please proceed.`
        : null,
    });

    // Also broadcast TOKEN_CALLED for the newly called
    // token so staff screens and displays update.
    if (nextSafe) {
      broadcastTokenCalled({
        token: nextSafe,
        serviceId: serviceIdOf(nextSafe),
        next: null,
      });
    }

    return successResponse(res, {
      message: "Token completed, next customer called",
      data: {
        completedToken:
          result.completedToken.toSafeObject(),

        nextToken: result.nextToken
          ? result.nextToken.toSafeObject()
          : null,

        waiting: result.nextWaiting.map(
          (token) => token.toSafeObject()
        ),
      },
    });
  } catch (error) {
    next(error);
  }
};

export const skipExistingToken = async (
  req,
  res,
  next
) => {
  try {
    const { value, error } =
      queueActionSchema.validate(req.body);

    if (error) {
      return res.status(400).json({
        success: false,
        message: "Validation failed",
        errors: error.details.map(
          (item) => item.message
        ),
      });
    }

    const token = await skipToken(
      req.params.id,
      {
        userId: req.user._id,
        role: req.user.role,
      }
    );

    broadcastTokenSkipped({
      token: token.toSafeObject(),
      serviceId: serviceIdOf(token),
    });

    return successResponse(res, {
      message: "Token skipped successfully",
      data: {
        token: token.toSafeObject(),
      },
    });
  } catch (error) {
    next(error);
  }
};