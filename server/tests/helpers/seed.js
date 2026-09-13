/**
 * Seed helper for the automated test suites.
 *
 * Provisioned the base fixtures the test files rely on:
 * an admin user, a staff user, and the CUT / BEARD / STYLE
 * services.
 *
 * Run against a disposable database (see run-tests.mjs).
 */
import User from "../../src/models/User.js";
import Service from "../../src/models/Service.js";

export const seedFixtures = async () => {
  const admin =
    (await User.findOne({ role: "admin" })) ||
    (await User.create({
      name: "System Administrator",
      email: "admin@beebaboys.com",
      password: "TestPass123!",
      role: "admin",
      isActive: true,
    }));

  const staff =
    (await User.findOne({ role: "staff" })) ||
    (await User.create({
      name: "Barber Staff",
      email: "staff@beebaboys.com",
      password: "TestPass123!",
      role: "staff",
      isActive: true,
    }));

  const cut =
    (await Service.findOne({ code: "CUT" })) ||
    (await Service.create({
      name: "Haircut",
      code: "CUT",
      prefix: "H",
      estimatedTime: 15,
    }));

  const beard =
    (await Service.findOne({ code: "BEARD" })) ||
    (await Service.create({
      name: "Beard Trim",
      code: "BEARD",
      prefix: "B",
      estimatedTime: 10,
    }));

  const style =
    (await Service.findOne({ code: "STYLE" })) ||
    (await Service.create({
      name: "Hair Styling",
      code: "STYLE",
      prefix: "S",
      estimatedTime: 30,
    }));

  return { admin, staff, cut, beard, style };
};