import type { ProviderSession } from "@cliparr/shared/providers";
import { Server, X } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";

import SourceConnectPanel from "#/components/sources/SourceConnectPanel";
import {
  healthySurfaceClasses,
  SOURCE_STATE_EXIT,
  SOURCE_STATE_INITIAL,
  SOURCE_STATE_VISIBLE,
  sourceSecondaryButtonClasses,
} from "#/components/sources/sourcesPresentation";
import type { Feedback } from "#/components/sources/sourcesTypes";
import {
  destructiveAlertClasses,
  warningAlertClasses,
} from "#/components/ui/control-styles";
import { EmptyState } from "#/components/ui/empty-state";
import { cn } from "#/lib/cn";
import { motionTransitionFor } from "#/lib/motion";

interface SourcesDialogAlertsProperties {
  error: string;
  feedback: Feedback | null;
}

export function SourcesDialogAlerts({
  error,
  feedback,
}: SourcesDialogAlertsProperties) {
  const reduceMotion = useReducedMotion();
  const transition = motionTransitionFor("fast", reduceMotion);

  return (
    <AnimatePresence mode="popLayout" initial={false}>
      {error && (
        <motion.div
          key="sources-error"
          layout={!reduceMotion}
          className={destructiveAlertClasses}
          role="alert"
          data-sources-error-alert
          initial={reduceMotion ? { opacity: 1 } : SOURCE_STATE_INITIAL}
          animate={SOURCE_STATE_VISIBLE}
          exit={SOURCE_STATE_EXIT}
          transition={transition}
        >
          {error}
        </motion.div>
      )}

      {feedback && (
        <motion.div
          key={`sources-feedback-${feedback.tone}-${feedback.message}`}
          layout={!reduceMotion}
          className={cn(
            "rounded-md border px-3 py-2 text-sm",
            feedback.tone === "error" && destructiveAlertClasses,
            feedback.tone === "success" && healthySurfaceClasses,
            feedback.tone === "warning" && warningAlertClasses,
          )}
          data-sources-feedback-alert
          initial={reduceMotion ? { opacity: 1 } : SOURCE_STATE_INITIAL}
          animate={SOURCE_STATE_VISIBLE}
          exit={SOURCE_STATE_EXIT}
          transition={transition}
        >
          {feedback.message}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

interface SourcesConnectSectionProperties {
  forceAddSourceOpen: boolean;
  onClosePanel: () => void;
  onConnected: (session: ProviderSession) => Promise<void> | void;
}

export function SourcesConnectSection({
  forceAddSourceOpen,
  onClosePanel,
  onConnected,
}: SourcesConnectSectionProperties) {
  return (
    <section className="rounded-lg border border-border bg-card p-4 sm:p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div>
            <h3 className="text-sm font-semibold text-foreground">
              Connect another media server
            </h3>
            <p className="mt-1 max-w-2xl text-xs text-muted-foreground">
              Add or reconnect a media server.
            </p>
          </div>
        </div>

        {!forceAddSourceOpen && (
          <button
            type="button"
            onClick={onClosePanel}
            className={sourceSecondaryButtonClasses}
          >
            <X className="h-4 w-4" />
            Close
          </button>
        )}
      </div>

      <div className="mt-4">
        <SourceConnectPanel
          onConnected={onConnected}
          onCancel={forceAddSourceOpen ? undefined : onClosePanel}
        />
      </div>
    </section>
  );
}

interface SourcesEmptyStateProperties {
  title: string;
  description: string;
}

export function SourcesEmptyState({
  title,
  description,
}: SourcesEmptyStateProperties) {
  return (
    <EmptyState
      icon={<Server className="h-5 w-5" />}
      title={title}
      description={description}
    />
  );
}
