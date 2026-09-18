import "dotenv/config";
import test from "node:test";
import http from "node:http";
import mongoose from "mongoose";
import app from "./src/app.js";
import { connectDB } from "./src/config/db.js";
import User from "./src/models/User.js";

let server;
let baseUrl;

test.before(async () => {
  await connectDB();
  await User.deleteMany({ email: /@example$/ });

  await new Promise((resolve) => {
    server = http.createServer(app);
    server.listen(0, () => {
      baseUrl = `http://127.0.0.1:${server.address().port}/api`;
      resolve();
    });
  });
});

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await mongoose.disconnect();
});

test("signup debug", async () => {
  const res = await fetch(`${baseUrl}/auth/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "John Customer", email: "john@example.com", password: "Customer123!" }),
  });
  console.log("STATUS", res.status);
  console.log("BODY", await res.text());
});
