import type {
  CurrentlyPlayingResponse,
  MediaSource,
  MediaSourceCheckResult,
  ProviderAuthStart,
  ProviderAuthStatus,
  ProviderDefinition,
  ProviderSession,
} from "../providers/types";

interface ResponseErrorDetails {
  code?: string;
  message?: string;
}

class CliparrRequestError extends Error {
  status: number;
  code?: string;

  constructor(status: number, message: string, code?: string) {
    super(message);
    this.name = "CliparrRequestError";
    this.status = status;
    this.code = code;
  }
}

const authFailureListeners = new Set<() => void>();
let authFailureQueued = false;

function responseErrorDetails(payload: unknown): ResponseErrorDetails {
  if (!payload || typeof payload !== "object") {
    return {};
  }

  const error = "error" in payload ? payload.error : undefined;
  if (!error || typeof error !== "object") {
    return {};
  }

  return {
    code: "code" in error && typeof error.code === "string" ? error.code : undefined,
    message: "message" in error && typeof error.message === "string" ? error.message : undefined,
  };
}

function queueAuthFailureNotification() {
  if (authFailureQueued) {
    return;
  }

  authFailureQueued = true;
  queueMicrotask(() => {
    authFailureQueued = false;
    authFailureListeners.forEach((listener) => listener());
  });
}

function followAppAuthRedirect(response: Response) {
  if (typeof window === "undefined" || !response.redirected) {
    return false;
  }

  const redirectedUrl = new URL(response.url, window.location.origin);
  if (!redirectedUrl.pathname.startsWith("/api/auth/")) {
    return false;
  }

  const currentLocation = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  redirectedUrl.searchParams.set("redirectUrl", currentLocation);
  window.location.assign(redirectedUrl.toString());
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
    const data: unknown = contentType.includes("application/json")
      ? await response.json().catch((): unknown => null)
      : null;
    const error = responseErrorDetails(data);

    if (response.status === 401 && error.code === "not_authenticated") {
      queueAuthFailureNotification();
    }

    throw new CliparrRequestError(
      response.status,
      error.message ?? `${response.status} ${response.statusText}`,
      error.code,
    );
  }

  if (response.status === 204) {
    return undefined as T;
  }

  if (!contentType.includes("application/json")) {
    throw new Error(
      "Cliparr API returned HTML instead of JSON. Open the app through the Cliparr server or configure the Vite API proxy."
    );
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
  async listProviders() {
    const data = await request<{ providers: ProviderDefinition[] }>("/api/providers");
    return data.providers;
  },

  async startAuth(providerId: string) {
    return request<ProviderAuthStart>(`/api/providers/${providerId}/auth/start`, {
      method: "POST",
    });
  },

  async pollAuth(providerId: string, authId: string) {
    return request<ProviderAuthStatus>(`/api/providers/${providerId}/auth/${authId}`);
  },

  async loginWithCredentials(
    providerId: string,
    input: { serverUrl: string; username: string; password: string }
  ) {
    const data = await request<{ session: ProviderSession }>(`/api/providers/${providerId}/auth/login`, {
      method: "POST",
      body: JSON.stringify(input),
    });
    return data.session;
  },

  async getSession() {
    const data = await request<{ session: ProviderSession }>("/api/session");
    return data.session;
  },

  async logout() {
    await request<void>("/api/session", { method: "DELETE" });
  },

  async listSources() {
    const data = await request<{ sources: MediaSource[] }>("/api/sources");
    return data.sources;
  },

  async getSource(sourceId: string) {
    const data = await request<{ source: MediaSource }>(`/api/sources/${sourceId}`);
    return data.source;
  },

  async updateSource(sourceId: string, input: { baseUrl?: string; name?: string; enabled?: boolean }) {
    const data = await request<{ source: MediaSource }>(`/api/sources/${sourceId}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    });
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

  async getCurrentlyPlaying() {
    return request<CurrentlyPlayingResponse>("/api/media/currently-playing");
  },
};
