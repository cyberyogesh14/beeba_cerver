import {
  findCustomerByPhone,
} from "../repositories/customer.repository.js";

import {
  getCustomerByIdService,
  listCustomersService,
  getCustomerTokensService,
} from "../services/customer.service.js";

import { successResponse } from "../utils/apiResponse.js";

export const getCustomerByPhone = async (
  req,
  res,
  next
) => {
  try {
    const customer =
      await findCustomerByPhone(
        req.params.phone
      );

    if (!customer) {
      return res.status(404).json({
        success: false,
        message: "Customer not found",
      });
    }

    return successResponse(res, {
      data: {
        customer:
          customer.toSafeObject(),
      },
    });
  } catch (error) {
    next(error);
  }
};

export const listCustomers = async (
  req,
  res,
  next
) => {
  try {
    const page = Math.max(
      1,
      Number(req.query.page) || 1
    );

    const limit = Math.min(
      100,
      Math.max(1, Number(req.query.limit) || 20)
    );

    const result = await listCustomersService({
      page,
      limit,
      search: String(req.query.search || ""),
    });

    return successResponse(res, {
      message: "Customers retrieved successfully",
      data: {
        customers: result.items.map((customer) =>
          customer.toSafeObject()
        ),
        pagination: {
          page: result.page,
          limit: result.limit,
          total: result.total,
          pages: result.pages,
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

export const getCustomerById = async (
  req,
  res,
  next
) => {
  try {
    const customer =
      await getCustomerByIdService(req.params.id);

    if (!customer) {
      return res.status(404).json({
        success: false,
        message: "Customer not found",
      });
    }

    return successResponse(res, {
      data: {
        customer:
          customer.toSafeObject(),
      },
    });
  } catch (error) {
    next(error);
  }
};

export const getCustomerTokens = async (
  req,
  res,
  next
) => {
  try {
    const customer =
      await getCustomerByIdService(req.params.id);

    if (!customer) {
      return res.status(404).json({
        success: false,
        message: "Customer not found",
      });
    }

    const tokens =
      await getCustomerTokensService(customer._id);

    return successResponse(res, {
      data: {
        customer:
          customer.toSafeObject(),
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