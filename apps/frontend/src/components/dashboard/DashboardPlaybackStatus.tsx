import type { PlaybackSourceStatus } from "@cliparr/shared/providers";
import { RefreshCw } from "lucide-react";

import type { PlaybackConnectionState } from "@/api/cliparrClient";
import { buttonClassName } from "@/components/ui/control-styles";

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
  if (!connectionMessage && pending.length === 0 && !hasSourceErrors) {
    return null;
  }

  return (
    <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
      <div role="status" aria-live="polite" className="space-y-1">
        {connectionMessage ? (
          <p>{connectionMessage}</p>
        ) : (
          pending.map(({ id, message }) => <p key={id}>{message}</p>)
        )}
        {hasSourceErrors && <p>Some sources are unavailable</p>}
      </div>
      {(reconnecting || hasSourceErrors) && (
        <button
          type="button"
          onClick={onRetry}
          className={buttonClassName({ tone: "secondary", size: "compact" })}
        >
          <RefreshCw className="h-4 w-4" />
          Retry connection
        </button>
      )}
    </div>
  );
}
