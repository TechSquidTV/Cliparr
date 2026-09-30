import assert from "node:assert/strict";
import test from "node:test";
import { isApiError } from "@/http/errors";
import type { ProviderResource } from "@/providers/types";
import {
  normalizeResources,
  requirePlexServerResources,
} from "@/providers/plex/shared";

void test("normalizes Plex server resources with JSON boolean flags", () => {
  const resources = normalizeResources([
    {
      name: "Owned Server",
      provides: "server",
      owned: true,
      accessToken: "server-token",
      clientIdentifier: "server-1",
      connections: [
        {
          uri: "http://192.168.1.10:32400",
          local: true,
          relay: false,
          protocol: "http",
          address: "192.168.1.10",
          port: 32_400,
        },
      ],
    },
    {
      name: "Shared Server",
      provides: "server",
      owned: false,
      accessToken: "shared-token",
      clientIdentifier: "server-2",
      connections: [
        {
          uri: "https://example.com:32400",
          local: false,
          relay: true,
          protocol: "https",
          address: "example.com",
          port: 32_400,
        },
      ],
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
      isApiError(error) &&
      error.status === 403 &&
      error.code === "plex_server_required" &&
      error.message ===
        "Cliparr needs a Plex account that owns at least one Plex Media Server",
  );
});

void test("keeps discovered Plex server resources when at least one exists", () => {
  const resources: ProviderResource[] = [
    {
      id: "plex-server-1",
      name: "Plex Media Server",
      accessToken: "token",
      connections: [
        {
          id: "connection-1",
          uri: "http://plex.local:32400",
          local: true,
          relay: false,
        },
      ],
    },
  ];

  assert.equal(requirePlexServerResources(resources), resources);
});
