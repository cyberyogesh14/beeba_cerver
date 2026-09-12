import Service from "../models/Service.js";
import Token from "../models/Token.js";

export const createService = async (data) => {
  const existingService = await Service.findOne({
    $or: [
      { code: data.code.toUpperCase() },
      { prefix: data.prefix.toUpperCase() },
    ],
  });

  if (existingService) {
    throw Object.assign(
      new Error(
        "A service with this code or token prefix already exists"
      ),
      { statusCode: 409 }
    );
  }

  return Service.create({
    ...data,
    code: data.code.toUpperCase(),
    prefix: data.prefix.toUpperCase(),
  });
};

export const getServices = async ({
  activeOnly = false,
} = {}) => {
  const query = activeOnly
    ? { isActive: true }
    : {};

  return Service.find(query).sort({
    name: 1,
  });
};

export const getServiceById = async (id) => {
  return Service.findById(id);
};

export const updateService = async (id, data) => {
  const service = await Service.findById(id);

  if (!service) {
    throw Object.assign(
      new Error("Service not found"),
      { statusCode: 404 }
    );
  }

  if (data.code) {
    data.code = data.code.toUpperCase();
  }

  if (data.prefix) {
    data.prefix = data.prefix.toUpperCase();
  }

  if (
    data.code &&
    data.code !== service.code
  ) {
    const duplicate = await Service.findOne({
      code: data.code,
      _id: { $ne: id },
    });

    if (duplicate) {
      throw Object.assign(
        new Error(
          "A service with this code already exists"
        ),
        { statusCode: 409 }
      );
    }
  }

  if (
    data.prefix &&
    data.prefix !== service.prefix
  ) {
    const duplicate = await Service.findOne({
      prefix: data.prefix,
      _id: { $ne: id },
    });

    if (duplicate) {
      throw Object.assign(
        new Error(
          "A service with this token prefix already exists"
        ),
        { statusCode: 409 }
      );
    }
  }

  Object.assign(service, data);

  return service.save();
};

/**
 * Delete a service. If tokens reference this service,
 * deactivate instead of hard-deleting to preserve
 * historical data integrity.
 */
export const deleteService = async (id) => {
  const service = await Service.findById(id);

  if (!service) {
    throw Object.assign(
      new Error("Service not found"),
      { statusCode: 404 }
    );
  }

  const hasTokens = await Token.exists({
    service: id,
  });

  if (hasTokens) {
    // Cannot hard-delete: tokens reference this service.
    // Deactivate instead to preserve historical data.
    service.isActive = false;
    await service.save();
    return service;
  }

  await service.deleteOne();
  return service;
};