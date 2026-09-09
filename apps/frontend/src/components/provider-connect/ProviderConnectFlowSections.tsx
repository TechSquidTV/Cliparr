import { AnimatePresence, motion } from "motion/react";
import { cn } from "@/lib/utilities";
import type { ProviderDefinition } from "@/providers/types";

export function providerPresentation(
  provider: ProviderDefinition,
  variant: "panel" | "screen",
) {
  switch (provider.id) {
    case "plex": {
      return {
        eyebrow: "Browser Sign-In",
        summary:
          variant === "panel"
            ? "Sign in with Plex, then choose a server."
            : "Sign in with Plex to find your servers.",
        action: "Continue with Plex",
      };
    }
    case "jellyfin": {
      return {
        eyebrow: "Direct Server Login",
        summary: "Connect with your Jellyfin server URL and account.",
        action: "Connect Jellyfin",
      };
    }
    default: {
      return {
        eyebrow: "Provider Setup",
        summary: `Connect ${provider.name} to import active sessions.`,
        action: `Continue with ${provider.name}`,
      };
    }
  }
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
    <div className="mb-4">
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
