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

import { notify } from "../src/services/notification.service.js";

import { generateAccessToken } from "../src/utils/jwt.js";

import {
  NOTIFICATION_TYPE,
  NOTIFICATION_CHANNEL,
  NOTIFICATION_STATUS,
  NOTIFICATION_PROVIDER,
} from "../src/constants/notification.js";

let server;
let baseUrl;
let staff;
let staffToken;
let service;

const post = (path, body, token) => {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  return fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
};

const waitFor = async (
  predicate,
  { timeout = 6000, interval = 50 } = {}
) => {
  const start = Date.now();

  while (Date.now() - start < timeout) {
    const result = await predicate();
    if (result) return result;
    await new Promise((resolve) => setTimeout(resolve, interval));
  }

  throw new Error("Timed out waiting for condition");
};

const findEmailNotification = (tokenId, type) =>
  Notification.findOne({
    token: tokenId,
    type,
    channel: NOTIFICATION_CHANNEL.EMAIL,
  }).sort({ createdAt: -1 });

const findFailedEmailNotification = (tokenId, type) =>
  Notification.findOne({
    token: tokenId,
    type,
    channel: NOTIFICATION_CHANNEL.EMAIL,
    status: NOTIFICATION_STATUS.FAILED,
  }).sort({ createdAt: -1 });

const createToken = (email) =>
  post("/tokens", {
    serviceId: service._id,
    customer: {
      name: "Email Customer",
      phone: `0499${String(Math.floor(100000 + Math.random() * 899999))}`,
      email,
    },
  });

test.before(async () => {
  await connectDB();

  staff = await User.findOne({ role: "staff" });
  service = await Service.findOne({ code: "CUT" });

  assert.ok(staff && service, "seed fixtures present");

  staffToken = generateAccessToken(staff);

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
  await mongoose.disconnect();
});

test.beforeEach(async () => {
  await Notification.deleteMany({});
  await Customer.deleteMany({});
  await import("../src/models/Token.js").then(({ default: Token }) =>
    Token.deleteMany({})
  );
  await import("../src/models/TokenSequence.js").then(({ default: TS }) =>
    TS.deleteMany({})
  );
});

// ─── TOKEN_CREATED email ───────────────────────────────

test("token generation sends a TOKEN_CREATED email to the customer", async () => {
  process.env.NOTIFICATION_PROVIDER = NOTIFICATION_PROVIDER.MOCK;
  delete process.env.EMAIL_HOST;

  const res = await createToken("created@example.com");
  assert.equal(res.status, 201);
  const { data } = await res.json();

  const nt = await waitFor(() =>
    findEmailNotification(data.token.id, NOTIFICATION_TYPE.TOKEN_CREATED)
  );

  assert.ok(nt, "TOKEN_CREATED email notification persisted");
  assert.equal(nt.tokenNumber, data.token.tokenNumber);
  assert.equal(nt.customer.toString(), data.customer.id);
  assert.equal(nt.channel, NOTIFICATION_CHANNEL.EMAIL);
  assert.ok(
    nt.title.startsWith("Your Queue Token - "),
    `title should carry the token number, got "${nt.title}"`
  );
  assert.ok(nt.title.includes(data.token.tokenNumber));
  assert.equal(
    nt.status,
    NOTIFICATION_STATUS.SENT,
    "mocked email delivery should be SENT"
  );
  assert.equal(nt.provider, NOTIFICATION_PROVIDER.MOCK);
  assert.ok(nt.message.includes("track"), "body mentions tracking");
});

// ─── TOKEN_CALLED email (manual call) ──────────────────

test("calling a token sends a TOKEN_CALLED email to the customer", async () => {
  process.env.NOTIFICATION_PROVIDER = NOTIFICATION_PROVIDER.MOCK;
  delete process.env.EMAIL_HOST;

  const res = await createToken("called@example.com");
  assert.equal(res.status, 201);
  const { data } = await res.json();

  const call = await post(
    `/tokens/${data.token.id}/call`,
    {},
    staffToken
  );
  assert.equal(call.status, 200);
  const callBody = await call.json();
  assert.equal(callBody.data.token.status, "CALLED");

  const nt = await waitFor(() =>
    findEmailNotification(data.token.id, NOTIFICATION_TYPE.TOKEN_CALLED)
  );

  assert.ok(nt, "TOKEN_CALLED email notification persisted");
  assert.ok(
    nt.title.startsWith("Your Turn is Now - "),
    `title should carry the token number, got "${nt.title}"`
  );
  assert.ok(/turn/i.test(nt.message), "body signals it is the customer's turn");
});

// ─── Auto-next TOKEN_CALLED email ──────────────────────

test("completing a token auto-calls the next token and emails it", async () => {
  process.env.NOTIFICATION_PROVIDER = NOTIFICATION_PROVIDER.MOCK;
  delete process.env.EMAIL_HOST;

  const a = await createToken("first@example.com");
  const aData = (await a.json()).data;
  const b = await createToken("second@example.com");
  const bData = (await b.json()).data;

  await post(
    `/tokens/${aData.token.id}/call`,
    {},
    staffToken
  );
  await post(
    `/tokens/${aData.token.id}/start`,
    {},
    staffToken
  );

  const done = await post(
    `/tokens/${aData.token.id}/complete`,
    {},
    staffToken
  );
  assert.equal(done.status, 200);
  const doneBody = await done.json();
  assert.equal(doneBody.data.nextToken.tokenNumber, bData.token.tokenNumber);
  assert.equal(doneBody.data.nextToken.status, "CALLED");

  // The auto-called next customer gets its own TOKEN_CALLED email.
  const nt = await waitFor(() =>
    findEmailNotification(bData.token.id, NOTIFICATION_TYPE.TOKEN_CALLED)
  );

  assert.ok(nt, "auto-called next token received TOKEN_CALLED email");
  assert.equal(nt.tokenNumber, bData.token.tokenNumber);
  assert.equal(nt.customer.toString(), bData.customer.id);

  // The completed token must not receive a duplicate TOKEN_CALLED email.
  const calledCount = await Notification.countDocuments({
    token: bData.token.id,
    type: NOTIFICATION_TYPE.TOKEN_CALLED,
    channel: NOTIFICATION_CHANNEL.EMAIL,
  });
  assert.equal(calledCount, 1, "only a single TOKEN_CALLED email");
});

// ─── Email failure safety ──────────────────────────────

test("SMTP failure never blocks token generation or queue transitions", async () => {
  process.env.NOTIFICATION_PROVIDER = NOTIFICATION_PROVIDER.EMAIL;
  delete process.env.EMAIL_HOST;
  delete process.env.EMAIL_USER;
  delete process.env.EMAIL_PASS;
  delete process.env.EMAIL_FROM;

  const res = await createToken("fail@example.com");
  assert.equal(res.status, 201, "token must still be created");
  const { data } = await res.json();

  const created = await waitFor(() =>
    findFailedEmailNotification(data.token.id, NOTIFICATION_TYPE.TOKEN_CREATED)
  );
  assert.equal(
    created.status,
    NOTIFICATION_STATUS.FAILED,
    "unconfigured email is recorded as FAILED"
  );
  assert.equal(created.provider, NOTIFICATION_PROVIDER.EMAIL);
  assert.ok(created.error, "failure error message is stored");

  const call = await post(
    `/tokens/${data.token.id}/call`,
    {},
    staffToken
  );
  assert.equal(call.status, 200, "queue transition must still succeed");

  const called = await waitFor(() =>
    findFailedEmailNotification(data.token.id, NOTIFICATION_TYPE.TOKEN_CALLED)
  );
  assert.equal(called.status, NOTIFICATION_STATUS.FAILED);
});

// ─── Duplicate prevention ──────────────────────────────

test("a duplicated token request does not send a second TOKEN_CREATED email", async () => {
  process.env.NOTIFICATION_PROVIDER = NOTIFICATION_PROVIDER.MOCK;
  delete process.env.EMAIL_HOST;

  const key = `idem-mail-${Date.now()}`;
  const payload = {
    serviceId: service._id,
    customer: {
      name: "Idempotency Email Customer",
      phone: `0499${String(Math.floor(100000 + Math.random() * 899999))}`,
      email: "idem@example.com",
    },
    idempotencyKey: key,
  };

  const first = await post("/tokens", payload);
  assert.equal(first.status, 201);
  const { data } = await first.json();
  assert.equal(data.duplicate, false);

  await waitFor(() =>
    findEmailNotification(data.token.id, NOTIFICATION_TYPE.TOKEN_CREATED)
  );

  // Re-submit the exact same request (the backend dedupe path).
  const replay = await post("/tokens", payload);
  assert.equal(replay.status, 201);
  const replayBody = await replay.json();
  assert.equal(replayBody.data.duplicate, true);
  assert.equal(replayBody.data.token.id, data.token.id);

  // Give any (wrong) second delivery a chance to appear, then assert.
  await new Promise((resolve) => setTimeout(resolve, 150));

  const createdCount = await Notification.countDocuments({
    token: data.token.id,
    type: NOTIFICATION_TYPE.TOKEN_CREATED,
    channel: NOTIFICATION_CHANNEL.EMAIL,
  });
  assert.equal(createdCount, 1, "TOKEN_CREATED email is sent exactly once");
});

test("the same event does not create duplicate emails", async () => {
  process.env.NOTIFICATION_PROVIDER = NOTIFICATION_PROVIDER.MOCK;
  delete process.env.EMAIL_HOST;

  const res = await createToken("dup@example.com");
  const { data } = await res.json();

  await waitFor(() =>
    findEmailNotification(data.token.id, NOTIFICATION_TYPE.TOKEN_CREATED)
  );

  // Re-fire the same TOKEN_CREATED event through notify() directly.
  const replayed = await notify({
    type: NOTIFICATION_TYPE.TOKEN_CREATED,
    title: "Duplicate - should be ignored",
    message: "Duplicate body",
    recipientType: "CUSTOMER",
    customer: data.customer.id,
    token: data.token.id,
    tokenNumber: data.token.tokenNumber,
    channel: NOTIFICATION_CHANNEL.EMAIL,
  });

  const createdCount = await Notification.countDocuments({
    token: data.token.id,
    type: NOTIFICATION_TYPE.TOKEN_CREATED,
    channel: NOTIFICATION_CHANNEL.EMAIL,
  });
  assert.equal(createdCount, 1, "only one TOKEN_CREATED email");

  // Manual call triggers TOKEN_CALLED; a replay must not duplicate it.
  await post(
    `/tokens/${data.token.id}/call`,
    {},
    staffToken
  );

  await waitFor(() =>
    findEmailNotification(data.token.id, NOTIFICATION_TYPE.TOKEN_CALLED)
  );

  await notify({
    type: NOTIFICATION_TYPE.TOKEN_CALLED,
    title: "Duplicate - should be ignored",
    message: "Duplicate body",
    recipientType: "CUSTOMER",
    customer: data.customer.id,
    token: data.token.id,
    tokenNumber: data.token.tokenNumber,
    channel: NOTIFICATION_CHANNEL.EMAIL,
  });

  const calledCount = await Notification.countDocuments({
    token: data.token.id,
    type: NOTIFICATION_TYPE.TOKEN_CALLED,
    channel: NOTIFICATION_CHANNEL.EMAIL,
  });
  assert.equal(calledCount, 1, "only one TOKEN_CALLED email");
});