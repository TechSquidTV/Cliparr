import "@/index.css";

import {
  createHashHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { lazy, StrictMode, Suspense, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";

import { LocalFilePicker } from "#/components/local-media/LocalFilePicker";
import { TooltipProvider } from "#/components/ui/tooltip";
import { configureFrontendLogging } from "#/logging";

const rootRoute = createRootRoute();
const homeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: FileLanding,
});
const LocalEditorSessionView = lazy(async () => {
  const { LocalEditorSessionView: component } =
    await import("#/components/local-media/LocalEditorSessionView");
  return { default: component };
});
const editRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/edit/$sessionId",
  component: LocalEditor,
});
function navigateHome() {
  void router.navigate({ to: "/", replace: true });
}
function LocalEditor() {
  const { sessionId } = editRoute.useParams();
  return (
    <Suspense
      fallback={
        <p role="status" className="p-6">
          Opening editor…
        </p>
      }
    >
      <LocalEditorSessionView
        key={sessionId}
        sessionId={sessionId}
        onBack={navigateHome}
        onReopen={navigateHome}
      />
    </Suspense>
  );
}
const router = createRouter({
  routeTree: rootRoute.addChildren([homeRoute, editRoute]),
  history: createHashHistory(),
});

function FileLanding() {
  const [opening, setOpening] = useState(false);
  const [offlineReady, setOfflineReady] = useState(false);
  useEffect(() => {
    let mounted = true;
    void offlineRegistration.then((ready) => {
      if (mounted) {
        setOfflineReady(ready);
      }
    });
    return () => {
      mounted = false;
    };
  }, []);
  return (
    <main className="flex min-h-dvh flex-col bg-background text-foreground">
      <header className="border-b border-border px-6 py-4">
        <a href="/" className="inline-flex items-center gap-2 font-semibold">
          <img src="./logo-light.svg" width="28" height="28" alt="" />
          Cliparr
        </a>
      </header>
      <section className="m-auto w-full max-w-xl px-6 py-12">
        <h1 className="mb-2 text-3xl font-semibold tracking-tight">
          Local clip editor
        </h1>
        <p className="mb-6 text-muted-foreground">
          Trim, add subtitles, and export.
        </p>
        <LocalFilePicker
          opening={opening}
          onOpeningChange={setOpening}
          onOpened={(sessionId) => {
            void router.navigate({
              to: "/edit/$sessionId",
              params: { sessionId },
            });
          }}
        />
        {offlineReady && (
          <p
            role="status"
            className="mt-3 text-center text-sm text-muted-foreground"
          >
            Ready to use offline
          </p>
        )}
      </section>
    </main>
  );
}

async function registerOfflineEditor() {
  if (!import.meta.env.PROD || !("serviceWorker" in navigator)) {
    return false;
  }
  try {
    const registration = await navigator.serviceWorker.register(
      "./service-worker.js",
      { scope: "./" },
    );
    if (registration.active) {
      return true;
    }
    const worker = registration.installing ?? registration.waiting;
    if (!worker) {
      return false;
    }
    return await new Promise<boolean>((resolve) => {
      function checkState() {
        if (worker?.state === "activated" || worker?.state === "redundant") {
          worker.removeEventListener("statechange", checkState);
          resolve(worker.state === "activated");
        }
      }
      worker.addEventListener("statechange", checkState);
      checkState();
    });
  } catch {
    return false;
  }
}
const offlineRegistration = registerOfflineEditor();
await configureFrontendLogging();
const root = document.querySelector("#root");
if (!root) {
  throw new Error("Cliparr root element is missing.");
}
createRoot(root).render(
  <StrictMode>
    <TooltipProvider>
      <RouterProvider router={router} />
    </TooltipProvider>
  </StrictMode>,
);
