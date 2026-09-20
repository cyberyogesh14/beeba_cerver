import "dotenv/config";

import test from "node:test";
import assert from "node:assert/strict";

import mongoose from "mongoose";

import Service from "../src/models/Service.js";
import User from "../src/models/User.js";
import Token from "../src/models/Token.js";
import TokenSequence from "../src/models/TokenSequence.js";
import Customer from "../src/models/Customer.js";
import QueueHistory from "../src/models/QueueHistory.js";

import { generateToken } from "../src/services/token.service.js";
import {
  callToken,
  recallToken,
  startToken,
  skipToken,
  completeToken,
  getQueue,
  getPublicQueueState,
} from "../src/services/queue.service.js";

let admin;
let staff;
let service; // Haircut (CUT, prefix H)
let otherService; // Beard (BEARD, prefix B)

const createCustomer = (i) => ({
  name: `TC Customer ${i}`,
  phone: `0499${String(10000 + i)}`,
});

test.before(async () => {
  await mongoose.connect(process.env.MONGODB_URI);

  await Token.deleteMany({});
  await TokenSequence.deleteMany({});
  await Customer.deleteMany({});
  await QueueHistory.deleteMany({});
});

test.after(async () => {
  await mongoose.disconnect();
});

test("seed data is present and valid", () => {
  assert.ok(staff, "staff user must exist");
  assert.ok(admin, "admin user must exist");
  assert.ok(service, "a service must exist");
  assert.ok(otherService, "a second service must exist");
});

test.beforeEach(async () => {
  await Token.deleteMany({});
  await TokenSequence.deleteMany({});
  await Customer.deleteMany({});
  await QueueHistory.deleteMany({});

  admin = await User.findOne({ role: "admin" });
  staff = await User.findOne({ role: "staff" });
  service = await Service.findOne({ code: "CUT" });
  otherService = await Service.findOne({ code: "BEARD" });

  assert.ok(
    service && otherService && staff && admin,
    "seed fixtures must be available"
  );
});

test("generates sequentially numbered tokens with daily prefix", async () => {
  const a = await generateToken({
    serviceId: service._id,
    customer: createCustomer(1),
  });
  const b = await generateToken({
    serviceId: service._id,
    customer: createCustomer(2),
  });
  const c = await generateToken({
    serviceId: service._id,
    customer: createCustomer(3),
  });

  assert.equal(a.token.tokenNumber, "H-001");
  assert.equal(b.token.tokenNumber, "H-002");
  assert.equal(c.token.tokenNumber, "H-003");
  assert.equal(a.token.status, "WAITING");
});

test("prevents duplicate token numbers (uses unique sequence per service/date)", async () => {
  await generateToken({
    serviceId: service._id,
    customer: createCustomer(1),
  });
  await generateToken({
    serviceId: otherService._id,
    customer: createCustomer(2),
  });

  const h = await Token.find({ service: service._id }).select("tokenNumber").lean();
  const b = await Token.find({ service: otherService._id }).select("tokenNumber").lean();

  assert.equal(h[0].tokenNumber, "H-001");
  assert.equal(b[0].tokenNumber, "B-001");
  assert.notEqual(h[0].tokenNumber, b[0].tokenNumber);
});

test("concurrent token generation never produces duplicate numbers", async () => {
  const jobs = Array.from({ length: 20 }, (_, i) =>
    generateToken({
      serviceId: service._id,
      customer: createCustomer(i + 1),
    })
  );

  const results = await Promise.all(jobs);

  const numbers = results.map((r) => r.token.tokenNumber);
  const unique = new Set(numbers);

  assert.equal(numbers.length, 20);
  assert.equal(unique.size, 20, "all token numbers must be unique");

  // 20 sequential numbers 001..020, some permutation.
  const sequences = numbers
    .map((n) => Number(n.split("-")[1]))
    .sort((a, b) => a - b);
  assert.deepEqual(
    sequences,
    Array.from({ length: 20 }, (_, i) => i + 1),
    "exactly one token for each sequence 1..20"
  );
});

test("computes queue position and estimated wait time", async () => {
  await generateToken({ serviceId: service._id, customer: createCustomer(1) });
  await generateToken({ serviceId: service._id, customer: createCustomer(2) });
  const third = await generateToken({
    serviceId: service._id,
    customer: createCustomer(3),
  });

  assert.equal(third.position, 3, "third customer is 3rd in line");
  assert.equal(
    third.estimatedWaitTime,
    2 * service.estimatedTime,
    "wait time is based on customers ahead"
  );
});

test("calls a waiting token without any counter dependency", async () => {
  const { token } = await generateToken({
    serviceId: service._id,
    customer: createCustomer(1),
  });

  const called = await callToken(token._id, {
    userId: staff._id,
  });

  assert.equal(called.status, "CALLED");
  assert.ok(called.calledAt);
  assert.ok(!called.counter, "token has no counter reference");
  assert.equal(called.history[0].action, "CALLED");
});

test("calling a token already out of the queue is rejected with 409", async () => {
  const a = await generateToken({ serviceId: service._id, customer: createCustomer(1) });
  const b = await generateToken({ serviceId: service._id, customer: createCustomer(2) });

  await callToken(a.token._id, { userId: staff._id });
  await callToken(b.token._id, { userId: staff._id });

  // Both tokens are CALLED now; neither is WAITING any more.
  await assert.rejects(
    callToken(a.token._id, { userId: staff._id }),
    /no longer in the waiting queue/
  );
});

test("cannot call a token that is no longer waiting", async () => {
  const { token } = await generateToken({
    serviceId: service._id,
    customer: createCustomer(1),
  });

  await callToken(token._id, { userId: staff._id });

  await assert.rejects(
    callToken(token._id, { userId: staff._id }),
    /no longer in the waiting queue/
  );
});

test("starts serving a called token", async () => {
  const { token } = await generateToken({
    serviceId: service._id,
    customer: createCustomer(1),
  });

  await callToken(token._id, { userId: staff._id });
  const started = await startToken(token._id, {
    userId: staff._id,
  });

  assert.equal(started.status, "SERVING");
  assert.ok(started.startedAt);
});

test("cannot start a token that is not in CALLED state", async () => {
  const { token } = await generateToken({
    serviceId: service._id,
    customer: createCustomer(1),
  });

  await assert.rejects(
    startToken(token._id, { userId: staff._id }),
    /not in a called state/
  );
});

test("completes a token and auto-calls the next waiting token", async () => {
  const a = await generateToken({ serviceId: service._id, customer: createCustomer(1) });
  const b = await generateToken({ serviceId: service._id, customer: createCustomer(2) });
  const c = await generateToken({ serviceId: service._id, customer: createCustomer(3) });

  await callToken(a.token._id, { userId: staff._id });
  await startToken(a.token._id, { userId: staff._id });

  const res = await completeToken(a.token._id, {
    userId: staff._id,
  });

  assert.equal(res.completedToken.status, "COMPLETED");
  assert.ok(res.completedToken.completedAt);
  assert.equal(res.nextToken.tokenNumber, "H-002");
  assert.equal(res.nextToken.status, "CALLED");
  assert.ok(res.nextToken.calledAt);
  assert.deepEqual(
    res.nextWaiting.map((t) => t.tokenNumber),
    ["H-003"]
  );

  const completedDoc = await Token.findById(a.token._id);
  assert.equal(completedDoc.status, "COMPLETED");

  const nextDoc = await Token.findById(res.nextToken.id);
  assert.equal(nextDoc.status, "CALLED");
  assert.ok(nextDoc.calledAt);
});

test("cannot complete a token that is not serving", async () => {
  const { token } = await generateToken({
    serviceId: service._id,
    customer: createCustomer(1),
  });

  await assert.rejects(
    completeToken(token._id, { userId: staff._id }),
    /not in a serving state/
  );
});

test("skips then recalls a token back to CALLED", async () => {
  const { token } = await generateToken({
    serviceId: service._id,
    customer: createCustomer(1),
  });

  await callToken(token._id, { userId: staff._id });

  const skipped = await skipToken(token._id, {
    userId: staff._id,
  });
  assert.equal(skipped.status, "SKIPPED");
  assert.ok(skipped.skippedAt);

  const recalled = await recallToken(token._id, {
    userId: staff._id,
  });
  assert.equal(recalled.status, "CALLED");
  assert.equal(recalled.skippedAt, null);
});

test("cannot recall a token that is not skipped", async () => {
  const { token } = await generateToken({
    serviceId: service._id,
    customer: createCustomer(1),
  });

  await assert.rejects(
    recallToken(token._id, { userId: staff._id }),
    /not in a skipped state/
  );
});

test("skips a waiting token and can recall it back to CALLED", async () => {
  const { token } = await generateToken({
    serviceId: service._id,
    customer: createCustomer(1),
  });

  const skipped = await skipToken(token._id, {
    userId: staff._id,
  });
  assert.equal(skipped.status, "SKIPPED");
  assert.ok(skipped.skippedAt);

  const recalled = await recallToken(token._id, {
    userId: staff._id,
  });
  assert.equal(recalled.status, "CALLED");
  assert.equal(recalled.skippedAt, null);
});

test("cannot skip a token that is already completed", async () => {
  const { token } = await generateToken({
    serviceId: service._id,
    customer: createCustomer(1),
  });

  await callToken(token._id, { userId: staff._id });
  await startToken(token._id, { userId: staff._id });
  await completeToken(token._id, { userId: staff._id });

  await assert.rejects(
    skipToken(token._id, { userId: staff._id }),
    /not in a waiting, called or serving state/
  );
});

test("queue is ordered by sequence number (FIFO)", async () => {
  await generateToken({ serviceId: service._id, customer: createCustomer(1) });
  await generateToken({ serviceId: service._id, customer: createCustomer(2) });
  await generateToken({ serviceId: service._id, customer: createCustomer(3) });

  const queue = await getQueue({ serviceId: service._id });

  assert.deepEqual(
    queue.map((t) => t.tokenNumber),
    ["H-001", "H-002", "H-003"]
  );
});

test("every status change is recorded in the audit log", async () => {
  const { token } = await generateToken({
    serviceId: service._id,
    customer: createCustomer(1),
  });

  await callToken(token._id, { userId: staff._id });
  await startToken(token._id, { userId: staff._id });
  await completeToken(token._id, { userId: staff._id });

  const history = await QueueHistory.find({ token: token._id })
    .sort({ createdAt: 1 })
    .lean();

  assert.deepEqual(
    history.map((h) => h.action),
    ["CALLED", "STARTED", "COMPLETED"]
  );
});

test("public queue state lists called/serving and waiting tokens", async () => {
  const a = await generateToken({ serviceId: service._id, customer: createCustomer(1) });
  const b = await generateToken({ serviceId: service._id, customer: createCustomer(2) });

  await callToken(a.token._id, { userId: staff._id });
  await startToken(a.token._id, { userId: staff._id });

  const { serving, waiting } = await getPublicQueueState();

  assert.deepEqual(
    serving.map((t) => t.tokenNumber),
    ["H-001"]
  );
  assert.deepEqual(
    waiting.map((t) => t.tokenNumber),
    ["H-002"]
  );
});

test("priority token moves ahead of normal tokens", async () => {
  const prioService = await Service.create({
    name: "Priority Queue",
    code: "PRIO",
    prefix: "P",
    estimatedTime: 10,
    prioritySupported: true,
  });

  await generateToken({
    serviceId: prioService._id,
    customer: createCustomer(1),
  });
  const priority = await generateToken({
    serviceId: prioService._id,
    customer: createCustomer(2),
    priority: true,
  });

  const queue = await getQueue({ serviceId: prioService._id });

  assert.equal(queue[0]._id.toString(), priority.token._id.toString());

  await Service.deleteOne({ _id: prioService._id });
});

test("non-priority service rejects priority flag", async () => {
  await assert.rejects(
    generateToken({
      serviceId: service._id,
      customer: createCustomer(1),
      priority: true,
    }),
    /Priority queue is not supported/
  );
});

test("auto-called next token has correct history and queue audit trail", async () => {
  const a = await generateToken({ serviceId: service._id, customer: createCustomer(1) });
  const b = await generateToken({ serviceId: service._id, customer: createCustomer(2) });

  await callToken(a.token._id, { userId: staff._id });
  await startToken(a.token._id, { userId: staff._id });

  const res = await completeToken(a.token._id, {
    userId: staff._id,
  });

  assert.equal(res.nextToken.tokenNumber, "H-002");
  assert.equal(res.nextToken.status, "CALLED");

  const nextDoc = await Token.findById(res.nextToken.id);
  const calledHistory = nextDoc.history.find(
    (h) => h.action === "CALLED"
  );
  assert.ok(calledHistory, "CALLED history entry exists on next token");
  assert.equal(calledHistory.previousStatus, "WAITING");
  assert.equal(calledHistory.newStatus, "CALLED");
  assert.equal(calledHistory.performedBy.toString(), staff._id.toString());
  assert.equal(calledHistory.metadata.autoCalled, true);

  const queueHistory = await QueueHistory.find({ token: res.nextToken.id })
    .sort({ createdAt: 1 })
    .lean();
  assert.equal(queueHistory.length, 1);
  assert.equal(queueHistory[0].action, "CALLED");
  assert.equal(queueHistory[0].previousStatus, "WAITING");
  assert.equal(queueHistory[0].newStatus, "CALLED");
});

test("does not auto-call a waiting token from a different service", async () => {
  const styleService = await Service.findOne({ code: "STYLE" });

  const a = await generateToken({ serviceId: service._id, customer: createCustomer(1) });
  const b = await generateToken({ serviceId: styleService._id, customer: createCustomer(2) });

  await callToken(a.token._id, { userId: staff._id });
  await startToken(a.token._id, { userId: staff._id });

  const res = await completeToken(a.token._id, {
    userId: staff._id,
  });

  assert.equal(res.completedToken.status, "COMPLETED");
  assert.equal(res.nextToken, null, "next token is only auto-called for the same service");

  const bDoc = await Token.findById(b.token._id);
  assert.equal(bDoc.status, "WAITING", "STYLE token stays WAITING");
});

test("prioritised completion returns next without breaking on empty queue", async () => {
  const { token } = await generateToken({
    serviceId: service._id,
    customer: createCustomer(1),
  });

  await callToken(token._id, { userId: staff._id });
  await startToken(token._id, { userId: staff._id });

  const res = await completeToken(token._id, {
    userId: staff._id,
  });

  assert.equal(res.completedToken.status, "COMPLETED");
  assert.equal(res.nextToken, null, "no next token when queue is empty");
  assert.deepEqual(res.nextWaiting, []);
});