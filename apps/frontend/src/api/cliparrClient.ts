import type {
  CurrentlyPlayingResponse,
  MediaSource,
  MediaSourceCheckResult,
  ProviderAuthStart,
  ProviderAuthStatus,
  ProviderDefinition,
  ProviderSession,
} from "@/providers/types";

interface ResponseErrorDetails {
  code?: string;
  message?: string;
}

interface HealthResponse {
  status: string;
  database: string;
  version?: string;
}

type VersionInfoStatus =
  | "current"
  | "update_available"
  | "unknown"
  | "unavailable";

export interface LatestReleaseInfo {
  tagName: string;
  url: string;
  publishedAt: string;
}

export interface CliparrVersionInfo {
  currentVersion?: string;
  latestRelease?: LatestReleaseInfo;
  updateAvailable: boolean;
  checkedAt?: string;
  status: VersionInfoStatus;
}

interface LocalMediaUrlResponse {
  mediaUrl: string;
  hls: boolean;
}

interface CliparrRequestError extends Error {
  status: number;
  code?: string;
}

function createCliparrRequestError(
  status: number,
  message: string,
  code?: string,
): CliparrRequestError {
  return Object.assign(new Error(message), {
    name: "CliparrRequestError",
    status,
    code,
  });
}

const authFailureListeners = new Set<() => void>();
let authFailureQueued = false;
let currentlyPlayingRequest: Promise<CurrentlyPlayingResponse> | null = null;

function responseErrorDetails(payload: unknown): ResponseErrorDetails {
  if (!payload || typeof payload !== "object") {
    return {};
  }

  const error = "error" in payload ? payload.error : undefined;
  if (!error || typeof error !== "object") {
    return {};
  }

  return {
    code:
      "code" in error && typeof error.code === "string"
        ? error.code
        : undefined,
    message:
      "message" in error && typeof error.message === "string"
        ? error.message
        : undefined,
  };
}

function queueAuthFailureNotification() {
  if (authFailureQueued) {
    return;
  }

  authFailureQueued = true;
  queueMicrotask(() => {
    authFailureQueued = false;
    for (const listener of authFailureListeners) {
      listener();
    }
  });
}

function buildUnexpectedApiResponseError() {
  return new Error(
    "Cliparr API returned the app page instead of JSON. Check the API URL.",
  );
}

function followAppAuthRedirect(response: Response) {
  const browserWindow = globalThis.window;
  if (browserWindow === undefined || !response.redirected) {
    return false;
  }

  const redirectedUrl = new URL(response.url, browserWindow.location.origin);
  if (!redirectedUrl.pathname.startsWith("/api/auth/")) {
    return false;
  }

  const currentLocation = `${browserWindow.location.pathname}${browserWindow.location.search}${browserWindow.location.hash}`;
  redirectedUrl.searchParams.set("redirectUrl", currentLocation);
  browserWindow.location.assign(redirectedUrl.toString());
  return true;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...init.headers,
    },
  });

  if (followAppAuthRedirect(response)) {
    return new Promise<T>(() => {});
  }

  const contentType = response.headers.get("content-type") ?? "";

  if (!response.ok) {
    if (!contentType.includes("application/json")) {
      throw buildUnexpectedApiResponseError();
    }

    const data: unknown = contentType.includes("application/json")
      ? await response.json().catch((): unknown => null)
      : null;
    const error = responseErrorDetails(data);

    if (response.status === 401 && error.code === "not_authenticated") {
      queueAuthFailureNotification();
    }

    throw createCliparrRequestError(
      response.status,
      error.message ?? `${response.status} ${response.statusText}`,
      error.code,
    );
  }

  if (response.status === 204) {
    return undefined as T;
  }

  if (!contentType.includes("application/json")) {
    throw buildUnexpectedApiResponseError();
  }

  const data: unknown = await response.json();
  return data as T;
}

export function subscribeToAuthFailure(listener: () => void) {
  authFailureListeners.add(listener);

  return () => {
    authFailureListeners.delete(listener);
  };
}

export const cliparrClient = {
  async getVersionInfo() {
    return request<CliparrVersionInfo>("/api/version");
  },

  async getHealth() {
    return request<HealthResponse>("/api/health");
  },

  async listProviders() {
    const data = await request<{ providers: ProviderDefinition[] }>(
      "/api/providers",
    );
    return data.providers;
  },

  async startAuth(providerId: string) {
    return request<ProviderAuthStart>(
      `/api/providers/${providerId}/auth/start`,
      {
        method: "POST",
      },
    );
  },

  async pollAuth(providerId: string, authId: string) {
    return request<ProviderAuthStatus>(
      `/api/providers/${providerId}/auth/${authId}`,
    );
  },

  async loginWithCredentials(
    providerId: string,
    input: { serverUrl: string; username: string; password: string },
  ) {
    const data = await request<{ session: ProviderSession }>(
      `/api/providers/${providerId}/auth/login`,
      {
        method: "POST",
        body: JSON.stringify(input),
      },
    );
    return data.session;
  },

  async getSession() {
    const data = await request<{ session: ProviderSession }>("/api/session");
    return data.session;
  },

  async disconnect() {
    await request<void>("/api/session", { method: "DELETE" });
  },

  async listSources() {
    const data = await request<{ sources: MediaSource[] }>("/api/sources");
    return data.sources;
  },

  async getSource(sourceId: string) {
    const data = await request<{ source: MediaSource }>(
      `/api/sources/${sourceId}`,
    );
    return data.source;
  },

  async updateSource(
    sourceId: string,
    input: { baseUrl?: string; name?: string; enabled?: boolean },
  ) {
    const data = await request<{ source: MediaSource }>(
      `/api/sources/${sourceId}`,
      {
        method: "PATCH",
        body: JSON.stringify(input),
      },
    );
    return data.source;
  },

  async deleteSource(sourceId: string) {
    await request<void>(`/api/sources/${sourceId}`, {
      method: "DELETE",
    });
  },

  async checkSource(sourceId: string) {
    return request<MediaSourceCheckResult>(`/api/sources/${sourceId}/check`, {
      method: "POST",
    });
  },

  getCurrentlyPlaying() {
    currentlyPlayingRequest ??= request<CurrentlyPlayingResponse>(
      "/api/media/currently-playing",
    ).finally(() => {
      currentlyPlayingRequest = null;
    });
    return currentlyPlayingRequest;
  },

  async createLocalMediaUrl(url: string) {
    return request<LocalMediaUrlResponse>("/api/media/local-url", {
      method: "POST",
      body: JSON.stringify({ url }),
    });
  },
};
