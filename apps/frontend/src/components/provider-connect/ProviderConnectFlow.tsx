import { AnimatePresence, motion } from "motion/react";
import { ArrowRight, Check, ExternalLink, Server } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utilities";
import {
  ProviderConnectError,
  ProviderStatusMessage,
  providerPresentation,
} from "@/components/provider-connect/ProviderConnectFlowSections";
import { ProviderGlyph } from "@/components/providers/ProviderGlyph";
import { useProviderConnectFlow } from "@/components/provider-connect/useProviderConnectFlow";
import {
  Tabs,
  TabsList,
  TabsPanel,
  TabsPanels,
  TabsTab,
} from "@/components/ui/tabs";
import {
  compactSecondaryButtonClasses,
  densePrimaryButtonClasses as panelPrimaryButtonClasses,
  denseSecondaryButtonClasses as panelSecondaryButtonClasses,
  screenTextInputClasses as baseScreenInputClasses,
  textInputClasses,
} from "@/components/ui/control-styles";
import type { ProviderDefinition, ProviderSession } from "@/providers/types";

interface Properties {
  onConnected: (session: ProviderSession) => Promise<void> | void;
  onCancel?: () => void;
  variant?: "panel" | "screen";
}

const importMetaEnvironment = import.meta.env as
  | { VITE_CLIPARR_DEV_JELLYFIN_URL?: unknown }
  | undefined;
const developmentJellyfinUrlValue =
  importMetaEnvironment?.VITE_CLIPARR_DEV_JELLYFIN_URL;
const developmentJellyfinUrl =
  typeof developmentJellyfinUrlValue === "string"
    ? developmentJellyfinUrlValue.trim()
    : "";

function isLoopbackUrl(value: string) {
  return /^https?:\/\/(?:localhost|127(?:\.\d{1,3}){3}|\[::1]|::1)(?:[/:]|$)/i.test(
    value.trim(),
  );
}

const panelInputClasses = cn(textInputClasses, "mt-1.5");
const screenInputClasses = cn(baseScreenInputClasses, "mt-2");

export default function ProviderConnectFlow({
  onConnected,
  onCancel,
  variant = "panel",
}: Properties) {
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

  function handleSelectProvider(nextProviderId: string) {
    if (!nextProviderId) {
      return;
    }

    setSelectedProviderId(nextProviderId);
    setError("");
  }

  function renderPinContent(provider: ProviderDefinition) {
    const providerDetails = providerPresentation(provider, variant);

    if (!isScreen) {
      return (
        <div className="space-y-3">
          <div className="rounded-md border border-border bg-card px-3 py-2.5 text-sm text-muted-foreground">
            A new tab will open for sign-in.
          </div>

          <div className="rounded-md border border-border bg-card px-3 py-2.5 text-sm text-muted-foreground">
            Connected servers stay in Sources.
          </div>

          <div className="flex flex-wrap gap-2 pt-1">
            <button
              type="button"
              onClick={() => void startAuth(provider)}
              disabled={authenticating}
              className={cn(panelPrimaryButtonClasses, "flex-1")}
            >
              <ExternalLink className="h-4 w-4" />
              {authenticating && providerId === provider.id
                ? `Waiting for ${provider.name}...`
                : providerDetails.action}
            </button>

            {onCancel && (
              <button
                type="button"
                onClick={onCancel}
                disabled={authenticating}
                className={panelSecondaryButtonClasses}
              >
                Cancel
              </button>
            )}
          </div>
        </div>
      );
    }

    return (
      <div className="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">
          A new tab will open for sign-in.
        </p>

        <div className="space-y-4">
          <button
            type="button"
            onClick={() => void startAuth(provider)}
            disabled={authenticating}
            className="flex w-full items-center justify-center gap-2 rounded-2xl bg-primary px-4 py-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <ExternalLink className="h-4 w-4" />
            {authenticating && providerId === provider.id
              ? `Waiting for ${provider.name}...`
              : providerDetails.action}
          </button>

          <p className="text-center text-xs leading-6 text-muted-foreground">
            Add more servers later from Sources.
          </p>
        </div>
      </div>
    );
  }

  function renderCredentialsContent(provider: ProviderDefinition) {
    const providerDetails = providerPresentation(provider, variant);
    const jellyfinLoopbackWarning =
      provider.id === "jellyfin" &&
      Boolean(developmentJellyfinUrl) &&
      isLoopbackUrl(serverUrl);
    const isUsingDevelopmentJellyfinUrl =
      provider.id === "jellyfin" &&
      Boolean(developmentJellyfinUrl) &&
      serverUrl.trim() === developmentJellyfinUrl;

    const formClasses = isScreen ? "flex flex-col gap-5" : "space-y-3";

    return (
      <form
        className={formClasses}
        onSubmit={(event) => {
          event.preventDefault();
          void loginWithCredentials(provider);
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
              placeholder={
                developmentJellyfinUrl || "https://media.example.com/jellyfin"
              }
              disabled={authenticating}
              className={isScreen ? screenInputClasses : panelInputClasses}
            />
          </label>

          {developmentJellyfinUrl && (
            <div
              className={cn(
                "border text-sm",
                isScreen ? "rounded-2xl px-4 py-3" : "rounded-md px-3 py-2",
                isUsingDevelopmentJellyfinUrl
                  ? "border-primary/25 bg-primary/10 text-foreground"
                  : "border-border bg-card text-muted-foreground",
              )}
            >
              <p className="leading-6">
                Docker Jellyfin URL:{" "}
                <span className="font-mono text-foreground">
                  {developmentJellyfinUrl}
                </span>
                .
              </p>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setServerUrl(developmentJellyfinUrl)}
                  disabled={authenticating || isUsingDevelopmentJellyfinUrl}
                  className={compactSecondaryButtonClasses}
                >
                  {isUsingDevelopmentJellyfinUrl ? (
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

                {isScreen && isUsingDevelopmentJellyfinUrl && (
                  <span className="text-xs text-muted-foreground">
                    Already selected.
                  </span>
                )}
              </div>
            </div>
          )}

          {jellyfinLoopbackWarning && (
            <div
              className={cn(
                "border border-primary/25 bg-primary/10 text-sm text-foreground",
                isScreen ? "rounded-2xl px-4 py-3" : "rounded-md px-3 py-2",
              )}
            >
              <p className="leading-6">
                Docker will use{" "}
                <span className="font-mono">{developmentJellyfinUrl}</span> for
                this localhost URL.
              </p>
            </div>
          )}

          <div className="grid gap-4 @sm:grid-cols-2">
            <label className="block text-xs font-medium uppercase tracking-[var(--tracking-caps-lg)] text-muted-foreground">
              Username
              <input
                type="text"
                autoComplete="username"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                placeholder="username"
                disabled={authenticating}
                className={isScreen ? screenInputClasses : panelInputClasses}
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
                className={isScreen ? screenInputClasses : panelInputClasses}
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
              {authenticating && providerId === provider.id
                ? `Connecting to ${provider.name}...`
                : providerDetails.action}
            </button>

            <p className="text-center text-xs leading-6 text-muted-foreground">
              Add more servers later from Sources.
            </p>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2 pt-1">
            <button
              type="submit"
              disabled={authenticating || !serverUrl.trim() || !username.trim()}
              className={cn(panelPrimaryButtonClasses, "flex-1")}
            >
              <Server className="h-4 w-4" />
              {authenticating && providerId === provider.id
                ? `Connecting to ${provider.name}...`
                : providerDetails.action}
            </button>

            {onCancel && (
              <button
                type="button"
                onClick={onCancel}
                disabled={authenticating}
                className={panelSecondaryButtonClasses}
              >
                Cancel
              </button>
            )}
          </div>
        )}
      </form>
    );
  }

  function renderAuthProgress(provider: ProviderDefinition) {
    if (!authenticating || !authId || providerId !== provider.id) {
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

  function renderSelectedProviderContent(provider: ProviderDefinition) {
    const providerDetails = providerPresentation(provider, variant);

    return (
      <>
        {isScreen ? (
          <p className="text-sm leading-6 text-muted-foreground">
            {providerDetails.summary}
          </p>
        ) : (
          <div className="flex items-start gap-4">
            <div className="rounded-md border border-border bg-card p-2">
              <ProviderGlyph
                providerId={provider.id}
                providerName={provider.name}
                className="h-6 w-6"
                fallbackClassName="text-primary"
              />
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-[var(--tracking-caps-xl)] text-muted-foreground">
                {providerDetails.eyebrow}
              </p>
              <h3
                className={cn(
                  "mt-1 font-semibold tracking-tight text-foreground",
                  isScreen ? "text-2xl" : "text-base",
                )}
              >
                {provider.name}
              </h3>
              <p
                className={cn(
                  "mt-2 text-sm text-muted-foreground",
                  isScreen ? "leading-6" : "leading-5",
                )}
              >
                {providerDetails.summary}
              </p>
            </div>
          </div>
        )}

        <div className="mt-4">
          {provider.auth === "pin"
            ? renderPinContent(provider)
            : renderCredentialsContent(provider)}
        </div>

        {renderAuthProgress(provider)}
      </>
    );
  }

  function renderContent() {
    if (loading) {
      if (isScreen) {
        return <ProviderConnectScreenLoadingLayout />;
      }

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

    return (
      <ProviderConnectTabsLayout
        isScreen={isScreen}
        authenticating={authenticating}
        providers={providers}
        selectedProviderId={selectedProvider?.id ?? providers[0]?.id ?? ""}
        onSelectProvider={handleSelectProvider}
        renderProviderContent={renderSelectedProviderContent}
      />
    );
  }

  if (!isScreen) {
    return (
      <div className="space-y-4">
        <ProviderConnectError error={error} isScreen={isScreen} />
        {renderContent()}
      </div>
    );
  }

  return (
    <>
      <ProviderConnectError error={error} isScreen={isScreen} />
      {renderContent()}
    </>
  );
}

interface ProviderConnectTabsLayoutProperties {
  isScreen: boolean;
  authenticating: boolean;
  providers: ProviderDefinition[];
  selectedProviderId: string;
  onSelectProvider: (providerId: string) => void;
  renderProviderContent: (provider: ProviderDefinition) => ReactNode;
}

function ProviderConnectTabsLayout({
  isScreen,
  authenticating,
  providers,
  selectedProviderId,
  onSelectProvider,
  renderProviderContent,
}: ProviderConnectTabsLayoutProperties) {
  return (
    <Tabs
      value={selectedProviderId}
      onValueChange={(nextProviderId) => {
        if (typeof nextProviderId !== "string") {
          return;
        }

        onSelectProvider(nextProviderId);
      }}
      className="space-y-3"
    >
      <TabsList
        springIndicator
        aria-label="Media provider"
        className="grid w-full"
        style={{
          gridTemplateColumns: `repeat(${providers.length}, minmax(0, 1fr))`,
        }}
      >
        {providers.map((provider) => (
          <TabsTab
            key={provider.id}
            value={provider.id}
            disabled={authenticating}
            className="min-h-11 min-w-0 px-2"
          >
            <ProviderGlyph
              providerId={provider.id}
              providerName={provider.name}
              className="h-4 w-4"
            />
            <span className="truncate">{provider.name}</span>
          </TabsTab>
        ))}
      </TabsList>

      <TabsPanels
        mode="static"
        className={cn(
          "@container",
          isScreen
            ? "pt-2 sm:rounded-lg sm:border sm:border-border sm:bg-background sm:p-4"
            : "h-source-provider-panel overflow-y-auto rounded-lg border border-border bg-background p-4",
        )}
      >
        {providers.map((provider) => (
          <TabsPanel
            animated={false}
            key={provider.id}
            value={provider.id}
            className={isScreen ? undefined : "h-full"}
          >
            {renderProviderContent(provider)}
          </TabsPanel>
        ))}
      </TabsPanels>
    </Tabs>
  );
}

function ProviderConnectScreenLoadingLayout() {
  return (
    <div
      className="space-y-3"
      aria-hidden="true"
      data-provider-connect-loading-layout
    >
      <div className="h-13 rounded-md border border-border bg-background" />
      <div
        className="space-y-4 pt-2 sm:rounded-lg sm:border sm:border-border sm:bg-background sm:p-4"
        data-provider-connect-selected-skeleton
      >
        <div className="h-5 w-3/4 rounded bg-card" />
        <div className="h-5 w-1/2 rounded bg-card" />
        <div className="h-12 rounded-xl bg-primary/10" />
      </div>
    </div>
  );
}
