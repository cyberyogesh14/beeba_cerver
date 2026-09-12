import {
  createTokenSchema,
  queueActionSchema,
  listTokensQuerySchema,
} from "../validators/token.validator.js";

import {
  generateToken,
  getTokenWithQueue,
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
  getCounterState,
  assignTokenCounter as assignTokenCounterService,
  getPublicQueueState,
} from "../services/queue.service.js";

import {
  broadcastTokenCreated,
  broadcastTokenCalled,
  broadcastTokenRecalled,
  broadcastTokenStarted,
  broadcastTokenCompleted,
  broadcastTokenSkipped,
  broadcastQueueEvent,
} from "../sockets/broadcast.js";

import { SOCKET_EVENTS } from "../constants/socket.js";

import Counter from "../models/Counter.js";
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

const getCounterId = (req) => {
  return (
    req.body.counterId ||
    req.params.counterId ||
    req.query.counterId ||
    req.user.counterId
  );
};

const getCounterNumber = async (counterId) => {
  if (!counterId) return null;

  const counter = await Counter.findById(
    counterId
  ).select("number");

  return counter?.number ?? null;
};

/**
 * Minimal public view of a token. Only exposes safe fields:
 * token number, service/counter name and number, customer
 * name (no phone/email), status and timestamps. Internal
 * history is never exposed publicly.
 */
const toPublicTokenView = (token) => {
  const service = token.service;
  const customer = token.customer;
  const counter = token.counter;

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
    counter:
      counter &&
      typeof counter === "object" &&
      counter._id
        ? {
            id: counter._id,
            number: counter.number,
            name: counter.name,
          }
        : counter?._id ?? counter ?? null,
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
    counter: payload.counterId,
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
  counterId,
}) => {
  return notify({
    type,
    title: subject,
    message: body,
    recipientType: NOTIFICATION_RECIPIENT.CUSTOMER,
    customer: customerId,
    token: tokenId,
    tokenNumber,
    counter: counterId,
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
    counterId: null,
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
  counterNumber,
  tokenNumber,
  tokenId,
  counterId,
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
        ...(counterNumber
          ? [`Please proceed to Counter ${counterNumber}.`]
          : []),
        "",
        "It is your turn. Please proceed to your counter.",
      ].join("\n")
    : [
        `Hi ${customer.name},`,
        "",
        `It is your turn now at ${BUSINESS_NAME}.`,
        ...(serviceName ? [`Service: ${serviceName}`] : []),
        ...(counterNumber
          ? [`Please proceed to Counter ${counterNumber}.`]
          : []),
        `Your token: ${tokenNumber}`,
        "",
        "It is your turn. Please proceed to your counter.",
      ].join("\n");

  notifyCustomerEmail({
    type,
    subject: `Your Turn is Now - ${tokenNumber}`,
    body,
    customerId: customer._id,
    tokenId,
    tokenNumber,
    counterId,
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

    // Email the customer after the token is safely created,
    // and report delivery status to the booking screen. This
    // is still best-effort: a failure never breaks the token
    // response, it is only reflected in the email field.
    let emailInfo = {
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
      queueActionSchema.validate({
        counterId: getCounterId(req),
      });

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
        counterId: value.counterId,
        role: req.user.role,
      }
    );

    const counterNumber =
      await getCounterNumber(
        value.counterId
      );

    // Email the customer that it is their turn. Only fires
    // after the token transitioned to CALLED.
    runAsync(() =>
      sendTurnEmail({
        type: NOTIFICATION_TYPE.TOKEN_CALLED,
        customerRef: token.customer,
        serviceRef: token.service,
        counterNumber,
        tokenNumber: token.tokenNumber,
        tokenId: token._id,
        counterId: value.counterId,
      })
    );

    notifyCustomer({
      type: NOTIFICATION_TYPE.TOKEN_CALLED,
      title: "Your turn is now",
      message: `Token ${token.tokenNumber}, please proceed to Counter ${counterNumber ?? ""}.`,
      customer: token.customer,
      tokenId: token._id,
      tokenNumber: token.tokenNumber,
      counterId: value.counterId,
    });

    broadcastTokenCalled({
      token: token.toSafeObject(),
      serviceId:
        token.service?._id ?? token.service,
      counterId: value.counterId,
      counterNumber,
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
      queueActionSchema.validate({
        counterId: getCounterId(req),
      });

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
        counterId: value.counterId,
        role: req.user.role,
      }
    );

    const counterNumber =
      await getCounterNumber(
        value.counterId
      );

    // Email the customer via the TOKEN_RECALLED event (its own
    // event type) so a recall never duplicates TOKEN_CALLED.
    runAsync(() =>
      sendTurnEmail({
        type: NOTIFICATION_TYPE.TOKEN_RECALLED,
        customerRef: token.customer,
        serviceRef: token.service,
        counterNumber,
        tokenNumber: token.tokenNumber,
        tokenId: token._id,
        counterId: value.counterId,
      })
    );

    notifyCustomer({
      type: NOTIFICATION_TYPE.TOKEN_RECALLED,
      title: "Your turn is now",
      message: `Token ${token.tokenNumber} has been recalled. Please proceed to Counter ${counterNumber ?? ""}.`,
      customer: token.customer,
      tokenId: token._id,
      tokenNumber: token.tokenNumber,
      counterId: value.counterId,
    });

    broadcastTokenRecalled({
      token: token.toSafeObject(),
      serviceId:
        token.service?._id ?? token.service,
      counterId: value.counterId,
      counterNumber,
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
      queueActionSchema.validate({
        counterId: getCounterId(req),
      });

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
        counterId: value.counterId,
        role: req.user.role,
      }
    );

    broadcastTokenStarted({
      token: token.toSafeObject(),
      serviceId:
        token.service?._id ?? token.service,
      counterId: value.counterId,
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
      queueActionSchema.validate({
        counterId: getCounterId(req),
      });

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
        counterId: value.counterId,
        role: req.user.role,
      }
    );

    const counterNumber =
      await getCounterNumber(
        value.counterId
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
    // to proceed to the counter.
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
          counterNumber,
          tokenNumber: nextSafe.tokenNumber,
          tokenId:
            nextSafe.id ?? nextSafe._id ?? null,
          counterId: value.counterId,
        })
      );

      notifyCustomer({
        type: NOTIFICATION_TYPE.TOKEN_CALLED,
        title: "Your turn is now",
        message: `Token ${nextSafe.tokenNumber}, please proceed to Counter ${counterNumber ?? ""}.`,
        customer:
          result.nextToken.customer,
        tokenId: nextSafe.id ?? nextSafe._id ?? null,
        tokenNumber: nextSafe.tokenNumber,
        counterId: value.counterId,
      });
    }

    broadcastTokenCompleted({
      token: completedSafe,
      serviceId,
      counterId: value.counterId,
      counterNumber,
      nextToken: nextSafe,
      waiting: result.nextWaiting.map(
        (token) => token.toSafeObject()
      ),
      message: nextSafe
        ? `Token ${nextSafe.tokenNumber}, please proceed to Counter ${counterNumber ?? ""}.`
        : null,
    });

    // Also broadcast TOKEN_CALLED for the newly called
    // token so staff screens and displays update.
    if (nextSafe) {
      broadcastTokenCalled({
        token: nextSafe,
        serviceId:
          nextSafe.service?._id ??
          nextSafe.service,
        counterId: value.counterId,
        counterNumber,
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
      queueActionSchema.validate({
        counterId: getCounterId(req),
      });

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
        counterId: value.counterId,
        role: req.user.role,
      }
    );

    broadcastTokenSkipped({
      token: token.toSafeObject(),
      serviceId:
        token.service?._id ?? token.service,
      counterId: value.counterId,
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

export const assignTokenCounter = async (
  req,
  res,
  next
) => {
  try {
    const { value, error } =
      queueActionSchema.validate({
        counterId: getCounterId(req),
      });

    if (error) {
      return res.status(400).json({
        success: false,
        message: "Validation failed",
        errors: error.details.map(
          (item) => item.message
        ),
      });
    }

    const token =
      await assignTokenCounterService(
        req.params.id,
        {
          userId: req.user._id,
          counterId: value.counterId,
          role: req.user.role,
        }
      );

    const safe = token.toSafeObject();

    broadcastQueueEvent(
      SOCKET_EVENTS.QUEUE_UPDATED,
      {
        token: safe,
        serviceId:
          safe.service?._id ?? safe.service,
        counterId: value.counterId,
      }
    );

    return successResponse(res, {
      message: "Counter assigned successfully",
      data: {
        token: safe,
      },
    });
  } catch (error) {
    next(error);
  }
};

export const getCurrentToken = async (
  req,
  res,
  next
) => {
  try {
    const { value, error } =
      queueActionSchema.validate({
        counterId: getCounterId(req),
      });

    if (error) {
      return res.status(400).json({
        success: false,
        message: "Validation failed",
        errors: error.details.map(
          (item) => item.message
        ),
      });
    }

    const state = await getCounterState({
      userId: req.user._id,
      counterId: value.counterId,
    });

    return successResponse(res, {
      message: "Counter state retrieved",
      data: {
        counter: state.counter,
        active: state.active
          ? state.active.toSafeObject()
          : null,
        next: state.next
          ? state.next.toSafeObject()
          : null,
      },
    });
  } catch (error) {
    next(error);
  }
};
