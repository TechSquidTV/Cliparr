import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ConvertPwaInstallPromptView } from "@/components/convert/ConvertPwaInstallPrompt";

void test("renders mobile native Convert PWA install prompt", () => {
  const markup = renderToStaticMarkup(
    createElement(ConvertPwaInstallPromptView, {
      state: { formFactor: "mobile", mode: "native" },
      onDismiss: () => {},
      onInstall: () => {},
    }),
  );

  assert.match(markup, /Add Cliparr Convert to your home screen/);
  assert.match(markup, /data-convert-pwa-install-mode="native"/);
  assert.match(markup, />Install</);
});

void test("renders mobile iOS Convert PWA install guide", () => {
  const markup = renderToStaticMarkup(
    createElement(ConvertPwaInstallPromptView, {
      state: { formFactor: "mobile", mode: "ios" },
      onDismiss: () => {},
      onInstall: () => {},
    }),
  );

  assert.match(markup, /Share menu/);
  assert.match(markup, /Add to Home Screen/);
  assert.match(markup, /data-convert-pwa-install-mode="ios"/);
  assert.match(markup, />Share</);
});

void test("renders subtle desktop Convert PWA install button", () => {
  const markup = renderToStaticMarkup(
    createElement(ConvertPwaInstallPromptView, {
      state: { formFactor: "desktop", mode: "native" },
      onDismiss: () => {},
      onInstall: () => {},
    }),
  );

  assert.match(markup, /Install app/);
  assert.match(markup, /data-convert-pwa-form-factor="desktop"/);
  assert.doesNotMatch(markup, /Add Cliparr Convert to your home screen/);
});

void test("hides Convert PWA install prompt by default", () => {
  const markup = renderToStaticMarkup(
    createElement(ConvertPwaInstallPromptView, {
      state: { formFactor: "desktop", mode: "hidden" },
      onDismiss: () => {},
      onInstall: () => {},
    }),
  );

  assert.equal(markup, "");
});
