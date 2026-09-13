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

let admin;
let staff;
let cut; // Haircut (CUT, prefix H)
let beard; // Beard (BEARD, prefix B)
let style; // Hair Styling (STYLE, prefix S)

const createCustomer = (i) => ({
  name: `Gen Customer ${i}`,
  phone: `0488${String(10000 + i)}`,
});

test.before(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
});

test.after(async () => {
  await mongoose.disconnect();
});

test.beforeEach(async () => {
  await Token.deleteMany({});
  await TokenSequence.deleteMany({});
  await Customer.deleteMany({});
  await QueueHistory.deleteMany({});

  admin = await User.findOne({ role: "admin" });
  staff = await User.findOne({ role: "staff" });
  cut = await Service.findOne({ code: "CUT" });
  beard = await Service.findOne({ code: "BEARD" });
  style = await Service.findOne({ code: "STYLE" });

  assert.ok(
    admin && staff && cut && beard && style,
    "seed fixtures must be available"
  );
});

test("generated token is WAITING with no counter dependency", async () => {
  const { token } = await generateToken({
    serviceId: cut._id,
    customer: createCustomer(1),
  });

  assert.ok(token.tokenNumber, "token carries its number");
  assert.ok(token.sequenceNumber, "token carries its sequence");
  assert.equal(token.status, "WAITING");
  assert.ok(!token.counter, "token has no counter reference");
});

test("generated token for any service is always accepted", async () => {
  const { token } = await generateToken({
    serviceId: style._id,
    customer: createCustomer(1),
  });

  assert.equal(token.status, "WAITING");
  assert.equal(token.tokenNumber, "S-001");
});

test("replaying the same idempotency key returns the original token", async () => {
  const key = "idem-test-key-0001";

  const first = await generateToken({
    serviceId: cut._id,
    customer: createCustomer(1),
    idempotencyKey: key,
  });

  assert.equal(first.duplicate, false);

  const replay = await generateToken({
    serviceId: cut._id,
    customer: createCustomer(1),
    idempotencyKey: key,
  });

  assert.equal(replay.duplicate, true);
  assert.equal(
    replay.token._id.toString(),
    first.token._id.toString(),
    "duplicate resolves to the same token"
  );
  assert.equal(
    replay.position,
    first.position,
    "duplicate reports the same queue position"
  );

  const total = await Token.countDocuments({});
  assert.equal(total, 1, "no second token was created");

  const sequenceAccounts = await TokenSequence.countDocuments({});
  assert.equal(
    sequenceAccounts,
    1,
    "no extra sequence numbers were consumed"
  );
});

test("a different idempotency key still creates a legitimate new token", async () => {
  const a = await generateToken({
    serviceId: cut._id,
    customer: createCustomer(1),
    idempotencyKey: "key-a",
  });
  const b = await generateToken({
    serviceId: cut._id,
    customer: createCustomer(2),
    idempotencyKey: "key-b",
  });

  assert.notEqual(b.token._id.toString(), a.token._id.toString());
  assert.equal(b.token.tokenNumber, "H-002");
});

test("10 concurrent generations for one service produce B-001..B-010 exactly once", async () => {
  const jobs = Array.from({ length: 10 }, (_, i) =>
    generateToken({
      serviceId: beard._id,
      customer: createCustomer(i + 1),
      idempotencyKey: `beard-key-${i + 1}`,
    })
  );

  const results = await Promise.all(jobs);

  const numbers = results
    .map((r) => r.token.tokenNumber)
    .sort();

  assert.deepEqual(
    numbers,
    Array.from(
      { length: 10 },
      (_, i) => `B-${String(i + 1).padStart(3, "0")}`
    ),
    "exactly one token per sequence 001..010"
  );
  assert.equal(new Set(numbers).size, 10, "no duplicate numbers");
});

test("concurrent requests for different services keep independent sequences", async () => {
  const jobs = [
    ...Array.from({ length: 5 }, (_, i) =>
      generateToken({
        serviceId: cut._id,
        customer: createCustomer(i + 1),
      })
    ),
    ...Array.from({ length: 5 }, (_, i) =>
      generateToken({
        serviceId: beard._id,
        customer: createCustomer(100 + i),
      })
    ),
  ];

  const results = await Promise.all(jobs);

  const h = results
    .filter((r) => r.token.tokenNumber.startsWith("H-"))
    .map((r) => r.token.tokenNumber)
    .sort();
  const b = results
    .filter((r) => r.token.tokenNumber.startsWith("B-"))
    .map((r) => r.token.tokenNumber)
    .sort();

  assert.deepEqual(h, ["H-001", "H-002", "H-003", "H-004", "H-005"]);
  assert.deepEqual(b, ["B-001", "B-002", "B-003", "B-004", "B-005"]);
});

test("daily sequence reset continues working", async () => {
  // Pre-seed a future day's sequence at 7; it must not affect today.
  await TokenSequence.create({
    dateKey: "2099-01-01",
    service: cut._id,
    prefix: cut.prefix,
    sequence: 7,
  });

  const { token } = await generateToken({
    serviceId: cut._id,
    customer: createCustomer(1),
  });

  assert.equal(token.tokenNumber, "H-001");
  assert.ok(token.dateKey, "token carries the issue date");

  const now = new Date();
  const expected = `${now.getFullYear()}-${String(
    now.getMonth() + 1
  ).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

  assert.equal(token.dateKey, expected);
});

test("token safety indexes exist in MongoDB", async () => {
  const indexes = await Token.collection.indexes();

  const compound = indexes.find(
    (index) =>
      JSON.stringify(index.key) ===
      JSON.stringify({ dateKey: 1, tokenNumber: 1 })
  );
  assert.ok(compound, "unique { dateKey, tokenNumber } index exists");
  assert.equal(compound.unique, true);

  const idempotent = indexes.find(
    (index) =>
      JSON.stringify(index.key) ===
      JSON.stringify({ idempotencyKey: 1 })
  );
  assert.ok(
    idempotent,
    "unique sparse { idempotencyKey } index exists"
  );
  assert.equal(idempotent.unique, true);
  assert.equal(idempotent.sparse, true);
});

test("concurrent identical requests with the same key never duplicate", async () => {
  const key = "concurrent-same-key";

  const [first, second, third] = await Promise.all([
    generateToken({
      serviceId: cut._id,
      customer: createCustomer(1),
      idempotencyKey: key,
    }),
    generateToken({
      serviceId: cut._id,
      customer: createCustomer(1),
      idempotencyKey: key,
    }),
    generateToken({
      serviceId: cut._id,
      customer: createCustomer(1),
      idempotencyKey: key,
    }),
  ]);

  const ids = [first, second, third].map((r) =>
    r.token._id.toString()
  );

  assert.equal(
    new Set(ids).size,
    1,
    "all concurrent identical requests share one token"
  );
  assert.equal(
    await Token.countDocuments({}),
    1,
    "exactly one token persisted"
  );
});