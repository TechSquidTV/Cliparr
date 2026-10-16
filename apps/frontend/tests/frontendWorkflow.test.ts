import assert from "node:assert/strict";
import test from "node:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import DashboardScreen from "#/components/dashboard/DashboardScreen";
import { TooltipProvider } from "#/components/ui/tooltip";

void test("does not render dashboard PWA nudge in default server markup", () => {
  const markup = renderToStaticMarkup(
    createElement(
      TooltipProvider,
      null,
      createElement(DashboardScreen, {
        activeViewTransitionSessionId: null,
        onSelectSession: () => {},
        onOpenLocalVideo: () => {},
        onOpenSources: () => {},
        onDisconnect: () => {},
      }),
    ),
  );

  assert.doesNotMatch(markup, /Add Cliparr to your home screen/);
});
