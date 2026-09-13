import "dotenv/config";

import test from "node:test";
import assert from "node:assert/strict";

import mongoose from "mongoose";

import Service from "../src/models/Service.js";
import User from "../src/models/User.js";
import Customer from "../src/models/Customer.js";
import Notification from "../src/models/Notification.js";

import { generateToken } from "../src/services/token.service.js";
import { callToken } from "../src/services/queue.service.js";
import {
  notify,
  retryNotification,
} from "../src/services/notification.service.js";

import {
  findNotificationsForCustomer,
  findNotificationsForRecipient,
  markNotificationsRead,
  markAllNotificationsRead,
  countUnreadNotifications,
  updateNotificationStatus,
} from "../src/repositories/notification.repository.js";

import {
  NOTIFICATION_RECIPIENT,
  NOTIFICATION_TYPE,
  NOTIFICATION_STATUS,
  NOTIFICATION_PROVIDER,
} from "../src/constants/notification.js";

let admin;
let staff;
let service;
let customer;

test.before(async () => {
  await mongoose.connect(process.env.MONGODB_URI);

  await Notification.deleteMany({});
  await Customer.deleteMany({});
  await import("../src/models/Token.js").then(({ default: Token }) =>
    Token.deleteMany({})
  );
  await import("../src/models/TokenSequence.js").then(({ default: TS }) =>
    TS.deleteMany({})
  );
});

test.after(async () => {
  await mongoose.disconnect();
});

test.beforeEach(async () => {
  await Notification.deleteMany({});
  await Customer.deleteMany({});
  await import("../src/models/Token.js").then(({ default: Token }) =>
    Token.deleteMany({})
  );
  await import("../src/models/TokenSequence.js").then(({ default: TS }) =>
    TS.deleteMany({})
  );

  admin = await User.findOne({ role: "admin" });
  staff = await User.findOne({ role: "staff" });
  service = await Service.findOne({ code: "CUT" });

  assert.ok(staff && admin && service, "seed fixtures present");
});

// ─── Basic persistence & listing ──────────────────────

test("persists a customer notification and lists it for the customer", async () => {
  const { customer: cust } = await generateToken({
    serviceId: service._id,
    customer: {
      name: "N Customer",
      phone: "0411222333",
    },
  });

  const created = await notify({
    type: NOTIFICATION_TYPE.TOKEN_CALLED,
    title: "Your turn is now",
    message: "Token X-001, please proceed.",
    recipientType: NOTIFICATION_RECIPIENT.CUSTOMER,
    customer: cust._id,
    tokenNumber: "X-001",
  });

  assert.ok(created._id, "notification persisted");

  customer = cust._id;

  const list = await findNotificationsForCustomer(cust._id);
  assert.equal(list.length, 1);
  assert.equal(list[0].tokenNumber, "X-001");
  assert.equal(list[0].read, false);

  const unread = await countUnreadNotifications({
    customer: cust._id,
  });
  assert.equal(unread, 1);
});

test("notify() during a real call persists a notification tied to the token", async () => {
  const { token, customer: cust } = await generateToken({
    serviceId: service._id,
    customer: {
      name: "N Call Customer",
      phone: "0411333444",
    },
  });

  await callToken(token._id, {
    userId: staff._id,
  });

  const nt = await notify({
    type: NOTIFICATION_TYPE.TOKEN_CALLED,
    title: "Your turn is now",
    message: `Token ${token.tokenNumber}, please proceed.`,
    recipientType: NOTIFICATION_RECIPIENT.CUSTOMER,
    customer: cust._id,
    token: token._id,
    tokenNumber: token.tokenNumber,
  });

  const found = await Notification.findOne({
    token: token._id,
  }).populate("customer");

  assert.ok(found, "notification linked to token exists");
  assert.equal(found.customer._id.toString(), cust._id.toString());
  assert.equal(found.message.includes(token.tokenNumber), true);
  assert.deepEqual(found.toSafeObject().customer, found.customer);
});

// ─── Status tracking ──────────────────────────────────

test("notify() sets status to PENDING then SENT when mock provider succeeds", async () => {
  const { customer: cust } = await generateToken({
    serviceId: service._id,
    customer: {
      name: "N Status Customer",
      phone: "0411555666",
    },
  });

  const result = await notify({
    type: NOTIFICATION_TYPE.TOKEN_CALLED,
    title: "Your turn",
    message: "Proceed",
    recipientType: NOTIFICATION_RECIPIENT.CUSTOMER,
    customer: cust._id,
    channel: "SOCKET",
  });

  assert.equal(
    result.status,
    NOTIFICATION_STATUS.SENT,
    "status should be SENT after successful delivery"
  );
  assert.ok(result.sentAt, "sentAt should be set");
  assert.equal(
    result.provider,
    "socket",
    "provider should be socket for SOCKET channel"
  );
});

test("notify() with non-existent provider marks notification as FAILED", async () => {
  const { customer: cust } = await generateToken({
    serviceId: service._id,
    customer: {
      name: "N Fail Customer",
      phone: "0411777888",
    },
  });

  const result = await notify({
    type: NOTIFICATION_TYPE.TOKEN_CALLED,
    title: "Your turn",
    message: "Proceed",
    recipientType: NOTIFICATION_RECIPIENT.CUSTOMER,
    customer: cust._id,
    channel: "SMS",
  });

  // SMS provider returns controlled failure when env vars are missing.
  assert.equal(
    result.status,
    NOTIFICATION_STATUS.FAILED,
    "status should be FAILED when provider is unconfigured"
  );
  assert.ok(result.error, "error message should be present");
  assert.equal(result.provider, "sms");
});

test("safe object includes provider, sentAt, error, status fields", async () => {
  const { customer: cust } = await generateToken({
    serviceId: service._id,
    customer: {
      name: "N Safe Customer",
      phone: "0411999000",
    },
  });

  const result = await notify({
    type: NOTIFICATION_TYPE.TOKEN_CALLED,
    title: "Test",
    message: "Test",
    recipientType: NOTIFICATION_RECIPIENT.CUSTOMER,
    customer: cust._id,
    channel: "SOCKET",
  });

  const safe = result.toSafeObject();

  assert.ok("provider" in safe, "safe object has provider");
  assert.ok("sentAt" in safe, "safe object has sentAt");
  assert.ok("error" in safe, "safe object has error");
  assert.ok("status" in safe, "safe object has status");
  assert.equal(safe.status, NOTIFICATION_STATUS.SENT);
  assert.equal(safe.provider, "socket");
  assert.equal(safe.error, null);
});

// ─── Retry ────────────────────────────────────────────

test("retryNotification retries a FAILED notification successfully", async () => {
  const { customer: cust } = await generateToken({
    serviceId: service._id,
    customer: {
      name: "N Retry Customer",
      phone: "0421111222",
    },
  });

  // Create a FAILED notification by using SMS (unconfigured).
  const failed = await notify({
    type: NOTIFICATION_TYPE.TOKEN_CALLED,
    title: "Failed",
    message: "Should fail",
    recipientType: NOTIFICATION_RECIPIENT.CUSTOMER,
    customer: cust._id,
    channel: "SMS",
  });

  assert.equal(failed.status, NOTIFICATION_STATUS.FAILED);

  // Manually retry using mock channel (simulates re-routing).
  // First reset the status to FAILED again to simulate a real retry scenario.
  await updateNotificationStatus(failed._id, {
    status: NOTIFICATION_STATUS.FAILED,
    error: "Previous failure",
  });

  // Now retry with mock provider (which succeeds).
  const notification = await Notification.findById(failed._id);
  notification.status = NOTIFICATION_STATUS.FAILED;
  notification.channel = "SOCKET"; // re-route to working channel
  await notification.save();

  const retried = await retryNotification(failed._id);

  assert.equal(
    retried.status,
    NOTIFICATION_STATUS.SENT,
    "retried notification should be SENT"
  );
  assert.ok(retried.sentAt, "sentAt should be set after retry");
  assert.equal(retried.error, null, "error should be cleared after success");
});

test("retryNotification throws for non-existent notification", async () => {
  const fakeId = new mongoose.Types.ObjectId();

  await assert.rejects(
    retryNotification(fakeId),
    /Notification not found/
  );
});

test("retryNotification throws for non-FAILED notifications", async () => {
  const { customer: cust } = await generateToken({
    serviceId: service._id,
    customer: {
      name: "N Retry Guard",
      phone: "0421333444",
    },
  });

  const sent = await notify({
    type: NOTIFICATION_TYPE.TOKEN_CALLED,
    title: "Sent",
    message: "Already sent",
    recipientType: NOTIFICATION_RECIPIENT.CUSTOMER,
    customer: cust._id,
    channel: "SOCKET",
  });

  assert.equal(sent.status, NOTIFICATION_STATUS.SENT);

  await assert.rejects(
    retryNotification(sent._id),
    /Only failed notifications can be retried/
  );
});

// ─── Mark read scoping ────────────────────────────────

test("marks customer notifications as read and updates count", async () => {
  const { customer: cust } = await generateToken({
    serviceId: service._id,
    customer: {
      name: "N Read Customer",
      phone: "0411444555",
    },
  });

  await notify({
    type: NOTIFICATION_TYPE.TOKEN_CALLED,
    message: "msg 1",
    recipientType: NOTIFICATION_RECIPIENT.CUSTOMER,
    customer: cust._id,
  });
  await notify({
    type: NOTIFICATION_TYPE.NEXT_CALLED,
    message: "msg 2",
    recipientType: NOTIFICATION_RECIPIENT.CUSTOMER,
    customer: cust._id,
  });

  const before = await countUnreadNotifications({ customer: cust._id });
  assert.equal(before, 2);

  const unread = await findNotificationsForCustomer(cust._id, {
    readOnly: "unread",
  });
  assert.equal(unread.length, 2);

  await markAllNotificationsRead({ customer: cust._id });

  const after = await countUnreadNotifications({ customer: cust._id });
  assert.equal(after, 0);

  const marked = await findNotificationsForCustomer(cust._id);
  assert.equal(marked.every((n) => n.read === true), true);
});

test("markNotificationsRead with recipientId does not mark other recipients' notifications", async () => {
  const { customer: cust } = await generateToken({
    serviceId: service._id,
    customer: {
      name: "N Scoped Customer",
      phone: "0421555666",
    },
  });

  await notify({
    type: NOTIFICATION_TYPE.TOKEN_CALLED,
    message: "staff msg",
    recipientType: NOTIFICATION_RECIPIENT.STAFF,
    recipient: staff._id,
  });

  await notify({
    type: NOTIFICATION_TYPE.TOKEN_CALLED,
    message: "customer msg",
    recipientType: NOTIFICATION_RECIPIENT.CUSTOMER,
    customer: cust._id,
  });

  // Try to mark staff notification as read using customer scope.
  const staffNotifications = await findNotificationsForRecipient(staff._id);
  const staffIds = staffNotifications.map((n) => n._id);

  await markNotificationsRead(staffIds, {
    recipientId: cust._id.toString(),
  });

  // Staff notification should still be unread.
  const after = await findNotificationsForRecipient(staff._id);
  assert.equal(
    after[0].read,
    false,
    "staff notification should not be affected by customer mark-read"
  );
});

// ─── Staff listing ────────────────────────────────────

test("persists a staff notification and lists/marks it for a recipient", async () => {
  const created = await notify({
    type: NOTIFICATION_TYPE.TOKEN_CALLED,
    title: "Next customer",
    message: "Token CUT-101 is being served.",
    recipientType: NOTIFICATION_RECIPIENT.CUSTOMER,
    customer: null,
  });

  // A staff-scoped notification instead.
  await notify({
    type: NOTIFICATION_TYPE.TOKEN_CALLED,
    title: "Queue update",
    message: "Your turn, please proceed.",
    recipientType: NOTIFICATION_RECIPIENT.STAFF,
    recipient: staff._id,
  });

  assert.ok(created._id, "customer notification persisted");

  const staffList = await findNotificationsForRecipient(staff._id);
  assert.equal(staffList.length, 1);
  assert.equal(staffList[0].recipientType, NOTIFICATION_RECIPIENT.STAFF);

  const ids = staffList.map((n) => n._id);
  await markNotificationsRead(ids);

  const unread = await countUnreadNotifications({ recipient: staff._id });
  assert.equal(unread, 0);

  assert.ok(admin, "admin fixture present");
});
