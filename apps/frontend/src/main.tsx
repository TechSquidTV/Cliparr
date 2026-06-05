import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "@/App.tsx";
import "@/index.css";
import { configureFrontendLogging } from "@/logging";
import {
  registerCliparrServiceWorker,
  startPwaInstallPromptHandling,
} from "@/lib/pwa";

document.documentElement.classList.add("dark");

await configureFrontendLogging();
startPwaInstallPromptHandling();
registerCliparrServiceWorker();

createRoot(document.querySelector("#root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
