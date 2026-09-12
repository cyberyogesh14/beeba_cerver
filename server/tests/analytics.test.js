import "dotenv/config";

import test from "node:test";
import assert from "node:assert/strict";

import mongoose from "mongoose";

import Service from "../src/models/Service.js";
import Counter from "../src/models/Counter.js";
import User from "../src/models/User.js";
import Notification from "../src/models/Notification.js";

import { generateToken } from "../src/services/token.service.js";
import {
  callToken,
  startToken,
  completeToken,
  skipToken,
} from "../src/services/queue.service.js";

import {
  getOverview,
  getServiceBreakdown,
  getHourlyTrend,
  getCounterBreakdown,
} from "../src/services/analytics.service.js";

let adminUser;
let staff;
let service;
let counter;
let tokens = [];
let completed = [];

const mkCustomer = (i) => ({
  name: `A Customer ${i}`,
  phone: `0421${String(100000 + i)}`,
});

test.before(async () => {
  await mongoose.connect(process.env.MONGODB_URI);

  adminUser = await User.findOne({ role: "admin" });
  assert.ok(adminUser, "admin seed present");
});

test.after(async () => {
  await mongoose.disconnect();
});

test.beforeEach(async () => {
  tokens = [];
  completed = [];

  const [Te, TS, Cu, QH] = await Promise.all([
    import("../src/models/Token.js").then((m) => m.default),
    import("../src/models/TokenSequence.js").then((m) => m.default),
    import("../src/models/Customer.js").then((m) => m.default),
    import("../src/models/QueueHistory.js").then((m) => m.default),
  ]);

  await Promise.all([
    Te.deleteMany({}),
    TS.deleteMany({}),
    Cu.deleteMany({}),
    QH.deleteMany({}),
    Notification.deleteMany({}),
  ]);

  staff = await User.findOne({ role: "staff" });
  service = await Service.findOne({ code: "CUT" });
  counter = await Counter.findOne({ assignedStaff: staff._id });

  assert.ok(staff && service && counter, "seed fixtures present");
});

test("overview reports zeros on an empty queue", async () => {
  const overview = await getOverview();

  assert.equal(overview.waiting, 0);
  assert.equal(overview.serving, 0);
  assert.equal(overview.completed, 0);
  assert.equal(overview.total, 0);
  assert.equal(overview.avgWaitMinutes, 0);
});

test("overview and breakdown reflect a completed token", async () => {
  const { token } = await generateToken({
    serviceId: service._id,
    customer: mkCustomer(1),
  });

  await callToken(token._id, {
    userId: staff._id,
    counterId: counter._id,
  });
  await startToken(token._id, {
    userId: staff._id,
    counterId: counter._id,
  });
  await completeToken(token._id, {
    userId: staff._id,
    counterId: counter._id,
  });

  completed.push(token._id);

  const overview = await getOverview();
  assert.equal(overview.completed, 1);
  assert.equal(overview.serving, 0);
  assert.equal(overview.waiting, 0);

  const services = await getServiceBreakdown();
  const row = services.find((s) => s.serviceCode === "CUT");
  assert.ok(row, "CUT present in breakdown");
  assert.equal(row.completed, 1);
  assert.equal(row.waiting, 0);
});

test("waiting tokens count toward the overview and breakdown", async () => {
  for (let i = 0; i < 3; i++) {
    const { token } = await generateToken({
      serviceId: service._id,
      customer: mkCustomer(2 + i),
    });
    tokens.push(token._id);
  }

  const overview = await getOverview();
  assert.equal(overview.waiting, 3);

  const services = await getServiceBreakdown();
  const row = services.find((s) => s.serviceCode === "CUT");
  assert.equal(row.waiting, 3);
  assert.equal(row.total, 3);
});

test("hourly trend returns 24 buckets summing created tokens", async () => {
  for (let i = 0; i < 2; i++) {
    const { token } = await generateToken({
      serviceId: service._id,
      customer: mkCustomer(10 + i),
    });
    tokens.push(token._id);
  }

  const hours = await getHourlyTrend();
  assert.equal(hours.length, 24);

  const total = hours.reduce((sum, b) => sum + b.total, 0);
  assert.equal(total, 2);
});

test("counter breakdown counts completed tokens per counter", async () => {
  const { token } = await generateToken({
    serviceId: service._id,
    customer: mkCustomer(20),
  });

  await callToken(token._id, {
    userId: staff._id,
    counterId: counter._id,
  });
  await startToken(token._id, {
    userId: staff._id,
    counterId: counter._id,
  });
  await completeToken(token._id, {
    userId: staff._id,
    counterId: counter._id,
  });

  completed.push(token._id);

  const counters = await getCounterBreakdown();
  const row = counters.find((c) => c.counterNumber === counter.number);
  assert.ok(row, "counter present in breakdown");
  assert.equal(row.completed, 1);
});
