import "@/index.css";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import App from "@/App.tsx";
import {
  registerCliparrServiceWorker,
  startPwaInstallPromptHandling,
} from "@/lib/pwa";
import { configureFrontendLogging } from "@/logging";

document.documentElement.classList.add("dark");

await configureFrontendLogging();
startPwaInstallPromptHandling();
registerCliparrServiceWorker();

const rootElement = document.querySelector("#root");
if (!rootElement) {
  throw new Error("Cliparr root element is missing.");
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
