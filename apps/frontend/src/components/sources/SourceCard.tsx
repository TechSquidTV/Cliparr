import type { MediaSource } from "@cliparr/shared/providers";
import {
  AlertTriangle,
  CheckCircle2,
  Globe,
  RefreshCw,
  Server,
  Trash2,
} from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import type { KeyboardEvent } from "react";

import { formatProviderName } from "#/components/providers/ProviderGlyph";
import {
  healthySurfaceClasses,
  SOURCE_STATE_EXIT,
  SOURCE_STATE_INITIAL,
  SOURCE_STATE_VISIBLE,
  sourceFieldLabelClasses,
  sourceSecondaryButtonClasses,
} from "#/components/sources/sourcesPresentation";
import {
  buttonClassName,
  textInputClassName,
  warningAlertClasses,
  warningSurfaceClasses,
} from "#/components/ui/control-styles";
import { Spinner } from "#/components/ui/spinner";
import { Switch } from "#/components/ui/switch";
import { ControlTooltip } from "#/components/ui/tooltip";
import { cn } from "#/lib/cn";
import { motionTransitionFor } from "#/lib/motion";

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function formatTimestamp(value: string | null) {
  if (!value) {
    return "Not checked yet";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function sourceStatus(source: MediaSource) {
  if (!source.enabled) {
    return {
      label: "Disabled",
      className: "border-border bg-muted text-muted-foreground",
      icon: Server,
    };
  }

  if (source.lastError) {
    return {
      label: "Needs attention",
      className: warningSurfaceClasses,
      icon: AlertTriangle,
    };
  }

  if (source.lastCheckedAt) {
    return {
      label: "Healthy",
      className: healthySurfaceClasses,
      icon: CheckCircle2,
    };
  }

  return {
    label: "Unchecked",
    className: "border-border bg-muted text-muted-foreground",
    icon: Globe,
  };
}

const statusBadgeClasses =
  "inline-flex h-6 items-center gap-1.5 rounded-md border px-2 text-ui-label font-medium normal-case tracking-normal";
const sourceMetaLabelClasses =
  "text-ui-micro font-normal normal-case tracking-normal text-muted-foreground";
const sourceDestructiveButtonClasses = buttonClassName({
  tone: "destructive",
  size: "compact",
  typography: "plain",
});
interface SourceCardProperties {
  source: MediaSource;
  draftName: string;
  draftBaseUrl: string;
  busyAction?: string;
  refreshingAll: boolean;
  onDraftNameChange: (value: string) => void;
  onDraftBaseUrlChange: (value: string) => void;
  onSave: () => Promise<void> | void;
  onToggleEnabled: () => Promise<void> | void;
  onRefresh: () => Promise<void> | void;
  onRemove: () => Promise<void> | void;
}

export function SourceCard({
  source,
  draftName,
  draftBaseUrl,
  busyAction,
  refreshingAll,
  onDraftNameChange,
  onDraftBaseUrlChange,
  onSave,
  onToggleEnabled,
  onRefresh,
  onRemove,
}: SourceCardProperties) {
  const status = sourceStatus(source);
  const StatusIcon = status.icon;
  const trimmedName = draftName.trim();
  const trimmedBaseUrl = draftBaseUrl.trim();
  const isBusy = Boolean(busyAction) || refreshingAll;
  const canSaveEdits =
    Boolean(trimmedName) &&
    Boolean(trimmedBaseUrl) &&
    !isBusy &&
    (trimmedName !== source.name || trimmedBaseUrl !== source.baseUrl);
  let saveDisabledReason: string | null = null;
  if (isBusy) {
    saveDisabledReason = "Wait for the current action to finish.";
  } else if (!trimmedName) {
    saveDisabledReason = "Enter a display name.";
  } else if (!trimmedBaseUrl) {
    saveDisabledReason = "Enter a server URL.";
  } else if (trimmedName === source.name && trimmedBaseUrl === source.baseUrl) {
    saveDisabledReason = "No changes to save.";
  }
  const busyDisabledReason = isBusy
    ? "Wait for the current action to finish."
    : null;
  const product = stringValue(source.metadata.product);
  const platform = stringValue(source.metadata.platform);
  const reduceMotion = useReducedMotion();
  const stateTransition = motionTransitionFor("fast", reduceMotion);

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter" || !canSaveEdits) {
      return;
    }

    event.preventDefault();
    void onSave();
  }

  return (
    <article
      className={cn(
        "rounded-lg border p-4 transition-colors",
        source.enabled
          ? "border-border bg-background"
          : "border-border bg-muted/40",
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <motion.span
            layout={!reduceMotion}
            className={cn(
              statusBadgeClasses,
              "border-border bg-card text-muted-foreground",
            )}
            transition={stateTransition}
          >
            {formatProviderName(source.providerId)}
          </motion.span>
          <motion.span
            layout={!reduceMotion}
            className={cn(
              statusBadgeClasses,
              "min-w-36 justify-center",
              status.className,
            )}
            transition={stateTransition}
          >
            <StatusIcon className="h-3.5 w-3.5" />
            {status.label}
          </motion.span>
          <AnimatePresence mode="popLayout" initial={false}>
            {busyAction && (
              <motion.span
                key="busy-action"
                layout={!reduceMotion}
                className={cn(
                  statusBadgeClasses,
                  "w-32 justify-center border-primary/30 bg-primary/10 text-primary",
                )}
                initial={reduceMotion ? { opacity: 1 } : SOURCE_STATE_INITIAL}
                animate={SOURCE_STATE_VISIBLE}
                exit={SOURCE_STATE_EXIT}
                transition={stateTransition}
              >
                <Spinner className="h-3.5 w-3.5" />
                {busyAction}
              </motion.span>
            )}
          </AnimatePresence>
        </div>
        <div className="text-right text-xs text-muted-foreground">
          <div>Checked {formatTimestamp(source.lastCheckedAt)}</div>
          <div>Updated {formatTimestamp(source.updatedAt)}</div>
        </div>
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        <label className={sourceFieldLabelClasses}>
          Display Name
          <input
            value={draftName}
            onChange={(event) => onDraftNameChange(event.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isBusy}
            className={cn(textInputClassName(), "mt-1.5")}
          />
        </label>

        <label className={sourceFieldLabelClasses}>
          Server URL
          <input
            value={draftBaseUrl}
            onChange={(event) => onDraftBaseUrlChange(event.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isBusy}
            className={cn(textInputClassName(), "mt-1.5")}
          />
        </label>
      </div>

      <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
        <div className="rounded-md border border-border bg-card px-3 py-2">
          <dt className={sourceMetaLabelClasses}>Saved URL</dt>
          <dd className="mt-1 break-all text-xs font-medium text-foreground">
            {source.baseUrl}
          </dd>
        </div>
        <div className="rounded-md border border-border bg-card px-3 py-2">
          <dt className={sourceMetaLabelClasses}>Details</dt>
          <dd className="mt-1 text-xs font-medium text-foreground">
            {[product, platform].filter(Boolean).join(" • ") ||
              "No extra metadata"}
          </dd>
        </div>
      </dl>

      <AnimatePresence initial={false}>
        {source.lastError && (
          <motion.div
            key="source-last-error"
            layout={!reduceMotion}
            className={cn("mt-3", warningAlertClasses)}
            initial={reduceMotion ? { opacity: 1 } : SOURCE_STATE_INITIAL}
            animate={SOURCE_STATE_VISIBLE}
            exit={SOURCE_STATE_EXIT}
            transition={stateTransition}
          >
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <div className="font-medium">Last check failed</div>
                <div className="mt-1">{source.lastError}</div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="mt-4 flex flex-wrap gap-2">
        <ControlTooltip
          disabled
          side="top"
          label={canSaveEdits ? null : saveDisabledReason}
        >
          <button
            type="button"
            onClick={() => void onSave()}
            disabled={!canSaveEdits}
            className={sourceSecondaryButtonClasses}
          >
            Save Changes
          </button>
        </ControlTooltip>
        <div
          className={cn(
            "inline-flex h-8 items-center gap-3 rounded-md border border-border bg-card px-3 text-xs font-medium normal-case tracking-normal text-foreground transition-opacity",
            isBusy && "opacity-60",
          )}
        >
          <span>{source.enabled ? "Enabled" : "Disabled"}</span>
          <ControlTooltip disabled side="top" label={busyDisabledReason}>
            <Switch
              aria-label={`${source.enabled ? "Disable" : "Enable"} ${
                source.name
              }`}
              checked={source.enabled}
              disabled={isBusy}
              onCheckedChange={() => void onToggleEnabled()}
            />
          </ControlTooltip>
        </div>
        <ControlTooltip disabled side="top" label={busyDisabledReason}>
          <button
            type="button"
            onClick={() => void onRefresh()}
            disabled={isBusy}
            className={sourceSecondaryButtonClasses}
          >
            {busyAction === "Refreshing..." ? (
              <Spinner />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            Refresh
          </button>
        </ControlTooltip>
        <ControlTooltip disabled side="top" label={busyDisabledReason}>
          <button
            type="button"
            onClick={() => void onRemove()}
            disabled={isBusy}
            className={sourceDestructiveButtonClasses}
          >
            <Trash2 className="h-4 w-4" />
            Remove
          </button>
        </ControlTooltip>
      </div>
    </article>
  );
}
