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
  const [updateMessage, setUpdateMessage] = useState("");
  useEffect(() => {
    let mounted = true;
    const cleanups: (() => void)[] = [];
    void offlineRegistration.then((registration) => {
      if (!mounted || !registration) {
        return;
      }
      function refresh() {
        const worker = registration?.active;
        if (worker) {
          void readOfflineVersion(worker).then((version) => {
            if (mounted && worker === registration?.active) {
              setOfflineReady(version === buildVersion);
            }
          });
        } else {
          setOfflineReady(false);
        }
        setUpdateMessage(
          registration?.waiting
            ? "Update available. Close all editor tabs and reopen to update."
            : "",
        );
      }
      function watchInstall() {
        const worker = registration?.installing;
        if (!worker) {
          return;
        }
        function changed() {
          refresh();
          if (worker?.state === "redundant") {
            setUpdateMessage(
              "Could not download the update. Reopen the editor online to try again.",
            );
          }
        }
        worker.addEventListener("statechange", changed);
        cleanups.push(() => worker.removeEventListener("statechange", changed));
      }
      registration.addEventListener("updatefound", watchInstall);
      navigator.serviceWorker.addEventListener("controllerchange", refresh);
      cleanups.push(() => {
        registration.removeEventListener("updatefound", watchInstall);
        navigator.serviceWorker.removeEventListener(
          "controllerchange",
          refresh,
        );
      });
      watchInstall();
      refresh();
    });
    return () => {
      mounted = false;
      for (const cleanup of cleanups) {
        cleanup();
      }
    };
  }, []);
  return (
    <main className="flex min-h-dvh flex-col bg-background text-foreground">
      <header className="border-b border-border px-6 py-4">
        <a
          href={import.meta.env.BASE_URL}
          className="inline-flex items-center gap-2 font-semibold"
        >
          <img
            src={`${import.meta.env.BASE_URL}logo-light.svg`}
            width="28"
            height="28"
            alt=""
          />
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
        {updateMessage && (
          <p
            role="status"
            className="mt-3 text-center text-sm text-muted-foreground"
          >
            {updateMessage}
          </p>
        )}
        <p className="mt-4 text-center text-sm text-muted-foreground">
          Have a Plex or Jellyfin server?{" "}
          <a
            href="/docs/getting-started/"
            className="text-foreground underline underline-offset-4 hover:text-primary"
          >
            Connect your library with self-hosted Cliparr{" "}
            <span aria-hidden="true">→</span>
          </a>
        </p>
      </section>
    </main>
  );
}

const offlineWorkerUrl = new URL(
  "service-worker.js",
  new URL(import.meta.env.BASE_URL, location.origin),
);
const buildVersion = document.querySelector<HTMLMetaElement>(
  'meta[name="cliparr-build"]',
)?.content;
function readOfflineVersion(worker: ServiceWorker): Promise<string | null> {
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    function finish(version: string | null) {
      clearTimeout(timeout);
      channel.port1.close();
      resolve(version);
    }
    const timeout = setTimeout(() => finish(null), 2000);
    channel.port1.addEventListener(
      "message",
      (event: MessageEvent<unknown>) => {
        finish(typeof event.data === "string" ? event.data : null);
      },
      { once: true },
    );
    channel.port1.start();
    try {
      worker.postMessage("cliparr-build", [channel.port2]);
    } catch {
      finish(null);
    }
  });
}

async function registerOfflineEditor() {
  if (!import.meta.env.PROD || !("serviceWorker" in navigator)) {
    return null;
  }
  try {
    return await navigator.serviceWorker.register(offlineWorkerUrl, {
      scope: import.meta.env.BASE_URL,
    });
  } catch {
    return null;
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
