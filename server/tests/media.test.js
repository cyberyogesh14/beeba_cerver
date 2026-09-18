import "dotenv/config";

import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import mongoose from "mongoose";

import app from "../src/app.js";
import { connectDB } from "../src/config/db.js";
import User from "../src/models/User.js";
import Service from "../src/models/Service.js";
import Media from "../src/models/Media.js";
import LiveQueueSetting from "../src/models/LiveQueueSetting.js";
import { generateAccessToken } from "../src/utils/jwt.js";

let server;
let baseUrl;
let adminToken;
let staffToken;
let tmpDir;

const tinyPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64"
);

const get = (p, token) => {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  return fetch(`${baseUrl}${p}`, { headers });
};

const patch = (p, body, token) => {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  return fetch(`${baseUrl}${p}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify(body),
  });
};

const del = (p, token) => {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  return fetch(`${baseUrl}${p}`, { method: "DELETE", headers });
};

const upload = (p, buffer, filename, mime, body, token) => {
  const form = new FormData();
  form.append("file", new Blob([buffer], { type: mime }), filename);
  for (const [key, value] of Object.entries(body || {})) {
    form.append(key, String(value));
  }

  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  return fetch(`${baseUrl}${p}`, { method: "POST", headers, body: form });
};

test.before(async () => {
  // Disposable upload dir + local driver so tests never touch Cloudinary
  // or a real media folder, regardless of what server/.env declares.
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "beeba-media-"));
  process.env.MEDIA_UPLOAD_DIR = tmpDir;
  process.env.MEDIA_STORAGE_DRIVER = "local";

  await connectDB();

  await Media.deleteMany({});
  await LiveQueueSetting.deleteMany({});

  const adminUser = await User.findOne({ role: "admin" });
  const staffUser = await User.findOne({ role: "staff" });
  assert.ok(adminUser, "admin seed must exist");
  assert.ok(staffUser, "staff seed must exist");

  adminToken = generateAccessToken(adminUser);
  staffToken = generateAccessToken(staffUser);

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
  if (tmpDir) {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
  await mongoose.disconnect();
});

// ─── PUBLIC LIVE QUEUE STATE ──────────────────────

test("GET /api/live-queue/state returns settings and media without auth", async () => {
  const res = await get("/live-queue/state");
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.success, true);
  assert.equal(body.data.settings.queueDisplayDuration, 10);
  assert.equal(body.data.settings.mediaDisplayDuration, 10);
  assert.equal(body.data.settings.mediaEnabled, true);
  assert.equal(body.data.settings.queueEnabled, true);
  assert.ok(Array.isArray(body.data.media));
  // Never leaks internal fields.
  for (const item of body.data.media) {
    assert.equal(item.storageKey, undefined);
  }
});

test("GET /api/live-queue/settings is public and returns defaults", async () => {
  const res = await get("/live-queue/settings");
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.data.settings.queueDisplayDuration, 10);
});

test("PATCH /api/live-queue/settings updates settings for admin", async () => {
  const res = await patch(
    "/live-queue/settings",
    {
      queueDisplayDuration: 15,
      mediaDisplayDuration: 20,
      mediaEnabled: true,
      queueEnabled: true,
    },
    adminToken
  );
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.data.settings.queueDisplayDuration, 15);
  assert.equal(body.data.settings.mediaDisplayDuration, 20);

  await patch(
    "/live-queue/settings",
    {
      queueDisplayDuration: 10,
      mediaDisplayDuration: 10,
      mediaEnabled: true,
      queueEnabled: true,
    },
    adminToken
  );
});

test("PATCH /api/live-queue/settings returns 403 for staff", async () => {
  const res = await patch(
    "/live-queue/settings",
    {
      queueDisplayDuration: 15,
      mediaDisplayDuration: 20,
      mediaEnabled: true,
      queueEnabled: true,
    },
    staffToken
  );
  assert.equal(res.status, 403);
});

test("PATCH /api/live-queue/settings returns 401 without token", async () => {
  const res = await patch("/live-queue/settings", {
    queueDisplayDuration: 15,
    mediaDisplayDuration: 20,
    mediaEnabled: true,
    queueEnabled: true,
  });
  assert.equal(res.status, 401);
});

test("PATCH /api/live-queue/settings rejects durations outside 5-60", async () => {
  for (const bad of [
    { queueDisplayDuration: 4, mediaDisplayDuration: 10, mediaEnabled: true, queueEnabled: true },
    { queueDisplayDuration: 61, mediaDisplayDuration: 10, mediaEnabled: true, queueEnabled: true },
    { queueDisplayDuration: 10, mediaDisplayDuration: 4, mediaEnabled: true, queueEnabled: true },
    { queueDisplayDuration: 10, mediaDisplayDuration: 5.5, mediaEnabled: true, queueEnabled: true },
    { queueDisplayDuration: 10, mediaDisplayDuration: "abc", mediaEnabled: true, queueEnabled: true },
  ]) {
    const res = await patch("/live-queue/settings", bad, adminToken);
    assert.equal(res.status, 400, JSON.stringify(bad));
  }
});

test("PATCH /api/live-queue/settings rejects missing fields", async () => {
  const res = await patch(
    "/live-queue/settings",
    { queueDisplayDuration: 10 },
    adminToken
  );
  assert.equal(res.status, 400);
});

// ─── MEDIA SECURITY ───────────────────────────────

test("POST /api/media returns 401 without auth", async () => {
  const res = await upload("/media", tinyPng, "noauth.png", "image/png");
  assert.equal(res.status, 401);
});

test("POST /api/media returns 403 for staff", async () => {
  const res = await upload("/media", tinyPng, "staff.png", "image/png", {}, staffToken);
  assert.equal(res.status, 403);
});

test("POST /api/media rejects disallowed file types", async () => {
  const res = await upload(
    "/media",
    Buffer.from("MZ...."),
    "evil.exe",
    "application/octet-stream",
    {},
    adminToken
  );
  assert.equal(res.status, 400);
});

test("POST /api/media rejects files over the image size limit", async () => {
  const res = await upload(
    "/media",
    Buffer.alloc(11 * 1024 * 1024),
    "huge.png",
    "image/png",
    {},
    adminToken
  );
  assert.equal(res.status, 413);
});

// ─── MEDIA CRUD ───────────────────────────────────

test("POST /api/media uploads a png for admin and defaults to inactive", async () => {
  const res = await upload("/media", tinyPng, "poster.png", "image/png", {}, adminToken);
  assert.equal(res.status, 201);
  const body = await res.json();
  assert.equal(body.data.media.type, "image");
  assert.match(
    body.data.media.url,
    /^http:\/\/localhost:5002\/uploads\/media\/.+\.png$/
  );
  assert.equal(body.data.media.isActive, false);
  assert.equal(body.data.media.name, "poster.png");
  assert.equal(body.data.media.storageKey, undefined);
  // The file exists on disk.
  const rel = body.data.media.url.split("/uploads/media/")[1];
  await assert.doesNotReject(fs.access(path.join(tmpDir, "media", rel)));
});

test("POST /api/media uploads a video with client-reported duration", async () => {
  const res = await upload(
    "/media",
    Buffer.from("fake mp4 bytes"),
    "promo.mp4",
    "video/mp4",
    { duration: 32 },
    adminToken
  );
  assert.equal(res.status, 201);
  const body = await res.json();
  assert.equal(body.data.media.type, "video");
  assert.equal(body.data.media.duration, 32);
});

test("GET /api/media lists media for admin only", async () => {
  const ok = await get("/media", adminToken);
  assert.equal(ok.status, 200);
  assert.ok(Array.isArray((await ok.json()).data.media));

  const forbidden = await get("/media", staffToken);
  assert.equal(forbidden.status, 403);

  const anon = await get("/media");
  assert.equal(anon.status, 401);
});

test("POST /api/media with missing file returns 400", async () => {
  const res = await fetch(`${baseUrl}/media`, {
    method: "POST",
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  assert.equal(res.status, 400);
});

test("PATCH /api/media/:id activates media and never leaks storageKey", async () => {
  const created = await upload("/media", tinyPng, "activate.png", "image/png", {}, adminToken);
  const mediaId = (await created.json()).data.media.id;

  const res = await patch(`/media/${mediaId}`, { isActive: true }, adminToken);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.data.media.isActive, true);
  assert.equal(body.data.media.storageKey, undefined);

  await patch(`/media/${mediaId}`, { isActive: false }, adminToken);
});

test("PATCH /api/media/:id with non-existent ID returns 404", async () => {
  const res = await patch(
    "/media/000000000000000000000000",
    { isActive: true },
    adminToken
  );
  assert.equal(res.status, 404);
});

test("PATCH /api/media/:id with invalid ID returns 400", async () => {
  const res = await patch("/media/badid", { isActive: true }, adminToken);
  assert.equal(res.status, 400);
});

test("PATCH /api/media/:id with non-boolean isActive returns 400", async () => {
  const created = await upload("/media", tinyPng, "bool.png", "image/png", {}, adminToken);
  const mediaId = (await created.json()).data.media.id;

  const res = await patch(`/media/${mediaId}`, { isActive: "yes" }, adminToken);
  assert.equal(res.status, 400);
});

test("PATCH /api/media/reorder persists the new order", async () => {
  const a = (await (await upload("/media", tinyPng, "a.png", "image/png", {}, adminToken)).json()).data.media;
  const b = (await (await upload("/media", tinyPng, "b.png", "image/png", {}, adminToken)).json()).data.media;
  const c = (await (await upload("/media", tinyPng, "c.png", "image/png", {}, adminToken)).json()).data.media;

  const before = (await (await get("/media", adminToken)).json()).data.media;
  const reversed = [...before].reverse().map((m) => m.id);

  const res = await patch("/media/reorder", { orderedIds: reversed }, adminToken);
  assert.equal(res.status, 200);
  const body = await res.json();
  const order = body.data.media.map((m) => m.id);
  assert.deepEqual(order, reversed);

  // The newly created items are respected within the full list.
  assert.ok(order.includes(a.id));
  assert.ok(order.includes(b.id));
  assert.ok(order.includes(c.id));
});

test("PATCH /api/media/reorder rejects partial lists", async () => {
  const a = (await (await upload("/media", tinyPng, "pa.png", "image/png", {}, adminToken)).json()).data.media;
  const res = await patch("/media/reorder", { orderedIds: [a.id] }, adminToken);
  assert.equal(res.status, 400);
});

test("PATCH /api/media/reorder rejects duplicates", async () => {
  const a = (await (await upload("/media", tinyPng, "da.png", "image/png", {}, adminToken)).json()).data.media;
  const b = (await (await upload("/media", tinyPng, "db.png", "image/png", {}, adminToken)).json()).data.media;

  const res = await patch("/media/reorder", { orderedIds: [a.id, a.id] }, adminToken);
  assert.equal(res.status, 400);
  assert.ok((await res.json()).message.length > 0);
  // b still exists, proving a bad reorder never removed records.
  assert.ok(await Media.findById(b.id));
});

test("DELETE /api/media/:id removes the record and the stored file", async () => {
  const created = await upload("/media", tinyPng, "delete.png", "image/png", {}, adminToken);
  const body = await created.json();
  const mediaId = body.data.media.id;
  const rel = body.data.media.url.split("/uploads/media/")[1];

  const storedPath = path.join(tmpDir, "media", rel);
  await assert.doesNotReject(fs.access(storedPath));

  const res = await del(`/media/${mediaId}`, adminToken);
  assert.equal(res.status, 200);

  assert.equal(await Media.findById(mediaId), null);
  await assert.rejects(fs.access(storedPath), { code: "ENOENT" });
});

test("DELETE /api/media/:id with non-existent ID returns 404", async () => {
  const res = await del("/media/000000000000000000000000", adminToken);
  assert.equal(res.status, 404);
});

// ─── STATE REFLECTS ACTIVE MEDIA ONLY ─────────────

test("GET /api/live-queue/state includes only active media", async () => {
  const active = (await (await upload("/media", tinyPng, "state-active.png", "image/png", {}, adminToken)).json()).data.media;
  const inactive = (await (await upload("/media", tinyPng, "state-inactive.png", "image/png", {}, adminToken)).json()).data.media;

  await patch(`/media/${active.id}`, { isActive: true }, adminToken);

  const res = await get("/live-queue/state");
  const body = await res.json();
  const ids = body.data.media.map((m) => m.id);
  assert.ok(ids.includes(active.id), "active media is included");
  assert.ok(!ids.includes(inactive.id), "inactive media is excluded");

  await patch(`/media/${active.id}`, { isActive: false }, adminToken);
});