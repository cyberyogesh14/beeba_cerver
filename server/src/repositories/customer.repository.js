import Customer from "../models/Customer.js";

import Token from "../models/Token.js";

export const findCustomerByPhone = async (
  phone
) => {
  if (!phone?.trim()) return null;
  return Customer.findOne({
    phone: phone.trim(),
  });
};

export const findCustomerByEmail = async (
  email
) => {
  const normalised = email?.trim().toLowerCase();
  if (!normalised) return null;
  return Customer.findOne({
    email: normalised,
  });
};

export const getCustomerById = async (id) => {
  return Customer.findById(id);
};

/**
 * List customers with optional search and pagination.
 *
 * Search matches name (case-insensitive), email and phone using a
 * prefix-free regex so "jo" finds "John". Pagination mirrors the
 * tokens list contract: { items, total, page, pages, limit }.
 */
export const listCustomers = async ({
  page = 1,
  limit = 20,
  search,
} = {}) => {
  const filter = {};

  if (search?.trim()) {
    const term = search.trim();

    filter.$or = [
      { name: { $regex: term, $options: "i" } },
      { email: { $regex: term, $options: "i" } },
      { phone: { $regex: term, $options: "i" } },
    ];
  }

  const skip = (page - 1) * limit;

  const [items, total] = await Promise.all([
    Customer.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit),
    Customer.countDocuments(filter),
  ]);

  return {
    items,
    total,
    page,
    limit,
    pages: Math.ceil(total / limit),
  };
};

/**
 * All tokens (with queue position) for a single customer, newest
 * first. Includes non-populated customer so consumers can render
 * the token list without an extra lookup.
 */
export const listTokensForCustomer = async (customerId) => {
  return Token.find({ customer: customerId })
    .populate("service")
    .populate("customer")
    .sort({ createdAt: -1 });
};

export const createCustomer = async (data) => {
  return Customer.create(data);
};

export const updateCustomer = async (
  customer,
  data
) => {
  Object.assign(customer, data);

  return customer.save();
};