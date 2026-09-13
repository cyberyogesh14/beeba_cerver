/**
 * Migration: backfill Token.dateKey and create the token safety indexes.
 *
 * The token model now enforces:
 *   - unique { dateKey, tokenNumber }     (tokenNumber unique per day)
 *   - unique { idempotencyKey } (sparse)  (duplicate-request protection)
 *
 * Existing tokens predate the dateKey field. A unique index on
 * { dateKey, tokenNumber } cannot be built while old tokens carry no
 * dateKey (null) — and if the queue bug already produced two tokens with
 * the same number on the same day, the index build would also fail.
 *
 * This script:
 *   1. Backfills dateKey from createdAt for every token missing it.
 *   2. Detects and REPORTS (never deletes) any remaining duplicate
 *      (dateKey, tokenNumber) pairs that would block the unique index.
 *   3. Builds both token indexes explicitly (it never drops existing
 *      indexes).
 *
 * Usage from server/:
 *   node scripts/backfill-token-datekey.mjs
 */
import "dotenv/config";

import mongoose from "mongoose";

import Token from "../src/models/Token.js";

const getDateKey = (date = new Date()) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const BACKFILL_BATCH = 500;

const main = async () => {
  if (!process.env.MONGODB_URI) {
    console.error("MONGODB_URI is required");
    process.exit(1);
  }

  console.log(`Connecting to ${process.env.MONGODB_URI}`);
  await mongoose.connect(process.env.MONGODB_URI);

  const collection = Token.collection;

  // ── 1. Backfill dateKey from createdAt ───────────────────────────
  const missing = await collection.countDocuments({
    dateKey: { $exists: false },
  });

  console.log(`Tokens missing dateKey: ${missing}`);

  if (missing > 0) {
    const cursor = collection.find(
      { dateKey: { $exists: false } },
      { projection: { createdAt: 1, tokenNumber: 1 } }
    );

    let updated = 0;
    let batch = [];

    const flush = async () => {
      if (batch.length === 0) return;
      await collection.bulkWrite(
        batch.map((doc) => ({
          updateOne: {
            filter: { _id: doc._id },
            update: { $set: { dateKey: doc.dateKey } },
          },
        }))
      );
      updated += batch.length;
      batch = [];
    };

    for await (const doc of cursor) {
      const createdAt = doc.createdAt ? new Date(doc.createdAt) : new Date();
      const dateKey = getDateKey(createdAt);

      batch.push({ _id: doc._id, dateKey });

      if (batch.length >= BACKFILL_BATCH) {
        await flush();
      }
    }

    await flush();
    console.log(`Backfilled dateKey on ${updated} tokens`);
  }

  // ── 2. Detect duplicates that would block the unique index ───────
  const duplicates = await collection
    .aggregate([
      {
        $group: {
          _id: { dateKey: "$dateKey", tokenNumber: "$tokenNumber" },
          count: { $sum: 1 },
          ids: { $push: "$_id" },
        },
      },
      { $match: { count: { $gt: 1 } } },
      { $sort: { "_id.dateKey": 1, "_id.tokenNumber": 1 } },
    ])
    .toArray();

  if (duplicates.length > 0) {
    console.log(
      `\n⚠ Found ${duplicates.length} duplicate (dateKey, tokenNumber) groups:`
    );

    for (const dup of duplicates) {
      console.log(`  ${dup._id.dateKey}  ${dup._id.tokenNumber}  x${dup.count}`);
      console.log(`    token ids: ${dup.ids.join(", ")}`);
    }

    console.log(
      "\nThe unique index cannot be built until the duplicates are resolved."
    );
    console.log(
      "No data was deleted. Review the token ids above and decide which one"
    );
    console.log(
      "to keep, then either update the other record(s) or remove them after"
    );
    console.log(
      "manual confirmation. Rerun this script afterwards to build the indexes."
    );
    console.log(
      "Example cleanup (mark extras CANCELLED instead of deleting):\n"
    );
    console.log(
      "  db.tokens.updateOne({ _id: <keep-this-one> }, ...);  // then, for extras:\n"
    );
    console.log(
      "  db.tokens.updateMany(\n" +
        "    { _id: { $in: [<ids-to-cancel>] } },\n" +
        "    { $set: { status: 'CANCELLED' } }\n" +
        "  );\n"
    );
  }

  // ── 3. Build the indexes (never drops existing indexes) ──────────
  const indexes = [
    {
      spec: { dateKey: 1, tokenNumber: 1 },
      options: { unique: true, name: "token_dateKey_tokenNumber_unique" },
      label: "unique { dateKey, tokenNumber }",
    },
    {
      spec: { idempotencyKey: 1 },
      options: {
        unique: true,
        sparse: true,
        name: "token_idempotencyKey_unique",
      },
      label: "unique { idempotencyKey } (sparse)",
    },
  ];

  for (const index of indexes) {
    try {
      await collection.createIndex(index.spec, index.options);
      console.log(`✔ Index created: ${index.label}`);
    } catch (error) {
      if (error?.code === 11000) {
        console.error(
          `✖ Could not create ${index.label}: duplicate keys exist`
        );
        console.error(
          "  Resolve the duplicates reported above, then rerun."
        );
      } else {
        throw error;
      }
    }
  }

  await mongoose.disconnect();
  console.log("\nDone.");
};

main().catch((error) => {
  console.error("Migration failed:", error);
  process.exit(1);
});