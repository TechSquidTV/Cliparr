/// <reference types="node" />

import assert from "node:assert/strict";
import test from "node:test";
import {
  isIosLikeDevice,
  promptForPwaInstall,
  readPwaInstallDismissed,
  resolveMobilePwaInstallMode,
  writePwaInstallDismissed,
  type BeforeInstallPromptEvent,
  type PwaInstallEnvironment,
} from "@/lib/pwa";

function mobileEnvironment(
  overrides: Partial<PwaInstallEnvironment> = {},
): PwaInstallEnvironment {
  return {
    coarsePointer: true,
    dismissed: false,
    hasInstallPrompt: true,
    isSecureContext: true,
    maxTouchPoints: 5,
    mobileViewport: true,
    navigatorStandalone: false,
    standaloneDisplayMode: false,
    userAgent:
      "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/125 Mobile Safari/537.36",
    ...overrides,
  };
}

function memoryStorage(): Storage {
  const values = new Map<string, string>();

  return {
    get length() {
      return values.size;
    },
    clear() {
      values.clear();
    },
    getItem(key) {
      return values.get(key) ?? null;
    },
    key(index) {
      return [...values.keys()][index] ?? null;
    },
    removeItem(key) {
      values.delete(key);
    },
    setItem(key, value) {
      values.set(key, value);
    },
  };
}

void test("allows native PWA install UI on secure mobile surfaces", () => {
  assert.equal(resolveMobilePwaInstallMode(mobileEnvironment()), "native");
});

void test("does not show PWA install UI on desktop", () => {
  assert.equal(
    resolveMobilePwaInstallMode(
      mobileEnvironment({
        maxTouchPoints: 0,
        userAgent:
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/537.36 Chrome/125 Safari/537.36",
      }),
    ),
    "hidden",
  );
});

void test("hides PWA install UI for installed standalone sessions", () => {
  assert.equal(
    resolveMobilePwaInstallMode(
      mobileEnvironment({ standaloneDisplayMode: true }),
    ),
    "hidden",
  );
  assert.equal(
    resolveMobilePwaInstallMode(
      mobileEnvironment({ navigatorStandalone: true }),
    ),
    "hidden",
  );
});

void test("hides PWA install UI after dismissal", () => {
  assert.equal(
    resolveMobilePwaInstallMode(mobileEnvironment({ dismissed: true })),
    "hidden",
  );
});

void test("hides native PWA install CTA when install is insecure or unsupported", () => {
  assert.equal(
    resolveMobilePwaInstallMode(mobileEnvironment({ isSecureContext: false })),
    "hidden",
  );
  assert.equal(
    resolveMobilePwaInstallMode(mobileEnvironment({ hasInstallPrompt: false })),
    "hidden",
  );
});

void test("uses iOS guide mode when native install prompts are unavailable", () => {
  assert.equal(
    resolveMobilePwaInstallMode(
      mobileEnvironment({
        hasInstallPrompt: false,
        userAgent:
          "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Version/17.5 Mobile/15E148 Safari/604.1",
      }),
    ),
    "ios",
  );
  assert.equal(
    isIosLikeDevice("Mozilla/5.0 (Macintosh; Intel Mac OS X)", 5),
    true,
  );
});

void test("persists PWA install dismissal state", () => {
  const storage = memoryStorage();

  assert.equal(readPwaInstallDismissed(storage), false);
  writePwaInstallDismissed(true, storage);
  assert.equal(readPwaInstallDismissed(storage), true);
  writePwaInstallDismissed(false, storage);
  assert.equal(readPwaInstallDismissed(storage), false);
});

void test("returns the PWA install user choice after prompting", async () => {
  let prompted = false;
  const choice = { outcome: "accepted" as const, platform: "web" };
  const installPrompt = {
    userChoice: Promise.resolve(choice),
    async prompt() {
      prompted = true;
    },
  } as BeforeInstallPromptEvent;

  assert.equal(await promptForPwaInstall(installPrompt), choice);
  assert.equal(prompted, true);
});

void test("returns null when a PWA install prompt has no user choice", async () => {
  let prompted = false;
  const installPrompt = {
    async prompt() {
      prompted = true;
    },
  } as BeforeInstallPromptEvent;

  assert.equal(await promptForPwaInstall(installPrompt), null);
  assert.equal(prompted, true);
});
