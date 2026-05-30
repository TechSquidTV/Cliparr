import { AnimatePresence, motion } from "motion/react";
import { cn } from "../lib/utils";
import type { ProviderDefinition } from "../providers/types";
import { ProviderGlyph } from "./ProviderGlyph";

export function providerPresentation(
  provider: ProviderDefinition,
  variant: "panel" | "screen",
) {
  switch (provider.id) {
    case "plex":
      return {
        eyebrow: "Browser Sign-In",
        summary:
          variant === "panel"
            ? "Sign in with Plex, then choose a server."
            : "Sign in with Plex to find your servers.",
        action: "Continue with Plex",
      };
    case "jellyfin":
      return {
        eyebrow: "Direct Server Login",
        summary: "Connect with your Jellyfin server URL and account.",
        action: "Connect Jellyfin",
      };
    default:
      return {
        eyebrow: "Provider Setup",
        summary: `Connect ${provider.name} to import active sessions.`,
        action: `Continue with ${provider.name}`,
      };
  }
}

export function ProviderBadge({
  providerId,
  name,
  selected,
  large = false,
  compact = false,
}: {
  providerId: string;
  name: string;
  selected: boolean;
  large?: boolean;
  compact?: boolean;
}) {
  return (
    <div
      className={cn(
        compact ? "rounded-md p-2" : "rounded-2xl p-3",
        "transition-colors",
        selected ? "bg-primary/15" : "bg-card",
      )}
    >
      <ProviderGlyph
        providerId={providerId}
        providerName={name}
        className={large ? "h-6 w-6" : "h-5 w-5"}
        fallbackClassName={selected ? "text-primary" : "text-muted-foreground"}
      />
    </div>
  );
}

export function ProviderConnectError({
  error,
  isScreen,
}: {
  error: string;
  isScreen: boolean;
}) {
  if (!error) {
    return null;
  }

  if (!isScreen) {
    return (
      <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
        {error}
      </div>
    );
  }

  return (
    <div className="mb-5 min-h-19">
      <AnimatePresence mode="wait">
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
      </AnimatePresence>
    </div>
  );
}

export function ProviderStatusMessage({
  children,
  isScreen,
}: {
  children: string;
  isScreen: boolean;
}) {
  return (
    <div
      className={cn(
        "text-center text-sm text-muted-foreground",
        isScreen
          ? "py-12"
          : "rounded-lg border border-border bg-background px-4 py-8",
      )}
    >
      {children}
    </div>
  );
}

export function ProviderOption({
  provider,
  selectedProvider,
  authenticating,
  authenticatingProviderId,
  variant,
  onSelect,
}: {
  provider: ProviderDefinition;
  selectedProvider?: ProviderDefinition;
  authenticating: boolean;
  authenticatingProviderId: string;
  variant: "panel" | "screen";
  onSelect: (providerId: string) => void;
}) {
  const isScreen = variant === "screen";
  const details = providerPresentation(provider, variant);
  const isSelected = provider.id === selectedProvider?.id;
  const isBusy = authenticating && authenticatingProviderId === provider.id;
  const commonProps = {
    type: "button" as const,
    onClick: () => onSelect(provider.id),
    disabled: authenticating && !isBusy,
    className: cn(
      "w-full border text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60",
      isScreen ? "rounded-2xl px-4 py-4" : "rounded-lg px-3 py-3",
      isSelected
        ? isScreen
          ? "border-primary/40 bg-primary/10 shadow-lg"
          : "border-primary/30 bg-primary/10"
        : "border-border bg-background hover:bg-accent/60",
    ),
  };

  const content = (
    <div className={cn("flex items-start", isScreen ? "gap-4" : "gap-3")}>
      <ProviderBadge
        providerId={provider.id}
        name={provider.name}
        selected={isSelected}
        compact={!isScreen}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-medium uppercase tracking-[var(--tracking-caps-xl)] text-muted-foreground">
              {details.eyebrow}
            </p>
            <h2
              className={cn(
                "mt-1 font-semibold text-foreground",
                isScreen ? "text-lg" : "text-sm",
              )}
            >
              {provider.name}
            </h2>
          </div>
          {isSelected &&
            (isScreen ? (
              <motion.span
                layout
                initial={{ opacity: 0, scale: 0.92 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.92 }}
                className="rounded-full border border-primary/30 bg-primary/10 px-2.5 py-1 text-ui-label font-medium uppercase tracking-[var(--tracking-caps-lg)] text-primary"
              >
                Selected
              </motion.span>
            ) : (
              <span className="rounded-md border border-primary/20 bg-primary/10 px-2 py-1 text-ui-micro font-semibold uppercase tracking-[var(--tracking-caps-md)] text-primary">
                Selected
              </span>
            ))}
        </div>
        <p
          className={cn(
            "mt-2 text-sm text-muted-foreground",
            isScreen ? "leading-6" : "leading-5",
          )}
        >
          {details.summary}
        </p>
        {isBusy && (
          <p className="mt-3 text-xs font-medium uppercase tracking-[var(--tracking-caps-xl)] text-primary">
            In progress
          </p>
        )}
      </div>
    </div>
  );

  if (!isScreen) {
    return <button {...commonProps}>{content}</button>;
  }

  return (
    <motion.button
      layout
      whileHover={authenticating && !isBusy ? undefined : { y: -2 }}
      whileTap={authenticating && !isBusy ? undefined : { scale: 0.995 }}
      transition={{ duration: 0.16, ease: "easeOut" }}
      {...commonProps}
    >
      {content}
    </motion.button>
  );
}
