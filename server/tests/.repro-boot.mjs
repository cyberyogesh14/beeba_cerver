import "dotenv/config";
import http from "http";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import mongoose from "mongoose";
import app from "../src/app.js";
import { seedFixtures } from "./helpers/seed.js";
import { generateAccessToken } from "../src/utils/jwt.js";

const mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
await mongoose.connect(mongo.getUri("beeba"));
await seedFixtures();

const User = (await import("../src/models/User.js")).default;
const admin = await User.findOne({ role: "admin" });
const token = generateAccessToken(admin);

process.env.MEDIA_UPLOAD_DIR = process.env.MEDIA_UPLOAD_DIR || "";

const server = http.createServer(app);
server.listen(Number(process.env.PORT) || 5002, "127.0.0.1", () => {
  console.log(`BOOTED on 127.0.0.1:${server.address().port}`);
  console.log(`ADMIN_TOKEN=${token}`);
});

const shutdown = () => {
  server.close(async () => {
    await mongoose.disconnect();
    await mongo.stop();
    process.exit(0);
  });
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);