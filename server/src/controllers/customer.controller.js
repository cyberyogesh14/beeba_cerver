import {
  findCustomerByPhone,
} from "../repositories/customer.repository.js";

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