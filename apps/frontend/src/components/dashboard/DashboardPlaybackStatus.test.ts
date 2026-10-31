import assert from "node:assert/strict";
import test from "node:test";

import type { PlaybackSourceStatus } from "@cliparr/shared/providers";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { DashboardPlaybackStatus } from "@/components/dashboard/DashboardPlaybackStatus";

function render(
  sources: PlaybackSourceStatus[],
  hasSourceErrors = false,
  connection: "live" | "reconnecting" = "live",
) {
  return renderToStaticMarkup(
    createElement(DashboardPlaybackStatus, {
      sources,
      hasSourceErrors,
      connection,
      onRetry() {},
    }),
  );
}

void test("shows each source's actual wait and removes ready sources from the status", () => {
  const states = ["connecting", "discovering", "preparing", "live"] as const;
  const sources = states.map((state) => ({
    sourceId: state,
    sourceName: state,
    providerId: "plex",
    state,
  }));
  const markup = render(sources);
  assert.match(markup, /Connecting to connecting…/);
  assert.match(markup, /Finding playback on discovering…/);
  assert.match(markup, /Preparing playback details from preparing…/);
  assert.doesNotMatch(markup, /from live|to live|on live|%|Retry connection/);
  assert.match(markup, /role="status" aria-live="polite"/);
  assert.equal(render([sources[3]]), "");
  assert.equal(render([]), "");
});

void test("keeps retry available during mixed source failures and browser reconnection", () => {
  const source: PlaybackSourceStatus = {
    sourceId: "source",
    sourceName: "Jellyfin",
    providerId: "jellyfin",
    state: "preparing",
  };
  const mixed = render([source], true);
  assert.match(mixed, /Preparing playback details from Jellyfin…/);
  assert.match(mixed, /Some sources are unavailable/);
  assert.match(mixed, /Retry connection/);
  const reconnecting = render([source], false, "reconnecting");
  assert.match(reconnecting, /Reconnecting to live sessions…/);
  assert.match(reconnecting, /Retry connection/);
  assert.doesNotMatch(reconnecting, /Preparing playback/);
});
