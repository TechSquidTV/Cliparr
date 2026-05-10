import "./config/loadEnv.js";
import type { Server } from "node:http";
import { createApp } from "./app.js";
import { closeDatabase } from "./db/database.js";
import { configureLogging, getServerLogger, serializeError } from "./logging.js";

const logger = getServerLogger("server");

function hasCloseAllConnections(server: Server): server is Server & { closeAllConnections(): void } {
  return "closeAllConnections" in server && typeof server.closeAllConnections === "function";
}

async function startServer() {
  await configureLogging();
  const { app } = await createApp();
  const PORT = Number(process.env.PORT ?? 3000);

  const server = app.listen(PORT, "0.0.0.0", () => {
    logger.info("Server listening on {url}.", {
      url: `http://localhost:${PORT}`,
      port: PORT,
    });
  });

  let shuttingDown = false;
  let databaseClosed = false;

  const closeDatabaseOnce = () => {
    if (databaseClosed) {
      return;
    }

    databaseClosed = true;
    closeDatabase();
  };

  // Graceful shutdown
  const shutdown = async () => {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    logger.info("Shutting down server.");

    // Close all connections immediately in modern Node.js to release ports faster
    if (hasCloseAllConnections(server)) {
      server.closeAllConnections();
    }

    server.close(() => {
      logger.info("Server closed.");
      closeDatabaseOnce();
      process.exit(0);
    });

    // Force exit after 1s if things hang
    setTimeout(() => {
      logger.warn("Force exiting after shutdown timeout.", {
        timeoutMs: 1000,
      });
      closeDatabaseOnce();
      process.exit(1);
    }, 1000).unref();
  };

  process.on("SIGINT", () => {
    void shutdown();
  });
  process.on("SIGTERM", () => {
    void shutdown();
  });
}



startServer().catch((err: unknown) => {
  logger.fatal("Failed to start server.", serializeError(err));
  closeDatabase();
  process.exit(1);
});
