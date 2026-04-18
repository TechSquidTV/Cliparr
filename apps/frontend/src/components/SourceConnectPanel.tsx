import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowRight, Check, ExternalLink, Server } from "lucide-react";
import { cliparrClient } from "../api/cliparrClient";
import { ProviderGlyph } from "./ProviderGlyph";
import type { ProviderDefinition, ProviderSession } from "../providers/types";

interface Props {
  onConnected: (session: ProviderSession) => Promise<void> | void;
  onCancel?: () => void;
}

const devJellyfinUrl = typeof import.meta.env.VITE_CLIPARR_DEV_JELLYFIN_URL === "string"
  ? import.meta.env.VITE_CLIPARR_DEV_JELLYFIN_URL.trim()
  : "";

function providerPresentation(provider: ProviderDefinition) {
  switch (provider.id) {
    case "plex":
      return {
        eyebrow: "Browser Sign-In",
        summary: "Authenticate with Plex in a separate tab, then Cliparr will discover and keep those servers available here.",
        action: "Continue with Plex",
      };
    case "jellyfin":
      return {
        eyebrow: "Direct Server Login",
        summary: "Connect directly to a Jellyfin server with its base URL and an administrator account.",
        action: "Connect Jellyfin",
      };
    default:
      return {
        eyebrow: "Provider Setup",
        summary: `Connect ${provider.name} to start pulling active sessions into Cliparr.`,
        action: `Continue with ${provider.name}`,
      };
  }
}

function isLoopbackUrl(value: string) {
  return /^https?:\/\/(?:localhost|127(?:\.\d{1,3}){3}|\[::1\]|::1)(?:[:/]|$)/i.test(value.trim());
}

function errorMessage(err: unknown, fallback: string) {
  return err instanceof Error && err.message ? err.message : fallback;
}

function ProviderBadge({
  providerId,
  name,
  selected,
}: {
  providerId: string;
  name: string;
  selected: boolean;
}) {
  return (
    <div className={`rounded-2xl p-3 transition-colors ${selected ? "bg-primary/15" : "bg-card"}`}>
      <ProviderGlyph
        providerId={providerId}
        providerName={name}
        className={`h-5 w-5 ${selected ? "" : "opacity-90"}`}
        fallbackClassName={selected ? "text-primary" : "text-muted-foreground"}
      />
    </div>
  );
}

export default function SourceConnectPanel({ onConnected, onCancel }: Props) {
  const [providers, setProviders] = useState<ProviderDefinition[]>([]);
  const [selectedProviderId, setSelectedProviderId] = useState("");
  const [authId, setAuthId] = useState("");
  const [providerId, setProviderId] = useState("");
  const [loading, setLoading] = useState(true);
  const [authenticating, setAuthenticating] = useState(false);
  const [error, setError] = useState("");
  const [serverUrl, setServerUrl] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function loadProviders() {
      try {
        const data = await cliparrClient.listProviders();
        if (!cancelled) {
          setProviders(data);
        }
      } catch (err: unknown) {
        if (!cancelled) {
          setError(errorMessage(err, "Failed to load providers"));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadProviders();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!selectedProviderId && providers[0]) {
      setSelectedProviderId(providers[0].id);
    }
  }, [providers, selectedProviderId]);

  const selectedProvider = useMemo(
    () => providers.find((provider) => provider.id === selectedProviderId) ?? providers[0],
    [providers, selectedProviderId]
  );
  const selectedProviderDetails = selectedProvider ? providerPresentation(selectedProvider) : undefined;

  const providerLabel = useCallback((id: string) => {
    return providers.find((provider) => provider.id === id)?.name ?? "provider";
  }, [providers]);

  const resetProviderState = useCallback(() => {
    setAuthenticating(false);
    setAuthId("");
    setProviderId("");
    setPassword("");
  }, []);

  useEffect(() => {
    if (!authId || !providerId) {
      return;
    }

    const intervalId = window.setInterval(async () => {
      try {
        const status = await cliparrClient.pollAuth(providerId, authId);
        if (status.status === "complete") {
          window.clearInterval(intervalId);
          const session = await cliparrClient.getSession();
          await onConnected(session);
          resetProviderState();
          return;
        }

        if (status.status === "expired") {
          window.clearInterval(intervalId);
          resetProviderState();
          setError(`That ${providerLabel(providerId)} sign-in expired. Start again when you're ready.`);
        }
      } catch (err: unknown) {
        window.clearInterval(intervalId);
        resetProviderState();
        setError(errorMessage(err, `Failed to finish ${providerLabel(providerId)} sign-in`));
      }
    }, 1500);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [authId, onConnected, providerId, providerLabel, resetProviderState]);

  const startAuth = async (provider: ProviderDefinition) => {
    setError("");
    setAuthId("");
    setProviderId(provider.id);
    setAuthenticating(true);

    try {
      const auth = await cliparrClient.startAuth(provider.id);
      setAuthId(auth.authId);
      window.open(auth.authUrl, "_blank", "noopener,noreferrer");
    } catch (err: unknown) {
      resetProviderState();
      setError(errorMessage(err, `Failed to start ${provider.name} sign-in`));
    }
  };

  const loginWithCredentials = async (provider: ProviderDefinition) => {
    setError("");
    setAuthId("");
    setProviderId(provider.id);
    setAuthenticating(true);

    try {
      const session = await cliparrClient.loginWithCredentials(provider.id, {
        serverUrl,
        username,
        password,
      });
      await onConnected(session);
      resetProviderState();
      setServerUrl("");
      setUsername("");
    } catch (err: unknown) {
      resetProviderState();
      setError(errorMessage(err, `Failed to connect ${provider.name}`));
    }
  };

  const jellyfinLoopbackWarning = selectedProvider?.id === "jellyfin"
    && Boolean(devJellyfinUrl)
    && isLoopbackUrl(serverUrl);
  const isUsingDevJellyfinUrl = selectedProvider?.id === "jellyfin"
    && Boolean(devJellyfinUrl)
    && serverUrl.trim() === devJellyfinUrl;

  return (
    <div className="space-y-5">
      {error && (
        <div className="rounded-2xl border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {loading ? (
        <div className="rounded-3xl border border-border bg-background/60 px-6 py-10 text-center text-sm text-muted-foreground">
          Loading providers...
        </div>
      ) : !error && providers.length === 0 ? (
        <div className="rounded-3xl border border-border bg-background/60 px-6 py-10 text-center text-sm text-muted-foreground">
          No providers are currently available.
        </div>
      ) : providers.length > 0 ? (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)]">
          <div className="space-y-3">
            <p className="text-xs font-medium uppercase tracking-[0.22em] text-muted-foreground">
              Choose A Provider
            </p>

            {providers.map((provider) => {
              const details = providerPresentation(provider);
              const isSelected = provider.id === selectedProvider?.id;
              const isBusy = authenticating && providerId === provider.id;

              return (
                <button
                  key={provider.id}
                  type="button"
                  onClick={() => {
                    setSelectedProviderId(provider.id);
                    setError("");
                  }}
                  disabled={authenticating && !isBusy}
                  className={`w-full rounded-2xl border px-4 py-4 text-left transition-colors ${
                    isSelected
                      ? "border-primary/30 bg-primary/10"
                      : "border-border bg-background hover:bg-accent/60"
                  } disabled:cursor-not-allowed disabled:opacity-60`}
                >
                  <div className="flex items-start gap-4">
                    <ProviderBadge
                      providerId={provider.id}
                      name={provider.name}
                      selected={isSelected}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
                            {details.eyebrow}
                          </p>
                          <h3 className="mt-1 text-lg font-semibold text-foreground">{provider.name}</h3>
                        </div>
                        {isSelected && (
                          <span className="rounded-full border border-primary/20 bg-primary/10 px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.16em] text-primary">
                            Selected
                          </span>
                        )}
                      </div>
                      <p className="mt-2 text-sm leading-6 text-muted-foreground">
                        {details.summary}
                      </p>
                      {isBusy && (
                        <p className="mt-3 text-xs font-medium uppercase tracking-[0.18em] text-primary">
                          In progress
                        </p>
                      )}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          {selectedProvider && (
            <div className="rounded-3xl border border-border bg-background/80 p-5 shadow-sm sm:p-6">
              <div className="flex items-start gap-4">
                <div className="rounded-2xl border border-border bg-card p-3">
                  <ProviderGlyph
                    providerId={selectedProvider.id}
                    providerName={selectedProvider.name}
                    className="h-6 w-6"
                    fallbackClassName="text-primary"
                  />
                </div>
                <div>
                  <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
                    {selectedProviderDetails?.eyebrow}
                  </p>
                  <h3 className="mt-1 text-2xl font-semibold tracking-tight text-foreground">
                    {selectedProvider.name}
                  </h3>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">
                    {selectedProviderDetails?.summary}
                  </p>
                </div>
              </div>

              <div className="mt-6">
                {selectedProvider.auth === "pin" ? (
                  <div className="space-y-4">
                    <div className="rounded-2xl border border-border bg-card px-4 py-4 text-sm text-muted-foreground">
                      Cliparr will open the provider sign-in page in a new tab and keep polling here until the auth completes.
                    </div>

                    <div className="rounded-2xl border border-border bg-card px-4 py-4 text-sm text-muted-foreground">
                      Connected providers stay available from this Sources screen, so you can keep adding servers over time.
                    </div>

                    <div className="flex flex-wrap gap-3 pt-1">
                      <button
                        type="button"
                        onClick={() => void startAuth(selectedProvider)}
                        disabled={authenticating}
                        className="inline-flex flex-1 items-center justify-center gap-2 rounded-2xl bg-primary px-4 py-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        <ExternalLink className="h-4 w-4" />
                        {authenticating && providerId === selectedProvider.id
                          ? `Waiting for ${selectedProvider.name}...`
                          : selectedProviderDetails?.action}
                      </button>

                      {onCancel && (
                        <button
                          type="button"
                          onClick={onCancel}
                          disabled={authenticating}
                          className="inline-flex items-center justify-center rounded-2xl border border-border bg-card px-4 py-3 text-sm font-medium text-foreground transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          Cancel
                        </button>
                      )}
                    </div>
                  </div>
                ) : (
                  <form
                    className="space-y-4"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void loginWithCredentials(selectedProvider);
                    }}
                  >
                    <label className="block text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
                      Server URL
                      <input
                        type="url"
                        autoComplete="url"
                        inputMode="url"
                        value={serverUrl}
                        onChange={(event) => setServerUrl(event.target.value)}
                        placeholder={devJellyfinUrl || "https://media.example.com/jellyfin"}
                        disabled={authenticating}
                        className="mt-2 h-11 w-full rounded-2xl border border-input bg-card px-4 text-sm text-foreground outline-none transition-colors focus:border-ring disabled:cursor-not-allowed disabled:opacity-60"
                      />
                    </label>

                    {devJellyfinUrl && (
                      <div
                        className={`rounded-2xl border px-4 py-3 text-sm ${
                          isUsingDevJellyfinUrl
                            ? "border-primary/25 bg-primary/10 text-foreground"
                            : "border-border bg-card text-muted-foreground"
                        }`}
                      >
                        <p className="leading-6">
                          Running the Docker dev setup? Cliparr can reach Jellyfin at{" "}
                          <span className="font-mono text-foreground">{devJellyfinUrl}</span>.
                        </p>

                        <div className="mt-3 flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            onClick={() => setServerUrl(devJellyfinUrl)}
                            disabled={authenticating || isUsingDevJellyfinUrl}
                            className="inline-flex items-center gap-2 rounded-xl border border-border bg-background px-3 py-2 text-xs font-medium text-foreground transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {isUsingDevJellyfinUrl ? (
                              <>
                                <Check className="h-3.5 w-3.5" />
                                Docker Jellyfin URL selected
                              </>
                            ) : (
                              <>
                                Use Docker Jellyfin URL
                                <ArrowRight className="h-3.5 w-3.5" />
                              </>
                            )}
                          </button>
                        </div>
                      </div>
                    )}

                    {jellyfinLoopbackWarning && (
                      <div className="rounded-2xl border border-primary/25 bg-primary/10 px-4 py-3 text-sm text-foreground">
                        In this Docker setup, <span className="font-mono">localhost</span> points at the Cliparr container. Cliparr will translate this to{" "}
                        <span className="font-mono">{devJellyfinUrl}</span> when it talks to Jellyfin.
                      </div>
                    )}

                    <div className="grid gap-4 sm:grid-cols-2">
                      <label className="block text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
                        Username
                        <input
                          type="text"
                          autoComplete="username"
                          value={username}
                          onChange={(event) => setUsername(event.target.value)}
                          placeholder="admin"
                          disabled={authenticating}
                          className="mt-2 h-11 w-full rounded-2xl border border-input bg-card px-4 text-sm text-foreground outline-none transition-colors focus:border-ring disabled:cursor-not-allowed disabled:opacity-60"
                        />
                      </label>

                      <label className="block text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
                        Password
                        <input
                          type="password"
                          autoComplete="current-password"
                          value={password}
                          onChange={(event) => setPassword(event.target.value)}
                          placeholder="Leave blank for passwordless users"
                          disabled={authenticating}
                          className="mt-2 h-11 w-full rounded-2xl border border-input bg-card px-4 text-sm text-foreground outline-none transition-colors focus:border-ring disabled:cursor-not-allowed disabled:opacity-60"
                        />
                      </label>
                    </div>

                    <p className="text-xs leading-6 text-muted-foreground">
                      Cliparr stores the access token Jellyfin returns after sign-in. Your password is only used for this connection step.
                    </p>

                    <div className="flex flex-wrap gap-3 pt-1">
                      <button
                        type="submit"
                        disabled={authenticating || !serverUrl.trim() || !username.trim()}
                        className="inline-flex flex-1 items-center justify-center gap-2 rounded-2xl bg-primary px-4 py-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        <Server className="h-4 w-4" />
                        {authenticating && providerId === selectedProvider.id
                          ? `Connecting to ${selectedProvider.name}...`
                          : selectedProviderDetails?.action}
                      </button>

                      {onCancel && (
                        <button
                          type="button"
                          onClick={onCancel}
                          disabled={authenticating}
                          className="inline-flex items-center justify-center rounded-2xl border border-border bg-card px-4 py-3 text-sm font-medium text-foreground transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          Cancel
                        </button>
                      )}
                    </div>
                  </form>
                )}
              </div>

              {authenticating && authId && providerId === selectedProvider.id && (
                <p className="mt-4 text-center text-xs leading-6 text-muted-foreground">
                  Finish sign-in in the {providerLabel(providerId)} tab. This screen will continue automatically.
                </p>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="rounded-3xl border border-border bg-background/60 px-6 py-10 text-center text-sm text-muted-foreground">
          We could not load providers yet.
        </div>
      )}
    </div>
  );
}
