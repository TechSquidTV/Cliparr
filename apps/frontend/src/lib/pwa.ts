import { createPwaInstallController } from "@/pwa";

export const appPwa = createPwaInstallController({
  dismissedKey: "cliparr:pwa-install-dismissed",
  serviceWorkerUrl: "/service-worker.js",
  mobileOnly: true,
  reloadOnUpdate: true,
});
