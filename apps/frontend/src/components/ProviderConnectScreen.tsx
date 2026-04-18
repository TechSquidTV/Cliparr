import { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowRight, Check, ExternalLink, Server, Video } from "lucide-react";
import { cliparrClient } from "../api/cliparrClient";
import { ProviderGlyph } from "./ProviderGlyph";
import type { ProviderDefinition, ProviderSession } from "../providers/types";

interface Props {
  onConnected: (session: ProviderSession) => void;
}

const devJellyfinUrl = typeof import.meta.env.VITE_CLIPARR_DEV_JELLYFIN_URL === "string"
  ? import.meta.env.VITE_CLIPARR_DEV_JELLYFIN_URL.trim()
  : "";

function providerPresentation(provider: ProviderDefinition) {
  switch (provider.id) {
    case "plex":
      return {
        eyebrow: "Browser Sign-In",
        summary: "Authenticate with Plex in a separate tab, then Cliparr will discover the Plex servers tied to that account.",
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
  large = false,
}: {
  providerId: string;
  name: string;
  selected: boolean;
  large?: boolean;
}) {
  const sizeClass = large ? "h-6 w-6" : "h-5 w-5";
  const wrapperClass = large ? "rounded-2xl p-3" : "rounded-2xl p-3";
  const activeClass = selected ? "bg-primary/15" : "bg-card";

  return (
    <div className={`${wrapperClass} ${activeClass} transition-colors`}>
      <ProviderGlyph
        providerId={providerId}
        providerName={name}
        className={`${sizeClass} ${selected ? "" : "opacity-90"}`}
        fallbackClassName={selected ? "text-primary" : "text-muted-foreground"}
      />
    </div>
  );
}

export default function ProviderConnectScreen({ onConnected }: Props) {
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

  useEffect(() => {
    if (!authId || !providerId) {
      return;
    }

    const intervalId = window.setInterval(async () => {
      try {
        const status = await cliparrClient.pollAuth(providerId, authId);
        if (status.status === "complete") {
          window.clearInterval(intervalId);
          onConnected(await cliparrClient.getSession());
          return;
        }

        if (status.status === "expired") {
          window.clearInterval(intervalId);
          setAuthenticating(false);
          setAuthId("");
          setError(`That ${providerLabel(providerId)} sign-in expired. Start again when you're ready.`);
        }
      } catch (err: unknown) {
        window.clearInterval(intervalId);
        setAuthenticating(false);
        setError(errorMessage(err, `Failed to finish ${providerLabel(providerId)} sign-in`));
      }
    }, 1500);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [authId, onConnected, providerId, providerLabel]);

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
      setAuthenticating(false);
      setProviderId("");
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
      onConnected(session);
    } catch (err: unknown) {
      setAuthenticating(false);
      setProviderId("");
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
    <div className="flex min-h-screen items-start justify-center bg-background p-4 pt-6 text-foreground sm:items-center">
      <div className="relative w-full max-w-5xl overflow-hidden rounded-[2rem] border border-border bg-card text-card-foreground shadow-2xl">
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-primary/10 via-secondary/5 to-transparent" />
          <div className="absolute -left-10 top-24 h-40 w-40 rounded-full bg-secondary/10 blur-3xl" />
          <div className="absolute -right-10 top-16 h-44 w-44 rounded-full bg-primary/10 blur-3xl" />
        </div>

        <div className="relative border-b border-border px-6 py-8 sm:px-8">
          <div className="mb-5 flex items-center justify-center">
            <div className="rounded-full bg-primary/10 p-3">
              <Video className="h-8 w-8 text-primary" />
            </div>
          </div>
          <h1 className="text-center text-3xl font-semibold tracking-tight">Connect A Provider</h1>
          <p className="mx-auto mt-3 max-w-2xl text-center text-sm leading-6 text-muted-foreground">
            Select a provider. You will be able to add more providers later.
          </p>
        </div>

        <div className="relative px-6 py-6 sm:px-8">
          <div className="mb-5 min-h-[4.75rem]">
            <AnimatePresence mode="wait">
              {error && (
                <motion.div
                  key={error}
                  initial={{ opacity: 0, y: -8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.18, ease: "easeOut" }}
                  className="rounded-2xl border border-destructive/25 bg-destructive/10 px-4 py-3 text-sm text-destructive"
                >
                  {error}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {loading ? (
            <div className="py-12 text-center text-sm text-muted-foreground">Loading providers...</div>
          ) : !error && providers.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              No providers are currently available.
            </div>
          ) : providers.length > 0 ? (
            <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.12fr)]">
              <motion.div
                initial={{ opacity: 0, x: -12 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.24, ease: "easeOut" }}
                className="space-y-3"
              >
                <p className="text-xs font-medium uppercase tracking-[0.22em] text-muted-foreground">
                  Choose A Provider
                </p>
                {providers.map((provider) => {
                  const details = providerPresentation(provider);
                  const isSelected = provider.id === selectedProvider?.id;
                  const isBusy = authenticating && providerId === provider.id;

                  return (
                    <motion.button
                      key={provider.id}
                      layout
                      type="button"
                      onClick={() => {
                        setSelectedProviderId(provider.id);
                        setError("");
                      }}
                      disabled={authenticating && !isBusy}
                      className={`w-full rounded-2xl border px-4 py-4 text-left transition-colors ${
                        isSelected
                          ? "border-primary/40 bg-primary/10 shadow-lg"
                          : "border-border bg-background hover:bg-accent/60"
                      } disabled:cursor-not-allowed disabled:opacity-60`}
                      whileHover={authenticating && !isBusy ? undefined : { y: -2 }}
                      whileTap={authenticating && !isBusy ? undefined : { scale: 0.995 }}
                      transition={{ duration: 0.16, ease: "easeOut" }}
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
                              <h2 className="mt-1 text-lg font-semibold">{provider.name}</h2>
                            </div>
                            {isSelected && (
                              <motion.span
                                layout
                                initial={{ opacity: 0, scale: 0.92 }}
                                animate={{ opacity: 1, scale: 1 }}
                                exit={{ opacity: 0, scale: 0.92 }}
                                className="rounded-full border border-primary/30 bg-primary/10 px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.16em] text-primary"
                              >
                                Selected
                              </motion.span>
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
                    </motion.button>
                  );
                })}
              </motion.div>

              {selectedProvider && (
                <div className="relative min-h-[38rem] overflow-hidden rounded-3xl border border-border bg-background/80 shadow-xl">
                  <AnimatePresence mode="wait" initial={false}>
                    <motion.div
                      key={selectedProvider.id}
                      initial={{ opacity: 0, x: 16, scale: 0.985 }}
                      animate={{ opacity: 1, x: 0, scale: 1 }}
                      exit={{ opacity: 0, x: -16, scale: 0.985 }}
                      transition={{ duration: 0.22, ease: "easeOut" }}
                      className="absolute inset-0 flex flex-col overflow-y-auto overscroll-contain p-5 [scrollbar-gutter:stable] sm:p-6"
                    >
                      <div className="flex items-start gap-4">
                        <ProviderBadge
                          providerId={selectedProvider.id}
                          name={selectedProvider.name}
                          selected={true}
                          large
                        />
                        <div>
                          <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
                            {selectedProviderDetails?.eyebrow}
                          </p>
                          <h2 className="mt-1 text-2xl font-semibold tracking-tight">
                            {selectedProvider.name}
                          </h2>
                          <p className="mt-2 text-sm leading-6 text-muted-foreground">
                            {selectedProviderDetails?.summary}
                          </p>
                        </div>
                      </div>

                      <div className="mt-6 flex-1">
                        {selectedProvider.auth === "pin" ? (
                          <div className="flex h-full flex-col justify-between gap-6">
                            <div className="space-y-4">
                              <div className="rounded-2xl border border-border bg-card px-4 py-4 text-sm text-muted-foreground">
                                Cliparr will open the provider sign-in page in a new tab and keep polling here until the auth completes.
                              </div>

                              <div className="rounded-2xl border border-border bg-card px-4 py-4 text-sm text-muted-foreground">
                                Once this account is connected, Cliparr can discover Plex servers now and you can add more sources later from the Sources screen.
                              </div>
                            </div>

                            <div className="space-y-4">
                              <button
                                type="button"
                                onClick={() => startAuth(selectedProvider)}
                                disabled={authenticating}
                                className="flex w-full items-center justify-center gap-2 rounded-2xl bg-primary px-4 py-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                {authenticating && providerId === selectedProvider.id ? (
                                  <>
                                    <ExternalLink className="h-4 w-4" />
                                    Waiting for {selectedProvider.name}...
                                  </>
                                ) : (
                                  <>
                                    <ExternalLink className="h-4 w-4" />
                                    {selectedProviderDetails?.action}
                                  </>
                                )}
                              </button>

                              <p className="text-center text-xs leading-6 text-muted-foreground">
                                The provider picker stays here, so you can switch to another source option without the whole window jumping around.
                              </p>
                            </div>
                          </div>
                        ) : (
                          <form
                            className="flex h-full flex-col justify-between gap-6"
                            onSubmit={(event) => {
                              event.preventDefault();
                              void loginWithCredentials(selectedProvider);
                            }}
                          >
                            <div className="space-y-4">
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
                                  className="mt-2 h-11 w-full rounded-2xl border border-input bg-card px-4 text-sm outline-none transition-colors focus:border-ring disabled:cursor-not-allowed disabled:opacity-60"
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
                                    <span className="font-mono text-foreground">{devJellyfinUrl}</span>
                                    {isUsingDevJellyfinUrl ? "." : "."}
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

                                    {isUsingDevJellyfinUrl && (
                                      <span className="text-xs text-muted-foreground">
                                        The input above is already set to the Docker service URL.
                                      </span>
                                    )}
                                  </div>
                                </div>
                              )}

                              {jellyfinLoopbackWarning && (
                                <div className="rounded-2xl border border-primary/25 bg-primary/10 px-4 py-3 text-sm text-foreground">
                                  <p className="leading-6">
                                    In this Docker setup, <span className="font-mono">localhost</span> points at the Cliparr container. Cliparr will translate this to{" "}
                                    <span className="font-mono">{devJellyfinUrl}</span> when it talks to Jellyfin.
                                  </p>
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
                                    className="mt-2 h-11 w-full rounded-2xl border border-input bg-card px-4 text-sm outline-none transition-colors focus:border-ring disabled:cursor-not-allowed disabled:opacity-60"
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
                                    className="mt-2 h-11 w-full rounded-2xl border border-input bg-card px-4 text-sm outline-none transition-colors focus:border-ring disabled:cursor-not-allowed disabled:opacity-60"
                                  />
                                </label>
                              </div>

                              <p className="text-xs leading-6 text-muted-foreground">
                                Cliparr stores the access token Jellyfin returns after sign-in. Your password is only used for this connection step.
                              </p>
                            </div>

                            <div className="space-y-4">
                              <button
                                type="submit"
                                disabled={authenticating || !serverUrl.trim() || !username.trim()}
                                className="flex w-full items-center justify-center gap-2 rounded-2xl bg-primary px-4 py-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                <Server className="h-4 w-4" />
                                {authenticating && providerId === selectedProvider.id
                                  ? `Connecting to ${selectedProvider.name}...`
                                  : selectedProviderDetails?.action}
                              </button>

                              <p className="text-center text-xs leading-6 text-muted-foreground">
                                Connect one server now, then add more Plex or Jellyfin sources later from the Sources screen.
                              </p>
                            </div>
                          </form>
                        )}
                      </div>

                      <div className="mt-4 min-h-[2.25rem]">
                        <AnimatePresence mode="wait">
                          {authenticating && authId && providerId === selectedProvider.id && (
                            <motion.p
                              key={`auth-${providerId}`}
                              initial={{ opacity: 0, y: 6 }}
                              animate={{ opacity: 1, y: 0 }}
                              exit={{ opacity: 0, y: 6 }}
                              transition={{ duration: 0.16, ease: "easeOut" }}
                              className="text-center text-xs text-muted-foreground"
                            >
                              Finish sign-in in the {providerLabel(providerId)} tab. This screen will continue automatically.
                            </motion.p>
                          )}
                        </AnimatePresence>
                      </div>
                    </motion.div>
                  </AnimatePresence>
                </div>
              )}
            </div>
          ) : (
            <div className="py-12 text-center text-sm text-muted-foreground">
              We could not load providers yet.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
