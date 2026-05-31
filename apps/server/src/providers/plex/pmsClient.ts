import { createApiError, isApiError, type ApiError } from "@/http/errors";
import { createClient } from "@/providers/plex/generated/client/client.gen";
import type { Client } from "@/providers/plex/generated/client/types.gen";
import {
  getIdentity,
  libraryMetadataGetSlash,
  statusGetSlash,
} from "@/providers/plex/generated/sdk.gen";
import { errorMessage } from "@/providers/shared/utils";

export interface PlexPmsRequestContext {
  baseUrl: string;
  token: string;
}

export interface PlexPmsRequestOptions {
  clientIdentifier: string;
  product: string;
  timeoutMs: number;
}

type PlexPmsSdkResult<T> =
  | {
      data: T;
      error: undefined;
      request?: Request;
      response?: Response;
    }
  | {
      data: undefined;
      error: unknown;
      request?: Request;
      response?: Response;
    };

interface PlexPmsResponseApiError extends ApiError {
  plexPmsStatusText: string;
}

function createPlexPmsSdkClient(
  context: PlexPmsRequestContext,
  options: PlexPmsRequestOptions,
  signal: AbortSignal,
): Client {
  return createClient({
    baseUrl: context.baseUrl,
    headers: {
      Accept: "application/json",
      "X-Plex-Client-Identifier": options.clientIdentifier,
      "X-Plex-Product": options.product,
      "X-Plex-Token": context.token,
    },
    parseAs: "json",
    signal,
  });
}

function responseStatusText(response: Response) {
  return response.statusText || "Unknown Status";
}

function sdkRequestError(error: unknown) {
  return error instanceof Error ? error : new Error(errorMessage(error));
}

function createPlexPmsResponseApiError(response: Response) {
  const statusText = responseStatusText(response);
  return Object.assign(
    createApiError(
      response.status,
      "plex_request_failed",
      `Plex request failed: ${response.status} ${statusText}`,
    ),
    {
      plexPmsStatusText: statusText,
    } satisfies Pick<PlexPmsResponseApiError, "plexPmsStatusText">,
  );
}

export function plexPmsResponseStatusMessage(error: unknown) {
  if (
    !isApiError(error) ||
    error.code !== "plex_request_failed" ||
    typeof (error as Partial<PlexPmsResponseApiError>).plexPmsStatusText !==
      "string"
  ) {
    return undefined;
  }

  return `${error.status} ${
    (error as PlexPmsResponseApiError).plexPmsStatusText
  }`;
}

function readPlexPmsResult<T>(result: PlexPmsSdkResult<T>) {
  if (result.data !== undefined) {
    return result.data;
  }

  if (result.response) {
    throw createPlexPmsResponseApiError(result.response);
  }

  throw sdkRequestError(result.error);
}

async function withPlexPmsClient<T>(
  context: PlexPmsRequestContext,
  options: PlexPmsRequestOptions,
  request: (client: Client) => Promise<PlexPmsSdkResult<T>>,
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs);

  try {
    return readPlexPmsResult(
      await request(
        createPlexPmsSdkClient(context, options, controller.signal),
      ),
    );
  } finally {
    clearTimeout(timeout);
  }
}

export function requestPlexPmsIdentity(
  context: PlexPmsRequestContext,
  options: PlexPmsRequestOptions,
) {
  return withPlexPmsClient(context, options, (client) =>
    getIdentity({ client }),
  );
}

export function requestPlexPmsCurrentSessions(
  context: PlexPmsRequestContext,
  options: PlexPmsRequestOptions,
) {
  return withPlexPmsClient(context, options, (client) =>
    statusGetSlash({ client }),
  );
}

export function requestPlexPmsMetadata(
  context: PlexPmsRequestContext,
  ids: string[],
  options: PlexPmsRequestOptions,
) {
  return withPlexPmsClient(context, options, (client) =>
    libraryMetadataGetSlash({
      client,
      path: {
        ids,
      },
    }),
  );
}
