import {
  createCounterSchema,
  updateCounterSchema,
} from "../validators/counter.validator.js";

import {
  createCounter,
  getCounters,
  getCounterById,
  updateCounter,
  deleteCounter,
} from "../services/counter.service.js";

import { successResponse } from "../utils/apiResponse.js";

export const listCounters = async (
  req,
  res,
  next
) => {
  try {
    const counters = await getCounters({
      activeOnly: req.query.active === "true",
    });

    return successResponse(res, {
      data: {
        counters: counters.map(
          (counter) => counter.toSafeObject()
        ),
      },
    });
  } catch (error) {
    next(error);
  }
};

export const getSingleCounter = async (
  req,
  res,
  next
) => {
  try {
    const counter = await getCounterById(
      req.params.id
    );

    if (!counter) {
      return res.status(404).json({
        success: false,
        message: "Counter not found",
      });
    }

    return successResponse(res, {
      data: {
        counter: counter.toSafeObject(),
      },
    });
  } catch (error) {
    next(error);
  }
};

export const createNewCounter = async (
  req,
  res,
  next
) => {
  try {
    const { error, value } =
      createCounterSchema.validate(req.body);

    if (error) {
      return res.status(400).json({
        success: false,
        message: "Validation failed",
        errors: error.details.map(
          (item) => item.message
        ),
      });
    }

    const counter = await createCounter(value);

    const populatedCounter =
      await getCounterById(counter._id);

    return successResponse(res, {
      statusCode: 201,
      message: "Counter created successfully",
      data: {
        counter: populatedCounter.toSafeObject(),
      },
    });
  } catch (error) {
    next(error);
  }
};

export const updateExistingCounter = async (
  req,
  res,
  next
) => {
  try {
    const { error, value } =
      updateCounterSchema.validate(req.body);

    if (error) {
      return res.status(400).json({
        success: false,
        message: "Validation failed",
        errors: error.details.map(
          (item) => item.message
        ),
      });
    }

    const counter = await updateCounter(
      req.params.id,
      value
    );

    const populatedCounter =
      await getCounterById(counter._id);

    return successResponse(res, {
      message: "Counter updated successfully",
      data: {
        counter:
          populatedCounter.toSafeObject(),
      },
    });
  } catch (error) {
    next(error);
  }
};

export const removeCounter = async (
  req,
  res,
  next
) => {
  try {
    const counter = await deleteCounter(
      req.params.id
    );

    // If tokens reference this counter, it was deactivated
    // instead of deleted.
    if (!counter.isActive) {
      return successResponse(res, {
        message:
          "Counter deactivated (tokens reference this counter)",
        data: {
          counter: counter.toSafeObject(),
        },
      });
    }

    return successResponse(res, {
      message: "Counter deleted successfully",
    });
  } catch (error) {
    next(error);
  }
};