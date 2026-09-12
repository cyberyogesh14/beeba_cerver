/**
 * Loaded into every test child via `node --test --import`.
 *
 * Disables mongoose auto-indexing in the test processes. Indexes are
 * provisioned once up front by the runner (see run-tests.mjs) against the
 * disposable replica set, which avoids the mongod-8.2 auto-index build
 * stall seen when children create indexes on a fresh single-node member.
 */
import mongoose from "mongoose";

mongoose.set("autoIndex", false);