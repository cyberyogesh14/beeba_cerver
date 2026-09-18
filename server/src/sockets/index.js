import { Server } from "socket.io";

import { setIO } from "./emitter.js";

import { verifyAccessToken } from "../utils/jwt.js";

import { getCorsOrigins } from "../config/cors.js";

import { SOCKET_EVENTS } from "../constants/socket.js";

import { ROLES } from "../constants/roles.js";

const {
  JOIN_ADMIN,
  JOIN_STAFF,
  JOIN_DISPLAY,
  JOIN_QUEUE,
  JOIN_CUSTOMER,
} = SOCKET_EVENTS;

/**
 * Resolve the authenticated user from the socket
 * handshake. Public sockets (display, customer) can
 * connect without a token.
 */
const getUserFromHandshake = (handshake) => {
  const token =
    handshake.auth?.token ||
    handshake.headers?.authorization?.replace(
      "Bearer ",
      ""
    );

  if (!token) return null;

  try {
    return verifyAccessToken(token);
  } catch {
    return null;
  }
};

/**
 * Attach Socket.IO to the running HTTP server.
 */
export const initSocketServer = (server) => {
  const io = new Server(server, {
    cors: {
      origin(origin, callback) {
        const allowed = getCorsOrigins();

        if (!origin || allowed.includes(origin)) {
          return callback(null, true);
        }

        return callback(
          new Error("Origin not allowed by CORS"),
          false
        );
      },
      credentials: true,
      methods: [
        "GET",
        "POST",
        "PUT",
        "PATCH",
        "DELETE",
        "OPTIONS",
      ],
      allowedHeaders: ["Content-Type", "Authorization"],
    },
  });

  setIO(io);

  io.on("connection", (socket) => {
    const auth = getUserFromHandshake(
      socket.handshake
    );

    /**
     * Public display screen joins the display room.
     */
    socket.on(JOIN_DISPLAY, () => {
      socket.join("display");
    });

    /**
     * Staff dashboard identifies its queue scope so it
     * only receives updates it cares about.
     */
    socket.on(JOIN_QUEUE, (serviceId) => {
      if (serviceId) {
        socket.join(`queue:${serviceId}`);
      }
    });

    /**
     * Customer tracking screen joins its own room so it
     * only receives notifications scoped to its token.
     */
    socket.on(JOIN_CUSTOMER, (customerId) => {
      if (customerId) {
        socket.join(`customer:${customerId}`);
      }
    });

    /**
     * Leave handlers mirror the join events so screens that
     * switch scope (staff changing service, tracking a
     * different customer) do not accumulate stale rooms.
     */
    socket.on("leave:queue", (serviceId) => {
      if (serviceId) {
        socket.leave(`queue:${serviceId}`);
      }
    });

    socket.on("leave:customer", (customerId) => {
      if (customerId) {
        socket.leave(`customer:${customerId}`);
      }
    });

    /**
     * Authenticated staff join the staff room. Role-checked so a
     * customer token can never subscribe to staff-only notifications.
     */
    socket.on(JOIN_STAFF, () => {
      if (!auth) return;
      const role = auth.role ?? auth.user?.role;
      if (role !== ROLES.STAFF && role !== ROLES.ADMIN) return;
      socket.join("staff");
    });

    /**
     * Authenticated admins join the admin room. Role-checked so only
     * admin tokens can subscribe to admin-only notifications.
     */
    socket.on(JOIN_ADMIN, () => {
      if (!auth) return;
      const role = auth.role ?? auth.user?.role;
      if (role !== ROLES.ADMIN) return;
      socket.join("admin");
    });

    socket.on("disconnect", () => {
      // Rooms are cleaned up automatically by Socket.IO.
    });
  });

  return io;
};
