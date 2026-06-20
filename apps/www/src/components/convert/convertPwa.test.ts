import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  isIosLikeDevice,
  metricInputForConvertPwaInstallState,
  readConvertPwaInstallDismissed,
  resolveConvertPwaInstallState,
  writeConvertPwaInstallDismissed,
  type ConvertPwaInstallEnvironment,
} from "@/components/convert/convertPwa";

function installEnvironment(
  overrides: Partial<ConvertPwaInstallEnvironment> = {},
): ConvertPwaInstallEnvironment {
  return {
    appInstalled: false,
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

function desktopEnvironment(
  overrides: Partial<ConvertPwaInstallEnvironment> = {},
): ConvertPwaInstallEnvironment {
  return installEnvironment({
    coarsePointer: false,
    maxTouchPoints: 0,
    mobileViewport: false,
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/537.36 Chrome/125 Safari/537.36",
    ...overrides,
  });
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

void test("allows native Convert PWA install UI on secure mobile surfaces", () => {
  assert.deepEqual(resolveConvertPwaInstallState(installEnvironment()), {
    formFactor: "mobile",
    mode: "native",
  });
});

void test("uses iOS guide mode when native install prompts are unavailable", () => {
  assert.deepEqual(
    resolveConvertPwaInstallState(
      installEnvironment({
        hasInstallPrompt: false,
        userAgent:
          "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Version/17.5 Mobile/15E148 Safari/604.1",
      }),
    ),
    { formFactor: "mobile", mode: "ios" },
  );
  assert.equal(
    isIosLikeDevice("Mozilla/5.0 (Macintosh; Intel Mac OS X)", 5),
    true,
  );
});

void test("keeps desktop install UI subtle and prompt-gated", () => {
  assert.deepEqual(resolveConvertPwaInstallState(desktopEnvironment()), {
    formFactor: "desktop",
    mode: "native",
  });
  assert.deepEqual(
    resolveConvertPwaInstallState(
      desktopEnvironment({ hasInstallPrompt: false }),
    ),
    { formFactor: "desktop", mode: "hidden" },
  );
});

void test("hides Convert PWA install UI when unavailable or already handled", () => {
  for (const overrides of [
    { dismissed: true },
    { isSecureContext: false },
    { appInstalled: true },
    { navigatorStandalone: true },
    { standaloneDisplayMode: true },
  ] satisfies Array<Partial<ConvertPwaInstallEnvironment>>) {
    assert.equal(
      resolveConvertPwaInstallState(installEnvironment(overrides)).mode,
      "hidden",
    );
  }
});

void test("persists Convert PWA install dismissal state", () => {
  const storage = memoryStorage();

  assert.equal(readConvertPwaInstallDismissed(storage), false);
  writeConvertPwaInstallDismissed(true, storage);
  assert.equal(readConvertPwaInstallDismissed(storage), true);
  writeConvertPwaInstallDismissed(false, storage);
  assert.equal(readConvertPwaInstallDismissed(storage), false);
});

void test("maps visible install states to bounded metric input", () => {
  assert.deepEqual(
    metricInputForConvertPwaInstallState({
      formFactor: "mobile",
      mode: "ios",
    }),
    { formFactor: "mobile", installMode: "ios" },
  );
  assert.equal(
    metricInputForConvertPwaInstallState({
      formFactor: "desktop",
      mode: "hidden",
    }),
    null,
  );
});

void test("defines the Convert PWA as a separate manifest identity", () => {
  const manifest = JSON.parse(
    readFileSync(
      new URL("../../../public/convert/manifest.webmanifest", import.meta.url),
      "utf8",
    ),
  ) as Record<string, unknown>;

  assert.equal(manifest.id, "/convert");
  assert.equal(manifest.name, "Cliparr Convert");
  assert.equal(manifest.start_url, "/convert/");
  assert.equal(manifest.scope, "/convert/");
});
