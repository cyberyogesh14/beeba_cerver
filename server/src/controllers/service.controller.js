import {
  createServiceSchema,
  updateServiceSchema,
} from "../validators/service.validator.js";

import {
  createService,
  getServices,
  getServiceById,
  updateService,
  deleteService,
} from "../services/service.service.js";

import { successResponse } from "../utils/apiResponse.js";

export const listServices = async (req, res, next) => {
  try {
    // Public endpoint: default to active only.
    // Admin can override with ?active=false to see all.
    const isActiveExplicit =
      req.query.active !== undefined;

    const services = await getServices({
      activeOnly: isActiveExplicit
        ? req.query.active === "true"
        : true,
    });

    return successResponse(res, {
      data: {
        services: services.map(
          (service) => service.toSafeObject()
        ),
      },
    });
  } catch (error) {
    next(error);
  }
};

export const getSingleService = async (
  req,
  res,
  next
) => {
  try {
    const service = await getServiceById(
      req.params.id
    );

    if (!service) {
      return res.status(404).json({
        success: false,
        message: "Service not found",
      });
    }

    return successResponse(res, {
      data: {
        service: service.toSafeObject(),
      },
    });
  } catch (error) {
    next(error);
  }
};

export const createNewService = async (
  req,
  res,
  next
) => {
  try {
    const { error, value } =
      createServiceSchema.validate(req.body);

    if (error) {
      return res.status(400).json({
        success: false,
        message: "Validation failed",
        errors: error.details.map(
          (item) => item.message
        ),
      });
    }

    const service = await createService(value);

    return successResponse(res, {
      statusCode: 201,
      message: "Service created successfully",
      data: {
        service: service.toSafeObject(),
      },
    });
  } catch (error) {
    next(error);
  }
};

export const updateExistingService = async (
  req,
  res,
  next
) => {
  try {
    const { error, value } =
      updateServiceSchema.validate(req.body);

    if (error) {
      return res.status(400).json({
        success: false,
        message: "Validation failed",
        errors: error.details.map(
          (item) => item.message
        ),
      });
    }

    const service = await updateService(
      req.params.id,
      value
    );

    return successResponse(res, {
      message: "Service updated successfully",
      data: {
        service: service.toSafeObject(),
      },
    });
  } catch (error) {
    next(error);
  }
};

export const removeService = async (
  req,
  res,
  next
) => {
  try {
    const service = await deleteService(
      req.params.id
    );

    // If tokens reference this service, it was deactivated
    // instead of deleted.
    if (!service.isActive) {
      return successResponse(res, {
        message:
          "Service deactivated (tokens reference this service)",
        data: {
          service: service.toSafeObject(),
        },
      });
    }

    return successResponse(res, {
      message: "Service deleted successfully",
    });
  } catch (error) {
    next(error);
  }
};