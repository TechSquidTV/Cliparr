import type { GetResourcesData } from "@cliparr/plex/cloud/types";
import { createClient } from "@cliparr/plex/cloud/client";
import { createPin, getPin, getResources } from "@cliparr/plex/cloud";
import { createApiError } from "@/http/errors";
import { PLEX_CLIENT_IDENTIFIER, PLEX_PRODUCT } from "@/providers/plex/shared";

function cloudClient(userToken?: string) {
  return createClient({
    baseUrl: userToken ? "https://clients.plex.tv" : "https://plex.tv",
    headers: {
      Accept: "application/json",
      "X-Plex-Client-Identifier": PLEX_CLIENT_IDENTIFIER,
      "X-Plex-Product": PLEX_PRODUCT,
      ...(userToken ? { "X-Plex-Token": userToken } : {}),
    } satisfies NonNullable<GetResourcesData["headers"]>,
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
  });
}

function readCloudResult<T>(result: { data?: T; response?: Response }): T {
  if (result.data !== undefined) {
    return result.data;
  }
  throw createApiError(
    result.response && !result.response.ok ? result.response.status : 502,
    "plex_request_failed",
    "Plex cloud request failed",
  );
}

export async function requestPin() {
  return readCloudResult(
    await createPin({ client: cloudClient(), query: { strong: true } }),
  );
}
export async function requestPinStatus(id: number, code: string) {
  return readCloudResult(
    await getPin({ client: cloudClient(), path: { id }, query: { code } }),
  );
}
export async function requestResources(userToken: string) {
  return readCloudResult(
    await getResources({
      client: cloudClient(userToken),
      query: { includeHttps: 1, includeRelay: 1, includeIPv6: 1 },
    }),
  );
}
