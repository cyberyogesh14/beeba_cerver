import "dotenv/config";

import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { promises as fs, createReadStream } from "node:fs";
import { Writable } from "node:stream";
import mongoose from "mongoose";
import cloudinaryLib from "cloudinary";

/**
 * Upload architecture tests.
 *
 * Covers the disk-streamed path end to end:
 *   multipart request -> uploads/tmp -> readable stream -> provider
 *   -> temp file deleted -> metadata saved
 *
 * The media MB limits are shrunk BEFORE the app is imported (dynamic import
 * below) so the real middleware + service limit logic runs against small,
 * fast payloads: 1 MB images, 3 MB videos, 3 MB multipart ceiling.
 */
let app;
let appModule;
let constants;
let uploadTemp;
let createMedia;
let server;
let baseUrl;
let adminToken;
let tmpDir;

const tinyPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64"
);

const upload = (buffer, filename, mime, body = {}) => {
  const form = new FormData();
  form.append("file", new Blob([buffer], { type: mime }), filename);
  for (const [key, value] of Object.entries(body)) {
    form.append(key, String(value));
  }
  return fetch(`${baseUrl}/media`, {
    method: "POST",
    headers: { Authorization: `Bearer ${adminToken}` },
    body: form,
  });
};

const tmpFiles = async () => {
  const dir = uploadTemp.getUploadTmpDir();
  try {
    return await fs.readdir(dir);
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
};

const mediaFiles = async () => {
  try {
    return await fs.readdir(path.join(tmpDir, "media"));
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
};

/** Installs a stub Cloudinary uploader so no network/credentials are used. */
const withFakeCloudinary = async ({ onUpload, onDestroy }, fn) => {
  const uploader = cloudinaryLib.v2.uploader;
  const realUploadStream = uploader.upload_stream;
  const realDestroy = uploader.destroy;
  const realEnv = {
    driver: process.env.MEDIA_STORAGE_DRIVER,
    cloud: process.env.CLOUDINARY_CLOUD_NAME,
    key: process.env.CLOUDINARY_API_KEY,
    secret: process.env.CLOUDINARY_API_SECRET,
  };

  uploader.upload_stream = onUpload;
  uploader.destroy = onDestroy ?? realDestroy;
  // Force stub credentials so the real .env ones are never used, and the
  // generated CDN/thumbnail URLs are deterministic.
  process.env.MEDIA_STORAGE_DRIVER = "cloudinary";
  process.env.CLOUDINARY_CLOUD_NAME = "test-cloud";
  process.env.CLOUDINARY_API_KEY = "test-key";
  process.env.CLOUDINARY_API_SECRET = "test-secret";

  try {
    return await fn();
  } finally {
    uploader.upload_stream = realUploadStream;
    uploader.destroy = realDestroy;
    for (const [key, name] of [
      ["driver", "MEDIA_STORAGE_DRIVER"],
      ["cloud", "CLOUDINARY_CLOUD_NAME"],
      ["key", "CLOUDINARY_API_KEY"],
      ["secret", "CLOUDINARY_API_SECRET"],
    ]) {
      if (realEnv[key] === undefined) delete process.env[name];
      else process.env[name] = realEnv[key];
    }
  }
};

/** Mimics the real Cloudinary upload stream: a Writable + async callback. */
const cloudinaryUploadStub =
  ({ fail = false, duration } = {}) =>
  (params, callback) => {
    const state = { bytes: 0, params };
    const writable = new Writable({
      write(chunk, _enc, cb) {
        state.bytes += chunk.length;
        cb();
      },
      final(cb) {
        setImmediate(() => {
          if (fail) {
            callback(new Error("Cloudinary rejected the upload"));
            return;
          }
          const resourceType = params.resource_type;
          const ext = resourceType === "video" ? "mp4" : "png";
          callback(null, {
            public_id: params.public_id,
            secure_url: `https://res.cloudinary.com/test-cloud/${resourceType}/upload/v1700000000/${params.public_id}.${ext}`,
            resource_type: resourceType,
            bytes: state.bytes,
            ...(duration ? { duration } : {}),
          });
        });
        cb();
      },
    });
    writable.state = state;
    return writable;
  };

test.before(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "beeba-upload-"));

  // Must be set before the app graph is imported: the limits are read from
  // the environment at module-evaluation time.
  process.env.MEDIA_UPLOAD_DIR = tmpDir;
  process.env.MEDIA_STORAGE_DRIVER = "local";
  process.env.MEDIA_MAX_IMAGE_MB = "1";
  process.env.MEDIA_MAX_VIDEO_MB = "3";

  constants = await import("../src/constants/media.js");
  uploadTemp = await import("../src/utils/uploadTemp.js");
  ({ createMedia } = await import("../src/services/media.service.js"));
  appModule = await import("../src/app.js");
  app = appModule.default;

  const { connectDB } = await import("../src/config/db.js");
  const User = (await import("../src/models/User.js")).default;
  const Media = (await import("../src/models/Media.js")).default;
  const LiveQueueSetting = (await import("../src/models/LiveQueueSetting.js")).default;

  await connectDB();
  await Media.deleteMany({});
  await LiveQueueSetting.deleteMany({});

  const adminUser = await User.findOne({ role: "admin" });
  assert.ok(adminUser, "admin seed must exist");
  adminToken = (await import("../src/utils/jwt.js")).generateAccessToken(
    adminUser
  );

  await new Promise((resolve) => {
    server = http.createServer(app);
    server.listen(0, () => resolve());
  });
  baseUrl = `http://127.0.0.1:${server.address().port}/api`;
});

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await mongoose.disconnect();
  if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true });
});

// ─── A. SMALL IMAGE UPLOAD (local driver) ─────────

test("A/J. uploads a small image via the local driver without buffering in RAM", async () => {
  const res = await upload(tinyPng, "poster.png", "image/png");
  assert.equal(res.status, 201);

  const body = await res.json();
  assert.equal(body.data.media.type, "image");
  assert.match(body.data.media.url, /\/uploads\/media\/.+\.png$/);

  // Written to the permanent folder, and the temp file is gone.
  const key = body.data.media.url.split("/uploads/media/")[1];
  await fs.access(path.join(tmpDir, "media", key));
  assert.deepEqual(await tmpFiles(), []);
});

// ─── B. SMALL VIDEO UPLOAD ────────────────────────

test("B. uploads a small video with client-reported duration", async () => {
  const res = await upload(Buffer.alloc(64 * 1024, 1), "promo.mp4", "video/mp4", {
    duration: 32,
  });
  assert.equal(res.status, 201);
  const body = await res.json();
  assert.equal(body.data.media.type, "video");
  assert.equal(body.data.media.duration, 32);
  assert.deepEqual(await tmpFiles(), []);
});

// ─── L. RESPONSE SHAPE ────────────────────────────

test("L. keeps the existing media response shape (no storageKey leak)", async () => {
  const res = await upload(tinyPng, "shape.png", "image/png");
  const media = (await res.json()).data.media;

  for (const field of [
    "id",
    "category",
    "name",
    "type",
    "url",
    "thumbnailUrl",
    "mimeType",
    "size",
    "duration",
    "isActive",
    "sortOrder",
    "uploadedBy",
    "createdAt",
    "updatedAt",
  ]) {
    assert.ok(field in media, `missing field: ${field}`);
  }
  assert.equal(media.storageKey, undefined);
  assert.equal(media.mimeType, "image/png");
  assert.equal(media.size, tinyPng.length);
  assert.equal(media.isActive, false);
  assert.equal(media.category, "reel");
});

// ─── C/D/K. CLOUDINARY DRIVER, STREAMED ───────────

test("C/D/K. streams the temp file to Cloudinary, then deletes the temp file", async () => {
  const payload = Buffer.alloc(200 * 1024, 7);
  const seen = [];
  const mediaBefore = await mediaFiles();

  await withFakeCloudinary(
    {
      onUpload: (params, callback) => {
        const stub = cloudinaryUploadStub({ duration: 12.4 })(params, callback);
        seen.push(stub.state);
        return stub;
      },
    },
    async () => {
      const res = await upload(payload, "cloud.mp4", "video/mp4");
      assert.equal(res.status, 201);
      const media = (await res.json()).data.media;

      // CDN URL + generated thumbnail + provider duration fallback.
      assert.match(
        media.url,
        /^https:\/\/res\.cloudinary\.com\/test-cloud\/video\/upload\/v\d+\/[0-9a-f-]{36}\.mp4$/
      );
      assert.match(media.thumbnailUrl, /\/video\/upload\/[a-z_,0-9]*w_400/);
      assert.match(media.thumbnailUrl, /h_300/);
      assert.equal(media.duration, 12, "provider duration used as fallback");

      // The provider streamed the file: no fs.readFile, real bytes delivered.
      assert.equal(seen.length, 1);
      assert.equal(seen[0].bytes, payload.length);
    }
  );

  // Folder / resource_type / random public_id preserved.
  assert.ok(seen[0].params.folder, "cloudinary folder must be set");
  assert.equal(seen[0].params.resource_type, "video");
  assert.match(seen[0].params.public_id, /^[0-9a-f-]{36}$/);

  // D. temp file removed, and nothing persisted locally in Cloudinary mode.
  assert.deepEqual(await tmpFiles(), []);
  assert.deepEqual(await mediaFiles(), mediaBefore);
});

test("K. Cloudinary image upload keeps the image resource_type and thumbnail", async () => {
  const params = [];
  await withFakeCloudinary(
    {
      onUpload: (p, callback) => {
        params.push(p);
        return cloudinaryUploadStub()(p, callback);
      },
    },
    async () => {
      const res = await upload(tinyPng, "cloud.png", "image/png");
      assert.equal(res.status, 201);
      const media = (await res.json()).data.media;
      assert.match(media.url, /\/image\/upload\//);
      assert.match(media.thumbnailUrl, /\/image\/upload\/[a-z_,0-9]*w_400/);
    }
  );
  assert.equal(params[0].resource_type, "image");
  assert.deepEqual(await tmpFiles(), []);
});

// ─── E. CLOUDINARY FAILURE ────────────────────────

test("E. deletes the temp file when the Cloudinary upload fails", async () => {
  await withFakeCloudinary(
    { onUpload: cloudinaryUploadStub({ fail: true }) },
    async () => {
      const res = await upload(Buffer.alloc(4096, 3), "boom.mp4", "video/mp4");
      assert.equal(res.status, 500);
      const body = await res.json();
      assert.equal(body.success, false);
      assert.equal(typeof body.message, "string");
    }
  );

  assert.deepEqual(await tmpFiles(), []);
});

// ─── F. DATABASE FAILURE ──────────────────────────

test("F. deletes the temp file and the stored object when the DB save fails", async () => {
  const before = await mediaFiles();
  const Media = (await import("../src/models/Media.js")).default;
  const realCreate = Media.create;
  Media.create = async () => {
    throw new Error("simulated mongo outage");
  };

  try {
    const res = await upload(tinyPng, "dbfail.png", "image/png");
    assert.equal(res.status, 500);
  } finally {
    Media.create = realCreate;
  }

  assert.deepEqual(await tmpFiles(), []);
  // The orphaned permanent object was rolled back too.
  assert.deepEqual(await mediaFiles(), before);
});

// ─── G. IMAGE SIZE LIMIT ──────────────────────────

test("G. rejects an image over MEDIA_MAX_IMAGE_MB and removes the temp file", async () => {
  const res = await upload(
    Buffer.alloc(constants.MEDIA_LIMITS.image + 1),
    "huge.png",
    "image/png"
  );
  assert.equal(res.status, 413);
  assert.match((await res.json()).message, /image size limit/);
  assert.deepEqual(await tmpFiles(), []);
});

test("G. the image limit is independent of the (larger) video limit", async () => {
  // 2x the image cap but well under the video cap: a video must still pass,
  // proving images are not measured against MEDIA_MAX_VIDEO_MB.
  const size = constants.MEDIA_LIMITS.image * 2;
  assert.ok(size < constants.MEDIA_LIMITS.video);

  const res = await upload(Buffer.alloc(size), "big-but-legal.mp4", "video/mp4");
  assert.equal(res.status, 201);
  assert.deepEqual(await tmpFiles(), []);
});

// ─── H. VIDEO SIZE LIMIT ──────────────────────────

test("H. rejects a video over the multipart ceiling and removes the temp file", async () => {
  const res = await upload(
    Buffer.alloc(constants.MAX_UPLOAD_BYTES + 1024),
    "toobig.mp4",
    "video/mp4"
  );
  assert.equal(res.status, 413);
  assert.match((await res.json()).message, /size limit/);
  assert.deepEqual(await tmpFiles(), []);
});

test("H. rejects a video over MEDIA_MAX_VIDEO_MB at the service layer", async () => {
  // Sparse file: logically over the video cap, ~no bytes on disk, and never
  // read — the size check happens before the provider touches the file.
  const filePath = path.join(
    uploadTemp.getUploadTmpDir(),
    `${randomUUID()}.mp4`
  );
  await fs.mkdir(uploadTemp.getUploadTmpDir(), { recursive: true });
  await fs.writeFile(filePath, "x");
  await fs.truncate(filePath, constants.MEDIA_LIMITS.video + 1024);

  await assert.rejects(
    () =>
      createMedia({
        filePath,
        originalname: "sparse.mp4",
        mimeType: "video/mp4",
      }),
    (error) => {
      assert.equal(error.statusCode, 413);
      assert.match(error.message, /video size limit/);
      return true;
    }
  );

  // Temp file cleaned up even though createMedia never reached the provider.
  await assert.rejects(() => fs.access(filePath));
});

// ─── I. INVALID / MALFORMED INPUT ─────────────────

test("I. rejects an unsupported file type and writes nothing", async () => {
  const res = await upload(Buffer.from("MZ...."), "evil.exe", "application/octet-stream");
  assert.equal(res.status, 400);
  assert.equal((await res.json()).success, false);
  assert.deepEqual(await tmpFiles(), []);
});

test("I. returns 400 for a malformed multipart body", async () => {
  const res = await fetch(`${baseUrl}/media`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${adminToken}`,
      "Content-Type": "multipart/form-data; boundary=nope",
    },
    body: "this is not a valid multipart payload",
  });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).success, false);
  assert.deepEqual(await tmpFiles(), []);
});

test("I. rejects a non-positive duration without leaving a temp file", async () => {
  const res = await upload(tinyPng, "dur.png", "image/png", { duration: -5 });
  assert.equal(res.status, 400);
  assert.deepEqual(await tmpFiles(), []);
});

// ─── 20. STARTUP CLEANUP ──────────────────────────

test("20. boot cleanup removes only stale temp files, never uploads/media", async () => {
  const tmp = uploadTemp.getUploadTmpDir();
  const mediaDir = path.join(tmpDir, "media");
  await fs.mkdir(tmp, { recursive: true });
  await fs.mkdir(mediaDir, { recursive: true });

  const stale = path.join(tmp, "stale.tmp");
  const fresh = path.join(tmp, "fresh.tmp");
  const keepMedia = path.join(mediaDir, "keep.png");
  await fs.writeFile(stale, "old");
  await fs.writeFile(fresh, "new");
  await fs.writeFile(keepMedia, "permanent");

  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
  await fs.utimes(stale, twoHoursAgo, twoHoursAgo);

  const removed = await uploadTemp.cleanupStaleUploads();
  assert.equal(removed, 1);

  await assert.rejects(() => fs.access(stale), { code: "ENOENT" });
  await fs.access(fresh);
  await fs.access(keepMedia);
  assert.ok(uploadTemp.STALE_TMP_MAX_AGE_MS >= 30 * 60 * 1000);

  await fs.rm(fresh, { force: true });
  await fs.rm(keepMedia, { force: true });
});

// ─── 23. MEMORY ARCHITECTURE GUARD ────────────────

test("23. upload path has no memoryStorage -> buffer -> readFile -> Cloudinary chain", async () => {
  const read = (rel) =>
    fs.readFile(new URL(rel, import.meta.url), "utf8");

  const middleware = await read("../src/middleware/upload.middleware.js");
  const provider = await read("../src/services/providers/media.provider.js");
  const service = await read("../src/services/media.service.js");

  assert.doesNotMatch(middleware, /memoryStorage/);
  assert.match(middleware, /diskStorage/);
  assert.match(middleware, /tmp/);

  for (const [name, source] of Object.entries({ provider, service })) {
    assert.doesNotMatch(source, /readFile\(/, `${name} must not readFile`);
  }

  // Cloudinary path is fed by a readable stream, not a Buffer.
  assert.match(provider, /pipeline\(createReadStream\(filePath\), stream\)/);
  assert.doesNotMatch(provider, /req\.file\.buffer/);

  // The temp filename is generated, never taken from the client.
  assert.match(middleware, /randomUUID\(\)/);
  assert.doesNotMatch(middleware, /originalname/);
});

test("23. a large payload streams through without a full-size buffer", async () => {
  // 2.5 MB (the ceiling in this file is 3 MB) through the real multipart
  // path, asserting the provider consumed the stream incrementally rather
  // than receiving one big Buffer.
  const payload = Buffer.alloc(2.5 * 1024 * 1024, 9);
  const states = [];
  const mediaBefore = await mediaFiles();

  await withFakeCloudinary(
    {
      onUpload: (params, callback) => {
        const stub = cloudinaryUploadStub()(params, callback);
        states.push(stub.state);
        return stub;
      },
    },
    async () => {
      const res = await upload(payload, "big.mp4", "video/mp4");
      assert.equal(res.status, 201);
      const media = (await res.json()).data.media;
      assert.equal(media.size, payload.length);
    }
  );

  assert.equal(states[0].bytes, payload.length);
  assert.deepEqual(await tmpFiles(), []);
  assert.deepEqual(await mediaFiles(), mediaBefore);
});

test("23. local driver copies the temp file with a stream", async () => {
  // Guards the local branch against a regression to readFile + writeFile.
  const res = await upload(tinyPng, "streamed.png", "image/png");
  const media = (await res.json()).data.media;
  const stored = path.join(tmpDir, "media", media.url.split("/uploads/media/")[1]);
  const contents = await fs.readFile(stored);
  assert.equal(contents.length, tinyPng.length);
  await fs.rm(stored, { force: true });
});

test("path traversal in a client filename never reaches the filesystem", async () => {
  const res = await upload(
    tinyPng,
    "../../../../etc/passwd.png",
    "image/png"
  );
  assert.equal(res.status, 201);
  const media = (await res.json()).data.media;
  // The name is a DB label only; undici already strips the path segments and
  // the server never uses it as a filename.
  assert.doesNotMatch(media.name, /[\\/]/);
  assert.match(media.url, /\/uploads\/media\/[0-9a-f-]{36}\.png$/);
  assert.deepEqual(await tmpFiles(), []);

  const stored = path.join(tmpDir, "media", media.url.split("/uploads/media/")[1]);
  await fs.access(stored);
  await fs.rm(stored, { force: true });
});

test("removeTempUpload refuses paths outside the temp directory", async () => {
  const outside = path.join(tmpDir, "media", "not-temp.png");
  await fs.mkdir(path.dirname(outside), { recursive: true });
  await fs.writeFile(outside, "keep");

  await uploadTemp.removeTempUpload(outside);
  await uploadTemp.removeTempUpload("/etc/passwd");
  await uploadTemp.removeTempUpload("../../etc/passwd");
  await uploadTemp.removeTempUpload(undefined);

  await fs.access(outside);
  await fs.rm(outside, { force: true });
});

test("createReadStream is what feeds the provider (sanity: tmp helper exports)", async () => {
  const filePath = path.join(
    uploadTemp.getUploadTmpDir(),
    `${randomUUID()}.png`
  );
  await fs.mkdir(uploadTemp.getUploadTmpDir(), { recursive: true });
  await fs.writeFile(filePath, tinyPng);

  const chunks = [];
  for await (const chunk of createReadStream(filePath)) {
    chunks.push(chunk);
  }
  assert.equal(Buffer.concat(chunks).length, tinyPng.length);

  await uploadTemp.removeTempUpload(filePath);
  await assert.rejects(() => fs.access(filePath));
});
