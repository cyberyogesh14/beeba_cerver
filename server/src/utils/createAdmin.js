import "dotenv/config";

import { connectDB } from "../config/db.js";
import User from "../models/User.js";

const ADMIN_EMAIL = "admin@beebaboys.com";
// Allow an override so the bootstrap password is not
// hard-coded in the repository.
const ADMIN_PASSWORD =
  process.env.ADMIN_PASSWORD || "ChangeMe123!";

const createAdmin = async ({ reset } = {}) => {
  try {
    await connectDB();

    let admin = await User.findOne({
      email: ADMIN_EMAIL,
    });

    if (admin && !reset) {
      console.log(
        "Admin already exists. Use --reset to reset the admin password."
      );
      process.exit(0);
    }

    if (admin && reset) {
      // Assigning the property then saving triggers the
      // pre-save hook, so the password is hashed exactly
      // once via bcrypt.
      admin.password = ADMIN_PASSWORD;
      admin.isActive = true;
      await admin.save();

      console.log("Admin password reset:");
      console.log(admin.email);

      process.exit(0);
    }

    const created = await User.create({
      name: "System Administrator",
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD,
      role: "admin",
      isActive: true,
    });

    console.log("Admin created:");
    console.log(created.email);

    process.exit(0);
  } catch (error) {
    console.error("Failed to create/reset admin:", error);
    process.exit(1);
  }
};

const reset = process.argv.includes("--reset");

createAdmin({ reset });