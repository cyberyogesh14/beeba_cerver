import {
  findCustomerByPhone,
  findCustomerByEmail,
  createCustomer,
  updateCustomer,
  getCustomerById,
  listCustomers,
  listTokensForCustomer,
} from "../repositories/customer.repository.js";

export const findOrCreateCustomer = async ({
  name,
  phone,
  email,
}) => {
  const normalisedPhone = phone?.trim() || null;
  const normalisedEmail = email?.trim().toLowerCase() || null;

  let customer = normalisedPhone
    ? await findCustomerByPhone(normalisedPhone)
    : null;

  if (!customer && normalisedEmail) {
    customer = await findCustomerByEmail(normalisedEmail);
  }

  if (!customer) {
    customer = await createCustomer({
      name: name.trim(),
      phone: normalisedPhone,
      email: normalisedEmail,
    });

    return customer;
  }

  const updates = {};

  if (name?.trim() && customer.name !== name.trim()) {
    updates.name = name.trim();
  }

  if (
    normalisedEmail &&
    customer.email !== normalisedEmail
  ) {
    updates.email = normalisedEmail;
  }

  if (Object.keys(updates).length > 0) {
    customer = await updateCustomer(
      customer,
      updates
    );
  }

  return customer;
};

/**
 * Admin: fetch a single customer by id.
 */
export const getCustomerByIdService = async (id) => {
  return getCustomerById(id);
};

/**
 * Admin: paginated customer directory.
 */
export const listCustomersService = (options) => {
  return listCustomers(options);
};

/**
 * Admin: full token history for one customer.
 */
export const getCustomerTokensService = (customerId) => {
  return listTokensForCustomer(customerId);
};