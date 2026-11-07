import type { PlaybackSourceStatus } from "@cliparr/shared/providers";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  RefreshCw,
} from "lucide-react";

import type { PlaybackConnectionState } from "@/api/cliparrClient";
import { buttonClassName } from "@/components/ui/control-styles";
import { Spinner } from "#/components/ui/spinner";
import { cn } from "#/lib/cn";

function loadingMessage(source: PlaybackSourceStatus) {
  switch (source.state) {
    case "connecting": {
      return `Connecting to ${source.sourceName}…`;
    }
    case "discovering": {
      return `Finding playback on ${source.sourceName}…`;
    }
    case "preparing": {
      return `Preparing playback details from ${source.sourceName}…`;
    }
    case "error":
    case "live":
    case "reconnecting":
    case "unsupported": {
      return;
    }
  }
}

export function DashboardPlaybackStatus({
  sources,
  connection,
  hasSourceErrors,
  onRetry,
}: {
  sources: PlaybackSourceStatus[];
  connection: PlaybackConnectionState;
  hasSourceErrors: boolean;
  onRetry: () => void;
}) {
  const reconnecting = connection === "reconnecting";
  const pending = sources.flatMap((source) => {
    const message = loadingMessage(source);
    return message ? [{ id: source.sourceId, message }] : [];
  });
  let connectionMessage: string | null = null;
  if (reconnecting) {
    connectionMessage = "Reconnecting to live sessions…";
  } else if (connection === "connecting") {
    connectionMessage = "Connecting to Cliparr…";
  }
  const busy = connectionMessage !== null || pending.length > 0;
  let summary = "Live updates connected";
  if (connectionMessage) {
    summary = connectionMessage;
  } else if (pending.length > 0) {
    summary = `Loading playback from ${pending.length} ${pending.length === 1 ? "source" : "sources"}…`;
  } else if (hasSourceErrors) {
    summary = "Some sources are unavailable";
  }
  const StatusIcon = hasSourceErrors ? AlertTriangle : CheckCircle2;
  const canRetry = reconnecting || hasSourceErrors;

  return (
    <div
      className="flex h-8 min-w-0 items-center gap-3 text-sm text-muted-foreground"
      data-dashboard-playback-status
    >
      <details
        className="group relative min-w-0 flex-1"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.currentTarget.open = false;
            event.currentTarget.querySelector("summary")?.focus();
          }
        }}
      >
        <summary className="control-focus flex h-8 cursor-pointer list-none items-center gap-2 rounded-md [&::-webkit-details-marker]:hidden">
          {busy ? (
            <Spinner />
          ) : (
            <StatusIcon aria-hidden="true" className="h-4 w-4 shrink-0" />
          )}
          <span role="status" className="truncate">
            {summary}
          </span>
          <ChevronDown
            aria-hidden="true"
            className="h-3.5 w-3.5 shrink-0 transition-transform group-open:rotate-180 motion-reduce:transition-none"
          />
        </summary>
        <div className="absolute left-0 top-full z-20 mt-1 w-80 max-w-[calc(100vw-2rem)] max-h-60 space-y-1 overflow-y-auto break-words rounded-lg border border-border bg-card p-3 text-card-foreground shadow-lg">
          {connectionMessage ? (
            <p>{connectionMessage}</p>
          ) : (
            pending.map(({ id, message }) => <p key={id}>{message}</p>)
          )}
          {hasSourceErrors && <p>Some sources are unavailable</p>}
          {!busy && !hasSourceErrors && <p>Sessions update automatically.</p>}
        </div>
      </details>
      <button
        type="button"
        onClick={onRetry}
        tabIndex={canRetry ? undefined : -1}
        aria-hidden={!canRetry}
        className={cn(
          buttonClassName({ tone: "secondary", size: "compact" }),
          "shrink-0",
          !canRetry && "invisible",
        )}
      >
        <RefreshCw aria-hidden="true" className="h-4 w-4" />
        <span className="hidden sm:inline">Retry connection</span>
        <span className="sr-only sm:hidden">Retry connection</span>
      </button>
    </div>
  );
}
