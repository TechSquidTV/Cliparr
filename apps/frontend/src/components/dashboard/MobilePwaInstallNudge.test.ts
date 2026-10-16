import assert from "node:assert/strict";
import test from "node:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  MobilePwaInstallNudge,
  MobilePwaInstallNudgeCard,
} from "#/components/dashboard/MobilePwaInstallNudge";
import { TooltipProvider } from "#/components/ui/tooltip";
import { COARSE_POINTER_MEDIA_QUERY, MOBILE_INSTALL_MEDIA_QUERY } from "#/pwa";

function restoreGlobalProperty(
  name: string,
  descriptor: PropertyDescriptor | undefined,
) {
  const globalObject = globalThis as typeof globalThis &
    Record<string, unknown>;

  if (descriptor) {
    Object.defineProperty(globalObject, name, descriptor);
    return;
  }

  delete globalObject[name];
}

function withMobilePwaBrowserEnvironment(callback: () => void) {
  const globalObject = globalThis as typeof globalThis &
    Record<string, unknown>;
  const previousWindow = Object.getOwnPropertyDescriptor(
    globalObject,
    "window",
  );
  const previousNavigator = Object.getOwnPropertyDescriptor(
    globalObject,
    "navigator",
  );
  const previousLocalStorage = Object.getOwnPropertyDescriptor(
    globalObject,
    "localStorage",
  );
  const matchingQueries = new Set([
    COARSE_POINTER_MEDIA_QUERY,
    MOBILE_INSTALL_MEDIA_QUERY,
  ]);
  const localStorage = {
    length: 0,
    clear() {
      return;
    },
    getItem() {
      return null;
    },
    key() {
      return null;
    },
    removeItem() {
      return;
    },
    setItem() {
      return;
    },
  } satisfies Storage;

  Object.defineProperty(globalObject, "window", {
    configurable: true,
    value: {
      addEventListener() {
        return;
      },
      isSecureContext: true,
      matchMedia(query: string): MediaQueryList {
        return {
          addEventListener() {
            return;
          },
          addListener() {
            return;
          },
          dispatchEvent() {
            return false;
          },
          matches: matchingQueries.has(query),
          media: query,
          onchange: null,
          removeEventListener() {
            return;
          },
          removeListener() {
            return;
          },
        };
      },
      removeEventListener() {
        return;
      },
    },
  });
  Object.defineProperty(globalObject, "navigator", {
    configurable: true,
    value: {
      maxTouchPoints: 5,
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Version/17.5 Mobile/15E148 Safari/604.1",
    },
  });
  Object.defineProperty(globalObject, "localStorage", {
    configurable: true,
    value: localStorage,
  });

  try {
    callback();
  } finally {
    restoreGlobalProperty("window", previousWindow);
    restoreGlobalProperty("navigator", previousNavigator);
    restoreGlobalProperty("localStorage", previousLocalStorage);
  }
}

void test("renders mobile PWA install nudge for native install state", () => {
  const markup = renderToStaticMarkup(
    createElement(
      TooltipProvider,
      null,
      createElement(MobilePwaInstallNudgeCard, {
        mode: "native",
        onDismiss: () => {},
        onInstall: () => {},
      }),
    ),
  );

  assert.match(markup, /Add Cliparr to your home screen/);
  assert.match(markup, /data-pwa-install-mode="native"/);
  assert.match(markup, />Install</);
});

void test("hides mobile PWA install nudge by default", () => {
  const markup = renderToStaticMarkup(
    createElement(
      TooltipProvider,
      null,
      createElement(MobilePwaInstallNudgeCard, {
        mode: "hidden",
        onDismiss: () => {},
        onInstall: () => {},
      }),
    ),
  );

  assert.equal(markup, "");
});

void test("renders mobile PWA install nudge on the initial eligible browser pass", () => {
  withMobilePwaBrowserEnvironment(() => {
    const markup = renderToStaticMarkup(
      createElement(
        TooltipProvider,
        null,
        createElement(MobilePwaInstallNudge),
      ),
    );

    assert.match(markup, /Add Cliparr to your home screen/);
    assert.match(markup, /data-pwa-install-mode="ios"/);
  });
});
