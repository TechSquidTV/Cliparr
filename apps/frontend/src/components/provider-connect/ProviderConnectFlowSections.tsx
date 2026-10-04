import { EmptyState } from "@/components/ui/empty-state";
import { destructiveAlertClasses } from "@/components/ui/control-styles";
import { AnimatePresence, motion } from "motion/react";
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
      <div role="alert" className={destructiveAlertClasses}>
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
          role="alert"
          className={destructiveAlertClasses}
        >
          {error}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

export function ProviderStatusMessage({ children }: { children: string }) {
  return <EmptyState description={children} role="status" />;
}
