import { Popover } from "@base-ui/react/popover";
import type { PlaybackSourceStatus } from "@cliparr/shared/providers";
import { AlertTriangle, CheckCircle2, RefreshCw } from "lucide-react";

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
      className="inline-flex h-8 w-8 shrink-0"
      data-dashboard-playback-status
    >
      <span role="status" className="sr-only">
        {summary}
      </span>
      <Popover.Root>
        <Popover.Trigger
          aria-label={`Playback updates: ${summary}`}
          title={summary}
          className={cn(
            "control-focus inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
            canRetry && "text-status-warning-foreground",
          )}
        >
          {busy ? (
            <Spinner />
          ) : (
            <StatusIcon aria-hidden="true" className="h-4 w-4 shrink-0" />
          )}
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Positioner
            sideOffset={8}
            align="start"
            collisionPadding={16}
            className="z-50"
          >
            <Popover.Popup className="w-80 max-w-[calc(100vw-2rem)] max-h-60 space-y-2 overflow-y-auto break-words rounded-lg border border-border bg-card p-3 text-sm text-card-foreground shadow-lg">
              <Popover.Title className="font-medium">{summary}</Popover.Title>
              <div className="space-y-1 text-muted-foreground">
                {!connectionMessage &&
                  pending.map(({ id, message }) => <p key={id}>{message}</p>)}
                {hasSourceErrors && busy && <p>Some sources are unavailable</p>}
                {!busy && !hasSourceErrors && (
                  <p>Sessions update automatically.</p>
                )}
              </div>
              {canRetry && (
                <button
                  type="button"
                  onClick={onRetry}
                  className={buttonClassName({
                    tone: "secondary",
                    size: "compact",
                  })}
                >
                  <RefreshCw aria-hidden="true" className="h-4 w-4" />
                  Retry connection
                </button>
              )}
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      </Popover.Root>
    </div>
  );
}
