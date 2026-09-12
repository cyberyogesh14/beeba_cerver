import {
  findCustomerByPhone,
  findCustomerByEmail,
  createCustomer,
  updateCustomer,
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