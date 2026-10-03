import assert from "node:assert/strict";
import dns from "node:dns/promises";
import { syncBuiltinESMExports } from "node:module";
import { beforeEach, mock, type MockTracker } from "node:test";

// Reserved test domains and TEST-NET addresses; never a developer's server.
export const TEST_PLEX_BASE_URL = "http://plex.example.test:32400";
export const TEST_JELLYFIN_BASE_URL = "http://jellyfin.example.test:8096";
export const TEST_PUBLIC_ADDRESS = "192.0.2.10";

export function mockProviderDns(tracker: MockTracker = mock) {
  const lookup = tracker.method(dns, "lookup", async (hostname: string) => {
    assert.ok(
      hostname.endsWith(".example.test"),
      "Unexpected fixture DNS request",
    );
    return [{ address: TEST_PUBLIC_ADDRESS, family: 4 }];
  });
  syncBuiltinESMExports();
  return () => {
    lookup.mock.restore();
    syncBuiltinESMExports();
  };
}

export function useProviderFixtures() {
  beforeEach((context) => {
    assert.ok("mock" in context);
    context.after(mockProviderDns(context.mock));
    context.mock.method(globalThis, "fetch", () => {
      assert.fail("Unexpected fixture HTTP request; install a response mock");
    });
  });
}
