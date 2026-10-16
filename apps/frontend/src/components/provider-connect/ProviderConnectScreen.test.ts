import assert from "node:assert/strict";
import test from "node:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import ProviderConnectScreen from "#/components/provider-connect/ProviderConnectScreen";

void test("reserves provider connect layout before providers load", () => {
  const markup = renderToStaticMarkup(
    createElement(ProviderConnectScreen, {
      onConnected: () => {},
      onOpenLocalVideo: () => {},
    }),
  );

  assert.match(markup, /data-provider-connect-loading-layout/);
  assert.match(markup, /data-provider-connect-selected-skeleton/);
});
