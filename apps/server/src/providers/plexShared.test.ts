import assert from "node:assert/strict";
import test from "node:test";
import { ApiError } from "../http/errors.js";
import { normalizeResources, requirePlexServerResources } from "./plex/shared.js";

void test("normalizes Plex server resources when Plex flags are strings", () => {
  const resources = normalizeResources([
    {
      name: "Owned Server",
      provides: "server",
      owned: "1",
      accessToken: "server-token",
      clientIdentifier: "server-1",
      connections: [{
        uri: "http://192.168.1.10:32400",
        local: "1",
        relay: "0",
        protocol: "http",
        address: "192.168.1.10",
        port: 32400,
      }],
    },
    {
      name: "Shared Server",
      provides: "server",
      owned: "0",
      accessToken: "shared-token",
      clientIdentifier: "server-2",
      connections: [{
        uri: "https://example.com:32400",
        local: "0",
        relay: "1",
        protocol: "https",
        address: "example.com",
        port: 32400,
      }],
    },
  ]);

  assert.equal(resources.length, 1);
  assert.equal(resources[0]?.id, "server-1");
  assert.equal(resources[0]?.owned, true);
  assert.equal(resources[0]?.connections.length, 1);
  assert.equal(resources[0]?.connections[0]?.local, true);
  assert.equal(resources[0]?.connections[0]?.relay, false);
});

void test("requires at least one discovered Plex server resource", () => {
  assert.throws(
    () => requirePlexServerResources([]),
    (error: unknown) =>
      error instanceof ApiError
      && error.status === 403
      && error.code === "plex_server_required"
      && error.message === "Cliparr needs a Plex account that owns at least one Plex Media Server"
  );
});
