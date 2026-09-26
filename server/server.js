import "dotenv/config";

import http from "http";
import app from "./src/app.js";
import { connectDB } from "./src/config/db.js";

import { initSocketServer } from "./src/sockets/index.js";

import { startPreCallScheduler } from "./src/services/preCall.service.js";

const PORT = Number(process.env.PORT) || 5000;
// "::" binds IPv6 with IPv4-mapped dual-stack, so the server is
// reachable at both localhost (::1) and 127.0.0.1. A plain
// "0.0.0.0" is IPv4-only and is refused by browsers that
// resolve localhost to ::1.
const HOST = process.env.HOST || "::";

let server;

/**
 * Start the application server
 */
const startServer = async () => {
  try {
    // Connect to MongoDB before starting HTTP server
    await connectDB();

    server = http.createServer(app);

    // Attach Socket.IO for real-time queue updates
    initSocketServer(server);

    // Background pre-call sweeper: delivers "you're up soon" emails
    // at their scheduled time. unref()'d inside, so it never blocks
    // a graceful shutdown.
    startPreCallScheduler();

    // Prevent connections from hanging indefinitely
    server.keepAliveTimeout = 65_000;
    server.headersTimeout = 66_000;

    server.listen(PORT, HOST, () => {
      console.log(`
┌──────────────────────────────────────────────┐
│          Queue Management System             │
├──────────────────────────────────────────────┤
│ Environment: ${ process.env.NODE_ENV || "development" }
│ Server: http://localhost:${PORT}
│ Host: ${ HOST }
│ Status: Running
└──────────────────────────────────────────────┘
`);
    });

    /**
     * Handle HTTP server errors
     */
    server.on("error", (error) => {
      console.error("❌ HTTP Server Error:", error);

      // Port is already being used
      if (error.code === "EADDRINUSE") {
        console.error(`❌ Port ${ PORT } is already in use.`);
      }

      process.exit(1);
    });
  } catch (error) {
    console.error("❌ Failed to start server:", error);

    process.exit(1);
  }
};

/**
 * Gracefully shutdown the application
 */
const shutdown = async (signal) => {
  console.log(`\n⚠️ ${ signal } received.Shutting down gracefully...`);

  if (!server) {
    process.exit(0);
  }

  server.close((error) => {
    if (error) {
      console.error("❌ Error while closing server:", error);
      process.exit(1);
    }

    console.log("✅ HTTP server closed.");
    console.log("👋 Application shutdown complete.");

    process.exit(0);
  });
};

/**
 * Handle process termination signals
 */
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

/**
 * Handle unexpected errors
 */
process.on("uncaughtException", (error) => {
  console.error("❌ Uncaught Exception:", error);

  shutdown("uncaughtException").finally(() => {
    process.exit(1);
  });
});

process.on("unhandledRejection", (reason) => {
  console.error("❌ Unhandled Promise Rejection:", reason);

  shutdown("unhandledRejection").finally(() => {
    process.exit(1);
  });
});

// Start application
startServer();