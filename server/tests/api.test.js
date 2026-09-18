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
import Notification from "../src/models/Notification.js";
import Token from "../src/models/Token.js";
import { generateAccessToken } from "../src/utils/jwt.js";

let server;
let baseUrl;
let adminToken;
let staffToken;
let adminUser;
let staffUser;
let testService;
let loginUser;
let loginUserPassword;

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

const patch = (path, body, token) => {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  return fetch(`${baseUrl}${path}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify(body),
  });
};

const put = (path, body, token) => {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  return fetch(`${baseUrl}${path}`, {
    method: "PUT",
    headers,
    body: JSON.stringify(body),
  });
};

const del = (path, token) => {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  return fetch(`${baseUrl}${path}`, {
    method: "DELETE",
    headers,
  });
};

test.before(async () => {
  await connectDB();

  await Notification.deleteMany({});
  await Customer.deleteMany({});
  await import("../src/models/Token.js").then(({ default: Token }) =>
    Token.deleteMany({})
  );
  await import("../src/models/TokenSequence.js").then(({ default: TS }) =>
    TS.deleteMany({})
  );

  adminUser = await User.findOne({ role: "admin" });
  staffUser = await User.findOne({ role: "staff" });
  testService = await Service.findOne({ code: "CUT" });

  assert.ok(adminUser, "admin seed must exist");
  assert.ok(staffUser, "staff seed must exist");
  assert.ok(testService, "CUT service must exist");

  adminToken = generateAccessToken(adminUser);
  staffToken = generateAccessToken(staffUser);

  // Create a user with a known password for login tests
  loginUserPassword = "TestLogin123!";
  loginUser = await User.create({
    name: "Login Test User",
    email: `logintest_${Date.now()}@example.com`,
    password: loginUserPassword,
    role: "staff",
    isActive: true,
  });

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
  // Cleanup the test login user
  if (loginUser?._id) {
    await User.deleteOne({ _id: loginUser._id });
  }
  await mongoose.disconnect();
});

// ─── HEALTH ───────────────────────────────────────

test("GET /api/health returns 200", async () => {
  const res = await fetch(`${baseUrl}/health`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.success, true);
});

// ─── AUTH ─────────────────────────────────────────

test("POST /api/auth/login with valid credentials returns token", async () => {
  const res = await post("/auth/login", {
    email: loginUser.email,
    password: loginUserPassword,
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.success, true);
  assert.ok(body.data.token);
  assert.ok(body.data.user);
  assert.equal(body.data.user.role, "staff");
  assert.equal(body.data.user.password, undefined);
});

test("POST /api/auth/login with invalid credentials returns 401", async () => {
  const res = await post("/auth/login", {
    email: adminUser.email,
    password: "wrongpassword",
  });
  assert.equal(res.status, 401);
  const body = await res.json();
  assert.equal(body.success, false);
});

test("GET /api/auth/me returns current user", async () => {
  const res = await get("/auth/me", adminToken);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.data.user.email, adminUser.email);
  assert.equal(body.data.user.password, undefined);
});

test("GET /api/auth/me without token returns 401", async () => {
  const res = await get("/auth/me");
  assert.equal(res.status, 401);
});

test("GET /api/auth/me with invalid token returns 401", async () => {
  const res = await get("/auth/me", "invalid.jwt.token");
  assert.equal(res.status, 401);
});

test("POST /api/auth/logout returns success", async () => {
  const res = await post("/auth/logout", {}, adminToken);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.success, true);
});

// ─── USERS ────────────────────────────────────────

test("GET /api/users returns paginated users for admin", async () => {
  const res = await get("/users", adminToken);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(Array.isArray(body.data.users));
  assert.ok(body.data.pagination);
  assert.ok(body.data.pagination.total >= 2);
  // No password fields leaked
  for (const u of body.data.users) {
    assert.equal(u.password, undefined);
  }
});

test("GET /api/users with pagination params", async () => {
  const res = await get("/users?page=1&limit=1", adminToken);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.data.users.length, 1);
  assert.equal(body.data.pagination.page, 1);
  assert.equal(body.data.pagination.limit, 1);
});

test("GET /api/users returns 403 for staff", async () => {
  const res = await get("/users", staffToken);
  assert.equal(res.status, 403);
});

test("POST /api/users creates a new user for admin", async () => {
  const res = await post(
    "/users",
    {
      name: "Test Staff",
      email: `teststaff_${Date.now()}@example.com`,
      password: "TestPass123!",
      role: "staff",
    },
    adminToken
  );
  assert.equal(res.status, 201);
  const body = await res.json();
  assert.equal(body.success, true);
  assert.equal(body.data.user.password, undefined);
  assert.equal(body.data.user.role, "staff");

  // Cleanup
  await User.deleteOne({ _id: body.data.user.id });
});

test("POST /api/users with duplicate email returns 409", async () => {
  const res = await post(
    "/users",
    {
      name: "Dup Email",
      email: adminUser.email,
      password: "TestPass123!",
      role: "staff",
    },
    adminToken
  );
  assert.equal(res.status, 409);
});

test("PUT /api/users/:id updates a user", async () => {
  const res = await put(
    `/users/${staffUser._id}`,
    { name: "Updated Staff Name" },
    adminToken
  );
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.data.user.name, "Updated Staff Name");

  // Revert
  await put(
    `/users/${staffUser._id}`,
    { name: staffUser.name },
    adminToken
  );
});

test("PUT /api/users/:id with duplicate email returns 409", async () => {
  const res = await put(
    `/users/${staffUser._id}`,
    { email: adminUser.email },
    adminToken
  );
  assert.equal(res.status, 409);
});

test("DELETE /api/users/:id prevents self-deletion", async () => {
  const res = await del(`/users/${adminUser._id}`, adminToken);
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.ok(body.message.includes("cannot delete your own"));
});

test("GET /api/users with invalid ID returns 400", async () => {
  const res = await get("/users/not-a-valid-id", adminToken);
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.message, "Invalid ID format");
});

// ─── SERVICES ─────────────────────────────────────

test("GET /api/services returns only active services publicly", async () => {
  const res = await get("/services");
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(Array.isArray(body.data.services));
  for (const s of body.data.services) {
    assert.equal(s.isActive, true);
  }
});

test("POST /api/services creates a service for admin", async () => {
  const code = `TEST${Date.now()}`;
  const res = await post(
    "/services",
    {
      name: "Test Service",
      code,
      prefix: "T",
      estimatedTime: 15,
    },
    adminToken
  );
  assert.equal(res.status, 201);
  const body = await res.json();
  assert.equal(body.data.service.code, code);

  // Cleanup
  await Service.deleteOne({ _id: body.data.service.id });
});

test("POST /api/services with duplicate code returns 409", async () => {
  const res = await post(
    "/services",
    {
      name: "Dup Code",
      code: testService.code,
      prefix: "DUP",
      estimatedTime: 10,
    },
    adminToken
  );
  assert.equal(res.status, 409);
});

test("GET /api/services/:id with invalid ID returns 400", async () => {
  const res = await get("/services/badid", adminToken);
  assert.equal(res.status, 400);
});

// ─── TOKENS ───────────────────────────────────────

test("POST /api/tokens creates a token (public)", async () => {
  const res = await post("/tokens", {
    serviceId: testService._id,
    customer: {
      name: "API Test Customer",
      phone: "0499000111",
    },
  });
  assert.equal(res.status, 201);
  const body = await res.json();
  assert.equal(body.success, true);
  assert.ok(body.data.token);
  assert.ok(body.data.customer);
  assert.ok(body.data.queue);
});

test("POST /api/tokens with the same idempotency key returns the same token", async () => {
  const key = `idem-api-${Date.now()}`;
  const payload = {
    serviceId: testService._id,
    customer: {
      name: "Idempotency API Customer",
      phone: "0499000999",
    },
    idempotencyKey: key,
  };

  const first = await post("/tokens", payload);
  assert.equal(first.status, 201);
  const firstBody = await first.json();
  assert.equal(firstBody.data.duplicate, false);

  const replay = await post("/tokens", payload);
  assert.equal(replay.status, 201);
  const replayBody = await replay.json();
  assert.equal(replayBody.data.duplicate, true);
  assert.equal(
    replayBody.data.token.id,
    firstBody.data.token.id,
    "duplicate request resolves to the original token"
  );
  assert.equal(
    replayBody.data.token.tokenNumber,
    firstBody.data.token.tokenNumber
  );

  const count = await Token.countDocuments({
    tokenNumber: firstBody.data.token.tokenNumber,
  });
  assert.equal(count, 1, "only one token exists for that number");
});

test("GET /api/tokens lists tokens for staff/admin", async () => {
  const res = await get("/tokens", staffToken);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(Array.isArray(body.data.tokens));
  assert.ok(body.data.pagination);
});

test("GET /api/tokens with pagination and status filter", async () => {
  const res = await get(
    "/tokens?page=1&limit=5&status=WAITING",
    staffToken
  );
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(body.data.tokens.length <= 5);
  for (const t of body.data.tokens) {
    assert.equal(t.status, "WAITING");
  }
});

test("GET /api/tokens returns 401 without auth", async () => {
  const res = await get("/tokens");
  assert.equal(res.status, 401);
});

test("GET /api/tokens search matches token number and customer", async () => {
  const marker = `SearchProbe${Date.now()}`;
  const createRes = await post("/tokens", {
    serviceId: testService._id,
    customer: {
      name: marker,
      phone: "0499123456",
    },
  });
  assert.equal(createRes.status, 201);
  const { token, customer } = (await createRes.json()).data;

  const byName = await get(`/tokens?search=${encodeURIComponent(marker)}`, staffToken);
  assert.equal(byName.status, 200);
  const nameBody = await byName.json();
  assert.ok(
    nameBody.data.tokens.some((t) => t.id === token.id),
    "token found by customer name search"
  );

  const byNumber = await get(`/tokens?search=${encodeURIComponent(token.tokenNumber)}`, staffToken);
  assert.equal(byNumber.status, 200);
  const numberBody = await byNumber.json();
  assert.ok(
    numberBody.data.tokens.some((t) => t.id === token.id),
    "token found by token number search"
  );

  const byPhone = await get(`/tokens?search=0499123456`, staffToken);
  assert.equal(byPhone.status, 200);
  const phoneBody = await byPhone.json();
  assert.ok(
    phoneBody.data.tokens.some((t) => t.id === token.id),
    "token found by customer phone search"
  );

  const empty = await get(`/tokens?search=${encodeURIComponent(marker + "zzz")}`, staffToken);
  assert.equal(empty.status, 200);
  const emptyBody = await empty.json();
  assert.equal(emptyBody.data.tokens.length, 0);
});

test("GET /api/tokens search escapes special characters", async () => {
  const res = await get("/tokens?search=.*[]${}%2F", staffToken);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(Array.isArray(body.data.tokens));
});

test("GET /api/tokens/queue returns waiting tokens", async () => {
  const res = await get("/tokens/queue", staffToken);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(Array.isArray(body.data.tokens));
  for (const t of body.data.tokens) {
    assert.equal(t.status, "WAITING");
  }
});

test("GET /api/tokens/next returns next eligible token", async () => {
  const res = await get("/tokens/next", staffToken);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.success, true);
  // Token may or may not exist depending on queue state
  if (body.data.token) {
    assert.equal(body.data.token.status, "WAITING");
  }
});

test("POST /api/tokens/:id/call calls a token", async () => {
  // First create a fresh token
  const createRes = await post("/tokens", {
    serviceId: testService._id,
    customer: {
      name: "Call Test Customer",
      phone: "0499000222",
    },
  });
  const { data } = await createRes.json();

  const res = await post(
    `/tokens/${data.token.id}/call`,
    {},
    staffToken
  );
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.data.token.status, "CALLED");

  // Cleanup: skip the token so it is no longer active.
  await post(
    `/tokens/${data.token.id}/skip`,
    {},
    staffToken
  );
});

test("POST /api/tokens/:id/call with invalid ID returns 400", async () => {
  const res = await post(
    "/tokens/badid/call",
    {},
    staffToken
  );
  assert.equal(res.status, 400);
});

test("GET /api/tokens/:id returns token details (public)", async () => {
  const createRes = await post("/tokens", {
    serviceId: testService._id,
    customer: {
      name: "Detail Test",
      phone: "0499000333",
    },
  });
  const { data } = await createRes.json();

  const res = await get(`/tokens/${data.token.id}`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.data.token.tokenNumber, data.token.tokenNumber);
});

test("GET /api/tokens/:id with non-existent ID returns 404", async () => {
  const fakeId = "000000000000000000000000";
  const res = await get(`/tokens/${fakeId}`);
  assert.equal(res.status, 404);
});

test("GET /api/tokens/lookup returns tokens by email", async () => {
  const email = "lookup@test.com";

  const first = await post("/tokens", {
    serviceId: testService._id,
    customer: {
      name: "Lookup Test",
      email,
    },
  });
  const { data: firstData } = await first.json();

  const second = await post("/tokens", {
    serviceId: testService._id,
    customer: {
      name: "Lookup Test",
      email,
    },
  });
  const { data: secondData } = await second.json();

  const res = await get(`/tokens/lookup?email=${encodeURIComponent(email)}`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.success, true);
  assert.ok(Array.isArray(body.data.tokens));
  assert.ok(body.data.tokens.length >= 2, "all tokens for the email are returned");

  const numbers = body.data.tokens.map((t) => t.token.tokenNumber);
  assert.ok(numbers.includes(firstData.token.tokenNumber));
  assert.ok(numbers.includes(secondData.token.tokenNumber));
});

test("GET /api/tokens/lookup with unknown email returns empty list", async () => {
  const res = await get(
    `/tokens/lookup?email=${encodeURIComponent("nobody@test.com")}`
  );
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.data.customer, null);
  assert.deepEqual(body.data.tokens, []);
});

test("GET /api/tokens/lookup with missing email returns 400", async () => {
  const res = await get("/tokens/lookup");
  assert.equal(res.status, 400);
});

// ─── NOTIFICATIONS ────────────────────────────────

test("GET /api/notifications returns notifications for staff", async () => {
  const res = await get("/notifications", staffToken);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(Array.isArray(body.data.notifications));
});

test("GET /api/notifications/unread/count returns count", async () => {
  const res = await get("/notifications/unread/count", staffToken);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(typeof body.data.count, "number");
});

test("GET /api/notifications returns 401 without auth", async () => {
  const res = await get("/notifications");
  assert.equal(res.status, 401);
});

test("POST /api/notifications/:id/retry with invalid ID returns 400", async () => {
  const res = await post(
    "/notifications/badid/retry",
    {},
    staffToken
  );
  assert.equal(res.status, 400);
});

// ─── ANALYTICS ────────────────────────────────────

test("GET /api/analytics/overview returns for admin", async () => {
  const res = await get("/analytics/overview", adminToken);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(body.data);
});

test("GET /api/analytics/overview returns 403 for staff", async () => {
  const res = await get("/analytics/overview", staffToken);
  assert.equal(res.status, 403);
});

// ─── SECURITY ─────────────────────────────────────

test("GET /api/users/:id with non-existent ID returns 404", async () => {
  const fakeId = "000000000000000000000000";
  const res = await get(`/users/${fakeId}`, adminToken);
  assert.equal(res.status, 404);
});

test("PUT /api/users/:id with non-existent ID returns 404", async () => {
  const fakeId = "000000000000000000000000";
  const res = await put(
    `/users/${fakeId}`,
    { name: "Ghost" },
    adminToken
  );
  assert.equal(res.status, 404);
});

test("DELETE /api/users/:id with non-existent ID returns 404", async () => {
  const fakeId = "000000000000000000000000";
  const res = await del(`/users/${fakeId}`, adminToken);
  assert.equal(res.status, 404);
});

test("POST /api/tokens with invalid body returns 400", async () => {
  const res = await post("/tokens", { bad: "data" });
  assert.equal(res.status, 400);
});

test("GET /api/nonexistent returns 404", async () => {
  const res = await get("/nonexistent");
  assert.equal(res.status, 404);
});
