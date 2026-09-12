import Counter from "../models/Counter.js";
import User from "../models/User.js";
import Service from "../models/Service.js";
import Token from "../models/Token.js";

export const createCounter = async (data) => {
  const existingCounter = await Counter.findOne({
    number: data.number,
  });

  if (existingCounter) {
    throw Object.assign(
      new Error(
        "A counter with this number already exists"
      ),
      { statusCode: 409 }
    );
  }

  if (data.assignedStaff) {
    const staff = await User.findOne({
      _id: data.assignedStaff,
      role: "staff",
      isActive: true,
    });

    if (!staff) {
      throw Object.assign(
        new Error(
          "Assigned user must be an active staff member"
        ),
        { statusCode: 400 }
      );
    }
  }

  if (data.services?.length) {
    const services = await Service.countDocuments({
      _id: {
        $in: data.services,
      },
      isActive: true,
    });

    if (services !== data.services.length) {
      throw Object.assign(
        new Error(
          "One or more selected services are invalid or inactive"
        ),
        { statusCode: 400 }
      );
    }
  }

  return Counter.create(data);
};

export const getCounters = async ({
  activeOnly = false,
} = {}) => {
  const query = activeOnly
    ? { isActive: true }
    : {};

  return Counter.find(query)
    .populate({
      path: "assignedStaff",
      select: "name email phone role isActive",
    })
    .populate({
      path: "services",
      select:
        "name code prefix estimatedTime prioritySupported isActive",
    })
    .sort({
      number: 1,
    });
};

export const getCounterById = async (id) => {
  return Counter.findById(id)
    .populate({
      path: "assignedStaff",
      select: "name email phone role isActive",
    })
    .populate({
      path: "services",
      select:
        "name code prefix estimatedTime prioritySupported isActive",
    });
};

export const updateCounter = async (id, data) => {
  const counter = await Counter.findById(id);

  if (!counter) {
    throw Object.assign(
      new Error("Counter not found"),
      { statusCode: 404 }
    );
  }

  if (
    data.number &&
    data.number !== counter.number
  ) {
    const duplicate = await Counter.findOne({
      number: data.number,
      _id: { $ne: id },
    });

    if (duplicate) {
      throw Object.assign(
        new Error(
          "A counter with this number already exists"
        ),
        { statusCode: 409 }
      );
    }
  }

  if (data.assignedStaff) {
    const staff = await User.findOne({
      _id: data.assignedStaff,
      role: "staff",
      isActive: true,
    });

    if (!staff) {
      throw Object.assign(
        new Error(
          "Assigned user must be an active staff member"
        ),
        { statusCode: 400 }
      );
    }
  }

  if (data.services) {
    const services = await Service.countDocuments({
      _id: {
        $in: data.services,
      },
      isActive: true,
    });

    if (services !== data.services.length) {
      throw Object.assign(
        new Error(
          "One or more selected services are invalid or inactive"
        ),
        { statusCode: 400 }
      );
    }
  }

  Object.assign(counter, data);

  return counter.save();
};

/**
 * Delete a counter. If tokens reference this counter,
 * deactivate instead of hard-deleting to preserve
 * historical data integrity.
 */
export const deleteCounter = async (id) => {
  const counter = await Counter.findById(id);

  if (!counter) {
    throw Object.assign(
      new Error("Counter not found"),
      { statusCode: 404 }
    );
  }

  const hasTokens = await Token.exists({
    counter: id,
  });

  if (hasTokens) {
    // Cannot hard-delete: tokens reference this counter.
    // Deactivate instead to preserve historical data.
    counter.isActive = false;
    await counter.save();
    return counter;
  }

  await counter.deleteOne();
  return counter;
};