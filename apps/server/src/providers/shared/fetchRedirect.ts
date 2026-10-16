import { isRedirectStatus } from "@/providers/shared/networkPolicy";
import { fetchWithPinnedDns } from "@/providers/shared/pinnedFetch";

/*
Shared manual-redirect fetch machinery for provider HTTP clients. Redirects
are followed manually (never by the runtime) so every hop passes through the
provider's URL security policy and DNS-pinned fetch. The per-provider pieces,
request-URL assertion, sensitive-header list, and error shapes, stay with each
provider; only the loop mechanics are shared.
*/

async function reusableRequestBody(request: Request) {
  if (request.method === "GET" || request.method === "HEAD" || !request.body) {
    return;
  }

  const contentType = (request.headers.get("content-type") ?? "").toLowerCase();
  if (contentType.includes("json") || contentType.startsWith("text/")) {
    return request.clone().text();
  }

  return request.clone().arrayBuffer();
}

export async function closeRedirectResponse(response: globalThis.Response) {
  try {
    await response.body?.cancel();
  } catch {
    // Redirect response bodies are discarded before the next request.
  }
}

function parseRedirectUrl(
  location: string,
  requestUrl: URL,
  onInvalid: () => Error,
) {
  try {
    return new URL(location, requestUrl);
  } catch {
    throw onInvalid();
  }
}

function updateRedirectRequest(
  init: RequestInit,
  response: globalThis.Response,
  nextUrl: URL,
  currentUrl: URL,
  sensitiveHeaders: readonly string[],
) {
  const headers = new Headers(init.headers);
  const method = String(init.method ?? "GET").toUpperCase();
  const shouldSwitchToGet =
    (response.status === 303 && method !== "GET" && method !== "HEAD") ||
    ((response.status === 301 || response.status === 302) && method === "POST");

  if (nextUrl.origin !== currentUrl.origin) {
    for (const header of sensitiveHeaders) {
      headers.delete(header);
    }
  }

  if (!shouldSwitchToGet) {
    return {
      ...init,
      headers,
    };
  }

  headers.delete("content-length");
  headers.delete("content-type");

  return {
    ...init,
    method: "GET",
    headers,
    body: undefined,
  };
}

export interface RedirectFetchPolicy {
  maxRedirects: number;
  /*
  Headers stripped when a redirect crosses origins (authorization material
  must never leak to another origin).
  */
  sensitiveHeaders: readonly string[];
  /*
  Validates the next request URL and returns the DNS-pinned addresses to
  fetch it from. This is the provider's security policy and stays
  provider-specific.
  */
  assertRequestUrl(
    requestUrl: URL,
    trustedOrigin: string,
    signal: AbortSignal,
  ): Promise<string[]>;
  invalidRedirectError(): Error;
  redirectLimitError(): Error;
}

export async function fetchWithManualRedirects(
  input: Parameters<typeof fetch>[0],
  init: Parameters<typeof fetch>[1] | undefined,
  policy: RedirectFetchPolicy,
): Promise<globalThis.Response> {
  const request = new Request(input, init);
  const signal = init?.signal ?? request.signal;
  signal.throwIfAborted();
  const trustedOrigin = new URL(request.url).origin;
  let requestUrl = new URL(request.url);
  let requestInit: RequestInit = {
    method: request.method,
    headers: new Headers(request.headers),
    body: await reusableRequestBody(request),
    // Retain the caller signal: Request owns its forwarding AbortController.
    signal,
  };

  for (
    let redirectCount = 0;
    redirectCount <= policy.maxRedirects;
    redirectCount += 1
  ) {
    const addresses = await policy.assertRequestUrl(
      requestUrl,
      trustedOrigin,
      signal,
    );
    const response = await fetchWithPinnedDns(
      requestUrl,
      { ...requestInit, redirect: "manual" },
      addresses,
    );
    const location = response.headers.get("location");
    if (!isRedirectStatus(response.status) || !location) {
      return response;
    }

    try {
      const nextUrl = parseRedirectUrl(location, requestUrl, () =>
        policy.invalidRedirectError(),
      );
      requestInit = updateRedirectRequest(
        requestInit,
        response,
        nextUrl,
        requestUrl,
        policy.sensitiveHeaders,
      );
      requestUrl = nextUrl;
    } finally {
      await closeRedirectResponse(response);
    }
  }

  throw policy.redirectLimitError();
}
