import Customer from "../models/Customer.js";

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