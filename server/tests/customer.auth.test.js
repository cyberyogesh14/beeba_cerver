import "dotenv/config";

import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import mongoose from "mongoose";

import app from "../src/app.js";
import { connectDB } from "../src/config/db.js";
import User from "../src/models/User.js";
import Service from "../src/models/Service.js";
import Customer from "../src/models/Customer.js";
import Token from "../src/models/Token.js";
import TokenSequence from "../src/models/TokenSequence.js";
import { generateAccessToken } from "../src/utils/jwt.js";

let server;
let baseUrl;
let adminUser;
let staffUser;
let testService;

const get = (path, token) => {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  return fetch(`${baseUrl}${path}`, { headers });
};

const post = (path, body, token) => {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  return fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
};

test.before(async () => {
  await connectDB();

  await Customer.deleteMany({});
  await Token.deleteMany({});
  await TokenSequence.deleteMany({});

  adminUser = await User.findOne({ role: "admin" });
  staffUser = await User.findOne({ role: "staff" });
  testService = await Service.findOne({ code: "CUT" });

  assert.ok(adminUser, "admin seed must exist");
  assert.ok(staffUser, "staff seed must exist");
  assert.ok(testService, "CUT service must exist");

  await new Promise((resolve) => {
    server = http.createServer(app);
    server.listen(0, () => {
      const { port } = server.address();
      baseUrl = `http://127.0.0.1:${port}/api`;
      resolve();
    });
  });
});

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await User.deleteMany({ email: /@beebaboys\.com$/ });
  await Customer.deleteMany({});
  await mongoose.disconnect();
});

const signupPayload = {
  name: "John Customer",
  email: `john_${Date.now()}@beebaboys.com`,
  password: "Customer123!",
};

test("POST /auth/signup creates a CUSTOMER account and returns a token", async () => {
  const res = await post("/auth/signup", signupPayload);
  const body = await res.json();

  assert.equal(res.status, 201);
  assert.equal(body.success, true);
  assert.ok(body.data.token, "signup should return a token");
  assert.equal(body.data.user.role, "customer");
  assert.equal(body.data.user.email, signupPayload.email);

  const stored = await User.findById(body.data.user.id);
  assert.equal(stored.role, "customer");
  assert.equal(stored.isActive, true);
});

test("POST /auth/signup rejects a duplicate email", async () => {
  const dupPayload = {
    name: "Duplicate User",
    email: `dup_${Date.now()}@beebaboys.com`,
    password: "Customer123!",
  };

  const first = await post("/auth/signup", dupPayload);
  assert.equal(first.status, 201);

  const second = await post("/auth/signup", dupPayload);
  const body = await second.json();

  assert.equal(second.status, 409);
  assert.equal(body.success, false);
});

test("POST /auth/signup validates the payload", async () => {
  const res = await post("/auth/signup", {
    name: "X",
    email: "not-an-email",
    password: "short",
  });
  const body = await res.json();

  assert.equal(res.status, 400);
  assert.equal(body.success, false);
  assert.ok(Array.isArray(body.errors) && body.errors.length >= 1);
});

test("a customer account can log in", async () => {
  const res = await post("/auth/login", {
    email: signupPayload.email,
    password: signupPayload.password,
  });
  const body = await res.json();

  assert.equal(res.status, 200);
  assert.equal(body.success, true);
  assert.equal(body.data.user.role, "customer");
});

test("GET /auth/me works for a customer account", async () => {
  const login = await post("/auth/login", {
    email: signupPayload.email,
    password: signupPayload.password,
  });
  const { token } = (await login.json()).data;

  const res = await get("/auth/me", token);
  const body = await res.json();

  assert.equal(res.status, 200);
  assert.equal(body.data.user.role, "customer");
});

test("a customer cannot call staff/admin endpoints (RBAC)", async () => {
  const login = await post("/auth/login", {
    email: signupPayload.email,
    password: signupPayload.password,
  });
  const { token } = (await login.json()).data;

  const queue = await get("/tokens/queue", token);
  assert.equal(queue.status, 403);

  const users = await get("/users", token);
  assert.equal(users.status, 403);

  const analytics = await get("/analytics/overview", token);
  assert.equal(analytics.status, 403);
});

test("POST /tokens/:id/cancel is public and stops a WAITING token", async () => {
  const createRes = await post("/tokens", {
    serviceId: testService._id.toString(),
    customer: {
      name: "Cancel Tester",
      email: `cancel_${Date.now()}@beebaboys.com`,
    },
  });
  const created = await createRes.json();

  assert.equal(createRes.status, 201);

  const tokenId = created.data.token.id;

  const cancelRes = await post(`/tokens/${tokenId}/cancel`, {});
  const cancelled = await cancelRes.json();

  assert.equal(cancelRes.status, 200);
  assert.equal(cancelled.data.token.status, "CANCELLED");

  // A cancelled token is gone from the staff waiting queue.
  const adminToken = generateAccessToken(adminUser);
  const queueRes = await get("/tokens/queue", adminToken);
  const queueBody = await queueRes.json();

  const found = queueBody.data.tokens.some(
    (token) => token.id === tokenId
  );
  assert.equal(found, false);
});

test("cancelling a non-waiting token returns 409", async () => {
  const createRes = await post("/tokens", {
    serviceId: testService._id.toString(),
    customer: {
      name: "Already Called",
      email: `called_${Date.now()}@beebaboys.com`,
    },
  });
  const created = await createRes.json();
  const tokenId = created.data.token.id;

  const adminToken = generateAccessToken(adminUser);
  const callRes = await post(
    `/tokens/${tokenId}/call`,
    {},
    adminToken
  );
  assert.equal(callRes.status, 200);

  const cancelRes = await post(`/tokens/${tokenId}/cancel`, {});
  assert.equal(cancelRes.status, 409);
});

test("POST /tokens/:id/no-show is staff/admin only and marks CALLED tokens", async () => {
  const createRes = await post("/tokens", {
    serviceId: testService._id.toString(),
    customer: {
      name: "No Show Tester",
      email: `noshow_${Date.now()}@beebaboys.com`,
    },
  });
  const created = await createRes.json();
  const tokenId = created.data.token.id;

  const adminToken = generateAccessToken(adminUser);

  const callRes = await post(
    `/tokens/${tokenId}/call`,
    {},
    adminToken
  );
  assert.equal(callRes.status, 200);

  const noShowRes = await post(
    `/tokens/${tokenId}/no-show`,
    {},
    adminToken
  );
  const body = await noShowRes.json();

  assert.equal(noShowRes.status, 200);
  assert.equal(body.data.token.status, "NO_SHOW");
});

test("POST /tokens/:id/no-show rejects a customer token", async () => {
  const login = await post("/auth/login", {
    email: signupPayload.email,
    password: signupPayload.password,
  });
  const { token } = (await login.json()).data;

  const res = await post(
    "/tokens/000000000000000000000000/no-show",
    {},
    token
  );

  assert.equal(res.status, 403);
});

test("GET /api/customers list/detail/tokens is admin-only", async () => {
  const adminToken = generateAccessToken(adminUser);

  const customer = await Customer.create({
    name: "Directory Customer",
    email: `dir_${Date.now()}@beebaboys.com`,
  });

  await Token.create({
    tokenNumber: "H-999",
    dateKey: "2099-01-01",
    sequenceNumber: 999,
    service: testService._id,
    customer: customer._id,
    status: "COMPLETED",
  });

  const listRes = await get("/customers", adminToken);
  const list = await listRes.json();
  assert.equal(listRes.status, 200);
  assert.ok(list.data.customers.length >= 1);

  const detailRes = await get(
    `/customers/${customer._id.toString()}`,
    adminToken
  );
  const detail = await detailRes.json();
  assert.equal(detailRes.status, 200);
  assert.equal(detail.data.customer.id, customer._id.toString());

  const tokensRes = await get(
    `/customers/${customer._id.toString()}/tokens`,
    adminToken
  );
  const tokens = await tokensRes.json();
  assert.equal(tokensRes.status, 200);
  assert.equal(tokens.data.count, 1);
  assert.equal(tokens.data.tokens[0].tokenNumber, "H-999");

  const staffToken = generateAccessToken(staffUser);
  const staffDenied = await get("/customers", staffToken);
  assert.equal(staffDenied.status, 403);
});

test("GET /api/customers/search filters by name", async () => {
  const adminToken = generateAccessToken(adminUser);

  const res = await get(
    `/customers?search=Directory&limit=10`,
    adminToken
  );
  const body = await res.json();

  assert.equal(res.status, 200);
  assert.ok(body.data.customers.length >= 1);
  assert.ok(
    body.data.customers.every((customer) =>
      /directory/i.test(customer.name)
    )
  );
});