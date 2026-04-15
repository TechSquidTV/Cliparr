import "dotenv/config";
import { createApp } from "./app.js";

async function startServer() {
  const { app } = await createApp();
  const PORT = Number(process.env.PORT ?? 3000);

  const server = app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });

  // Graceful shutdown
  const shutdown = async () => {
    console.log("Shutting down server...");

    // Close all connections immediately in modern Node.js to release ports faster
    if ("closeAllConnections" in server) {
      (server as any).closeAllConnections();
    }


    server.close(() => {
      console.log("Server closed");
      process.exit(0);
    });

    // Force exit after 1s if things hang
    setTimeout(() => {
      console.log("Force exiting...");
      process.exit(1);
    }, 1000);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}



startServer();

