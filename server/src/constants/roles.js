export const ROLES = Object.freeze({
  // Self-registered customer accounts. Customers may also act as
  // accountless guests (booking does not require an account), so
  // this role only enables session/profile features.
  CUSTOMER: "customer",
  STAFF: "staff",
  ADMIN: "admin",
});