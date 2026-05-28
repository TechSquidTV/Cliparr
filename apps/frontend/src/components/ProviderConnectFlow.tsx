import { AnimatePresence, motion } from "motion/react";
import { ArrowRight, Check, ExternalLink, Server } from "lucide-react";
import { cn } from "../lib/utils";
import {
  ProviderBadge,
  ProviderConnectError,
  ProviderOption,
  ProviderStatusMessage,
  providerPresentation,
} from "./ProviderConnectFlowSections";
import { ProviderGlyph } from "./ProviderGlyph";
import { useProviderConnectFlow } from "./useProviderConnectFlow";
import type { ProviderSession } from "../providers/types";

interface Props {
  onConnected: (session: ProviderSession) => Promise<void> | void;
  onCancel?: () => void;
  variant?: "panel" | "screen";
}

const devJellyfinUrl = typeof import.meta.env.VITE_CLIPARR_DEV_JELLYFIN_URL === "string"
  ? import.meta.env.VITE_CLIPARR_DEV_JELLYFIN_URL.trim()
  : "";

function isLoopbackUrl(value: string) {
  return /^https?:\/\/(?:localhost|127(?:\.\d{1,3}){3}|\[::1\]|::1)(?:[:/]|$)/i.test(value.trim());
}

export default function ProviderConnectFlow({
  onConnected,
  onCancel,
  variant = "panel",
}: Props) {
  const isScreen = variant === "screen";
  const {
    providers,
    selectedProvider,
    authId,
    providerId,
    loading,
    authenticating,
    error,
    setError,
    serverUrl,
    setServerUrl,
    username,
    setUsername,
    password,
    setPassword,
    providerLabel,
    startAuth,
    loginWithCredentials,
    setSelectedProviderId,
  } = useProviderConnectFlow({
    onConnected,
  });
  const selectedProviderDetails = selectedProvider
    ? providerPresentation(selectedProvider, variant)
    : undefined;

  const jellyfinLoopbackWarning = selectedProvider?.id === "jellyfin"
    && Boolean(devJellyfinUrl)
    && isLoopbackUrl(serverUrl);
  const isUsingDevJellyfinUrl = selectedProvider?.id === "jellyfin"
    && Boolean(devJellyfinUrl)
    && serverUrl.trim() === devJellyfinUrl;

  function renderPinContent() {
    if (!selectedProvider) {
      return null;
    }

    if (!isScreen) {
      return (
        <div className="space-y-4">
          <div className="rounded-2xl border border-border bg-card px-4 py-4 text-sm text-muted-foreground">
            A new tab will open for sign-in.
          </div>

          <div className="rounded-2xl border border-border bg-card px-4 py-4 text-sm text-muted-foreground">
            Connected servers stay in Sources.
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
      );
    }

    return (
      <div className="flex h-full flex-col justify-between gap-6">
        <div className="space-y-4">
          <div className="rounded-2xl border border-border bg-card px-4 py-4 text-sm text-muted-foreground">
            A new tab will open for sign-in.
          </div>

          <div className="rounded-2xl border border-border bg-card px-4 py-4 text-sm text-muted-foreground">
            Add more sources later from Sources.
          </div>
        </div>

        <div className="space-y-4">
          <button
            type="button"
            onClick={() => void startAuth(selectedProvider)}
            disabled={authenticating}
            className="flex w-full items-center justify-center gap-2 rounded-2xl bg-primary px-4 py-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <ExternalLink className="h-4 w-4" />
            {authenticating && providerId === selectedProvider.id
              ? `Waiting for ${selectedProvider.name}...`
              : selectedProviderDetails?.action}
          </button>

          <p className="text-center text-xs leading-6 text-muted-foreground">
            You can switch providers any time.
          </p>
        </div>
      </div>
    );
  }

  function renderCredentialsContent() {
    if (!selectedProvider) {
      return null;
    }

    const formClasses = isScreen
      ? "flex h-full flex-col justify-between gap-6"
      : "space-y-4";

    return (
      <form
        className={formClasses}
        onSubmit={(event) => {
          event.preventDefault();
          void loginWithCredentials(selectedProvider);
        }}
      >
        <div className="space-y-4">
          <label className="block text-xs font-medium uppercase tracking-[var(--tracking-caps-lg)] text-muted-foreground">
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
              className={cn(
                "rounded-2xl border px-4 py-3 text-sm",
                isUsingDevJellyfinUrl
                  ? "border-primary/25 bg-primary/10 text-foreground"
                  : "border-border bg-card text-muted-foreground"
              )}
            >
              <p className="leading-6">
                Docker Jellyfin URL:{" "}
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

                {isScreen && isUsingDevJellyfinUrl && (
                  <span className="text-xs text-muted-foreground">
                    Already selected.
                  </span>
                )}
              </div>
            </div>
          )}

          {jellyfinLoopbackWarning && (
            <div className="rounded-2xl border border-primary/25 bg-primary/10 px-4 py-3 text-sm text-foreground">
              <p className="leading-6">
                Docker will use <span className="font-mono">{devJellyfinUrl}</span> for this localhost URL.
              </p>
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block text-xs font-medium uppercase tracking-[var(--tracking-caps-lg)] text-muted-foreground">
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

            <label className="block text-xs font-medium uppercase tracking-[var(--tracking-caps-lg)] text-muted-foreground">
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
            Your password is only used to request a Jellyfin token.
          </p>
        </div>

        {isScreen ? (
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
              Add more servers later from Sources.
            </p>
          </div>
        ) : (
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
        )}
      </form>
    );
  }

  function renderAuthProgress() {
    if (!selectedProvider || !authenticating || !authId || providerId !== selectedProvider.id) {
      return null;
    }

    const content = `Finish sign-in in the ${providerLabel(providerId)} tab.`;

    if (!isScreen) {
      return (
        <p className="mt-4 text-center text-xs leading-6 text-muted-foreground">
          {content}
        </p>
      );
    }

    return (
      <div className="mt-4 min-h-9">
        <AnimatePresence mode="wait">
          <motion.p
            key={`auth-${providerId}`}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 6 }}
            transition={{ duration: 0.16, ease: "easeOut" }}
            className="text-center text-xs text-muted-foreground"
          >
            {content}
          </motion.p>
        </AnimatePresence>
      </div>
    );
  }

  function renderSelectedProvider() {
    if (!selectedProvider) {
      return null;
    }

    const innerContent = (
      <>
        <div className="flex items-start gap-4">
          {isScreen ? (
            <ProviderBadge
              providerId={selectedProvider.id}
              name={selectedProvider.name}
              selected={true}
              large
            />
          ) : (
            <div className="rounded-2xl border border-border bg-card p-3">
              <ProviderGlyph
                providerId={selectedProvider.id}
                providerName={selectedProvider.name}
                className="h-6 w-6"
                fallbackClassName="text-primary"
              />
            </div>
          )}
          <div>
            <p className="text-xs font-medium uppercase tracking-[var(--tracking-caps-xl)] text-muted-foreground">
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

        <div className={cn("mt-6", isScreen && "flex-1")}>
          {selectedProvider.auth === "pin" ? renderPinContent() : renderCredentialsContent()}
        </div>

        {renderAuthProgress()}
      </>
    );

    if (!isScreen) {
      return (
        <div className="rounded-3xl border border-border bg-background/80 p-5 shadow-sm sm:p-6">
          {innerContent}
        </div>
      );
    }

    return (
      <div className="relative min-h-152 overflow-hidden rounded-3xl border border-border bg-background/80 shadow-xl">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={selectedProvider.id}
            initial={{ opacity: 0, x: 16, scale: 0.985 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: -16, scale: 0.985 }}
            transition={{ duration: 0.22, ease: "easeOut" }}
            className="absolute inset-0 flex flex-col overflow-y-auto overscroll-contain p-5 [scrollbar-gutter:stable] sm:p-6"
          >
            {innerContent}
          </motion.div>
        </AnimatePresence>
      </div>
    );
  }

  function renderContent() {
    if (loading) {
      return (
        <ProviderStatusMessage isScreen={isScreen}>
          Loading providers...
        </ProviderStatusMessage>
      );
    }

    if (!error && providers.length === 0) {
      return (
        <ProviderStatusMessage isScreen={isScreen}>
          No providers available.
        </ProviderStatusMessage>
      );
    }

    if (providers.length === 0) {
      return (
        <ProviderStatusMessage isScreen={isScreen}>
          Could not load providers.
        </ProviderStatusMessage>
      );
    }

    const providerList = (
      <>
        <p className="text-xs font-medium uppercase tracking-[var(--tracking-caps-3xl)] text-muted-foreground">
          Choose A Provider
        </p>

        {providers.map((provider) => (
          <ProviderOption
            key={provider.id}
            provider={provider}
            selectedProvider={selectedProvider}
            authenticating={authenticating}
            authenticatingProviderId={providerId}
            variant={variant}
            onSelect={(nextProviderId) => {
              setSelectedProviderId(nextProviderId);
              setError("");
            }}
          />
        ))}
      </>
    );

    return (
      <div className={cn(
        "grid",
        isScreen
          ? "gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.12fr)]"
          : "gap-4 xl:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)]"
      )}>
        {isScreen ? (
          <motion.div
            initial={{ opacity: 0, x: -12 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.24, ease: "easeOut" }}
            className="space-y-3"
          >
            {providerList}
          </motion.div>
        ) : (
          <div className="space-y-3">
            {providerList}
          </div>
        )}

        {renderSelectedProvider()}
      </div>
    );
  }

  if (!isScreen) {
    return (
      <div className="space-y-5">
        <ProviderConnectError error={error} isScreen={isScreen} />
        {renderContent()}
      </div>
    );
  }

  return (
    <>
      {error ? (
        <ProviderConnectError error={error} isScreen={isScreen} />
      ) : (
        <div className="mb-5 min-h-19" />
      )}
      {renderContent()}
    </>
  );
}
