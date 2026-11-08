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

void test("summarizes pending sources without counting ready sources", () => {
  const states = ["connecting", "discovering", "preparing", "live"] as const;
  const sources = states.map((state) => ({
    sourceId: state,
    sourceName: state,
    providerId: "plex",
    state,
  }));
  const markup = render(sources);
  assert.doesNotMatch(markup, /from live|to live|on live|%/);
  assert.match(markup, /role="status"/);
  assert.match(markup, /Loading playback from 3 sources…/);
  assert.match(render([sources[3]]), /Live updates connected/);
  assert.match(render([]), /data-dashboard-playback-status/);
});

void test("labels source failures and browser reconnection in the header indicator", () => {
  const source: PlaybackSourceStatus = {
    sourceId: "source",
    sourceName: "Jellyfin",
    providerId: "jellyfin",
    state: "preparing",
  };
  const mixed = render([source], true);
  assert.match(mixed, /Playback updates: Loading playback from 1 source…/);
  assert.match(mixed, /text-status-warning-foreground/);
  assert.match(
    render([], true),
    /Playback updates: Some sources are unavailable/,
  );
  const reconnecting = render([source], false, "reconnecting");
  assert.match(reconnecting, /Reconnecting to live sessions…/);
  assert.match(
    reconnecting,
    /Playback updates: Reconnecting to live sessions…/,
  );
  assert.doesNotMatch(reconnecting, /Preparing playback/);
});
