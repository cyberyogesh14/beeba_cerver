/**
 * Local test runner.
 *
 * Provisions a fresh disposable in-memory MongoDB replica set for EVERY test
 * file, seeds the base fixtures, builds the schema indexes up front, then runs
 * that file against it. Never touches a configured/production database.
 *
 * The per-file server is intentional: mongod 8.2.6 tends to stall during
 * concurrent unique-index upserts once a single member has been driven by many
 * sequential driver pools, so an isolated set per file keeps the run reliable.
 *
 * Usage: node tests/run-tests.mjs [substring-filter]
 */
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import mongoose from "mongoose";

import { seedFixtures } from "./helpers/seed.js";

import User from "../src/models/User.js";
import Service from "../src/models/Service.js";
import Token from "../src/models/Token.js";
import TokenSequence from "../src/models/TokenSequence.js";
import Customer from "../src/models/Customer.js";
import QueueHistory from "../src/models/QueueHistory.js";
import Notification from "../src/models/Notification.js";

const MODELS = [
  User,
  Service,
  Token,
  TokenSequence,
  Customer,
  QueueHistory,
  Notification,
];

const filter = process.argv[2];

const FILES = [
  "tests/queue.workflow.test.js",
  "tests/token.generation.test.js",
  "tests/notification.test.js",
  "tests/analytics.test.js",
  "tests/email.notification.test.js",
  "tests/api.test.js",
].filter((f) => !filter || f.includes(filter));

const runFile = async (file) => {
  const filePath = resolve(file);

  const mongo = await MongoMemoryReplSet.create({
    replSet: { count: 1 }, // queue operations use transactions
  });

  const uri = mongo.getUri("beeba");

  await mongoose.connect(uri);
  await seedFixtures();

  // Build every schema index up front from the parent process. The disposable
  // replica set stalls on index builds issued from child processes
  // (mongod 8.2.6), so test children run with autoIndex disabled instead.
  for (const model of MODELS) {
    await model.syncIndexes();
  }

  await mongoose.disconnect();

  const result = spawnSync(
    process.execPath,
    [
      "--test",
      "--import",
      "./tests/setup.noindex.mjs",
      filePath,
    ],
    {
      stdio: "inherit",
      cwd: process.cwd(),
      env: { ...process.env, MONGODB_URI: uri },
    }
  );

  await mongo.stop();

  return result.status === 0;
};

let failures = 0;

for (const file of FILES) {
  const ok = await runFile(file);
  if (!ok) failures += 1;
}

process.exitCode = failures === 0 ? 0 : 1;