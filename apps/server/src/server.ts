import "dotenv/config";
import { createApp } from "./app.js";

async function startServer() {
  const app = await createApp();
  const PORT = Number(process.env.PORT ?? 3000);

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
