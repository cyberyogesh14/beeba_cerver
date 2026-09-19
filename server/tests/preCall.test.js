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
import Notification from "../src/models/Notification.js";
import QueueHistory from "../src/models/QueueHistory.js";

import { generateToken } from "../src/services/token.service.js";
import { callToken } from "../src/services/queue.service.js";
import {
  PRE_CALL_LEAD_MS,
  computePreCallAt,
  preCallToken,
  runPreCallSweep,
  startPreCallScheduler,
  stopPreCallScheduler,
} from "../src/services/preCall.service.js";

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

const createCustomer = ({ email = null } = {}) => {
  const suffix = Date.now() % 100000;
  return {
    name: "PC Customer",
    phone: `0499${String(100000 + suffix)}`,
    email,
  };
};

const findPreCallNotification = (tokenId) =>
  Notification.findOne({
    token: tokenId,
    type: NOTIFICATION_TYPE.TOKEN_PRECALL,
    channel: NOTIFICATION_CHANNEL.EMAIL,
  });

const countPreCallNotifications = (tokenId) =>
  Notification.countDocuments({
    token: tokenId,
    type: NOTIFICATION_TYPE.TOKEN_PRECALL,
    channel: NOTIFICATION_CHANNEL.EMAIL,
  });

const backdatePreCall = (tokenId) =>
  Token.updateOne(
    { _id: tokenId },
    { $set: { preCallAt: new Date(Date.now() - 60_000) } }
  );

test.before(async () => {
  process.env.NOTIFICATION_PROVIDER = NOTIFICATION_PROVIDER.MOCK;
  delete process.env.EMAIL_HOST;

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
  stopPreCallScheduler();
  await new Promise((resolve) => server.close(resolve));
  await mongoose.disconnect();
});

test.beforeEach(async () => {
  stopPreCallScheduler();

  await Token.deleteMany({});
  await TokenSequence.deleteMany({});
  await Customer.deleteMany({});
  await Notification.deleteMany({});
  await QueueHistory.deleteMany({});
});

// ─── Scheduling math ───────────────────────────────────

test("computePreCallAt returns null when estimate does not exceed the lead", () => {
  const now = new Date("2026-01-01T10:00:00.000Z");

  assert.equal(
    computePreCallAt({ now, estimatedWaitTimeMinutes: 5 }),
    null
  );
  assert.equal(
    computePreCallAt({ now, estimatedWaitTimeMinutes: 10 }),
    null,
    "an exact 10-minute wait is not pre-callable"
  );

  const at = computePreCallAt({
    now,
    estimatedWaitTimeMinutes: 30,
  });
  assert.equal(
    at.getTime(),
    now.getTime() + 20 * 60 * 1000,
    "pre-call fires 10 minutes before the expected turn"
  );
});

test("token creation schedules preCallAt only for waits longer than the lead", async () => {
  // First token: no-one ahead, no pre-call.
  const first = await generateToken({
    serviceId: service._id,
    customer: createCustomer(),
  });
  assert.equal(first.position, 1);
  assert.equal(first.token.preCallAt, null);

  // CUT estimates 15 min/service. Second token waits 15 min (5 min
  // before lead → scheduled), third waits 30 min (20 min → scheduled).
  const second = await generateToken({
    serviceId: service._id,
    customer: createCustomer(),
  });
  const third = await generateToken({
    serviceId: service._id,
    customer: createCustomer(),
  });

  assert.equal(second.position, 2);
  assert.equal(third.position, 3);
  assert.equal(third.estimatedWaitTime, 2 * service.estimatedTime);

  assert.ok(second.token.preCallAt, "second token gets a pre-call slot");
  assert.ok(third.token.preCallAt, "third token gets a pre-call slot");
  assert.equal(second.token.preCallSentAt, null);
  assert.equal(third.token.preCallSentAt, null);

  // preCallAt = createdAt + expected wait - 10 minute lead. Allow a
  // small tolerance: createdAt is stamped by Mongoose a moment before
  // computePreCallAt() reads the clock.
  const expectedMs =
    third.token.createdAt.getTime() +
    2 * service.estimatedTime * 60 * 1000 -
    PRE_CALL_LEAD_MS;
  assert.ok(
    Math.abs(third.token.preCallAt.getTime() - expectedMs) < 5000,
    "third token pre-calls ~10 minutes before its expected turn"
  );
});

// ─── Sweep ─────────────────────────────────────────────

test("pre-call sweep sends exactly one email per due, awaiting token", async () => {
  const { token } = await generateToken({
    serviceId: service._id,
    customer: createCustomer({ email: "sweep@example.com" }),
  });
  await backdatePreCall(token._id);

  const sent = await runPreCallSweep();

  assert.equal(sent, 1);

  const doc = await Token.findById(token._id);
  assert.ok(doc.preCallSentAt, "token is marked as pre-called");

  const nt = await findPreCallNotification(token._id);
  assert.ok(nt, "TOKEN_PRECALL email persisted");
  assert.equal(nt.status, NOTIFICATION_STATUS.SENT);
  assert.equal(nt.tokenNumber, token.tokenNumber);

  // Second sweep must not re-send.
  const again = await runPreCallSweep();
  assert.equal(again, 0);
  assert.equal(await countPreCallNotifications(token._id), 1);
});

test("sweep skips already-sent and non-waiting tokens", async () => {
  const a = await generateToken({
    serviceId: service._id,
    customer: createCustomer({ email: "a@example.com" }),
  });
  const b = await generateToken({
    serviceId: service._id,
    customer: createCustomer({ email: "b@example.com" }),
  });

  // a: pre-call already sent (preCallSentAt set) but due.
  await Token.updateOne(
    { _id: a.token._id },
    {
      $set: {
        preCallAt: new Date(Date.now() - 60_000),
        preCallSentAt: new Date(),
      },
    }
  );

  // b: due but already CALLED (out of the waiting queue).
  await callToken(b.token._id, { userId: staff._id });
  await backdatePreCall(b.token._id);

  const sent = await runPreCallSweep();
  assert.equal(sent, 0);
  assert.equal(await countPreCallNotifications(a.token._id), 0);
  assert.equal(await countPreCallNotifications(b.token._id), 0);
});

// ─── Manual endpoint (service-level) ───────────────────

test("manual pre-call sends one email and is idempotent", async () => {
  const { token } = await generateToken({
    serviceId: service._id,
    customer: createCustomer({ email: "manual@example.com" }),
  });

  const first = await preCallToken(token._id);
  assert.equal(first.preCall.sent, true);
  assert.equal(first.preCall.status, NOTIFICATION_STATUS.SENT);
  assert.ok(first.preCall.preCallSentAt);
  assert.equal(await countPreCallNotifications(token._id), 1);

  // Repeat → idempotent no-op, no second email.
  const again = await preCallToken(token._id);
  assert.equal(again.preCall.status, "ALREADY_SENT");
  assert.equal(again.preCall.sent, false);
  assert.equal(await countPreCallNotifications(token._id), 1);
});

test("manual pre-call rejects tokens no longer waiting and unknown ids", async () => {
  const { token } = await generateToken({
    serviceId: service._id,
    customer: createCustomer({ email: "state@example.com" }),
  });
  await callToken(token._id, { userId: staff._id });

  await assert.rejects(
    preCallToken(token._id),
    /no longer waiting/
  );

  await assert.rejects(
    preCallToken(new mongoose.Types.ObjectId().toString()),
    /not found/
  );
});

test("manual pre-call skips cleanly when the customer has no email", async () => {
  const { token } = await generateToken({
    serviceId: service._id,
    customer: createCustomer(),
  });

  const result = await preCallToken(token._id);

  assert.equal(result.preCall.status, "SKIPPED");
  assert.equal(result.preCall.sent, false);
  assert.equal(await countPreCallNotifications(token._id), 0);

  const doc = await Token.findById(token._id);
  assert.ok(doc.preCallSentAt, "still claimed so it is never retried");
});

// ─── HTTP route ────────────────────────────────────────

test("POST /tokens/:id/pre-call requires staff auth and sends the email", async () => {
  const tokenRes = await fetch(`${baseUrl}/tokens`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      serviceId: service._id,
      customer: createCustomer({ email: "route@example.com" }),
    }),
  });
  assert.equal(tokenRes.status, 201);
  const { data } = await tokenRes.json();

  const unauthed = await fetch(
    `${baseUrl}/tokens/${data.token.id}/pre-call`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    }
  );
  assert.equal(unauthed.status, 401, "pre-call requires authentication");

  const res = await fetch(
    `${baseUrl}/tokens/${data.token.id}/pre-call`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${staffToken}`,
      },
      body: "{}",
    }
  );
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.data.preCall.sent, true);
  assert.equal(body.data.token.status, "WAITING");

  const nt = await findPreCallNotification(data.token.id);
  assert.ok(nt, "TOKEN_PRECALL email persisted via the route");
});

// ─── Scheduler boot loop ───────────────────────────────

test("pre-call scheduler starts, is idempotent and stops cleanly", async () => {
  const first = startPreCallScheduler(500);
  assert.ok(first, "scheduler returns a handle");

  const second = startPreCallScheduler(500);
  assert.equal(second, first, "starting twice reuses the same timer");

  const third = await generateToken({
    serviceId: service._id,
    customer: createCustomer({ email: "sched@example.com" }),
  });
  await backdatePreCall(third.token._id);

  // Manual sweep keeps the test deterministic; the boot timer only
  // needs to exist and be stop-able.
  const sent = await runPreCallSweep();
  assert.equal(sent, 1);

  stopPreCallScheduler();

  // After stopping, a fresh start works again.
  const restarted = startPreCallScheduler(500);
  assert.ok(restarted);
  stopPreCallScheduler();
});