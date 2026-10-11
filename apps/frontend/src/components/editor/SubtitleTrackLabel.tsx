import { subtitleTrackLabelParts } from "#/lib/subtitles/subtitleTrackLabels";
import type { PlaybackSubtitleTrack } from "#/providers/types";

export function SubtitleTrackLabel({
  track,
}: {
  track: PlaybackSubtitleTrack;
}) {
  const parts = subtitleTrackLabelParts(track);
  return (
    <div className="min-w-0 space-y-1.5">
      <div className="wrap-anywhere font-medium text-foreground">
        {parts.title ?? parts.language ?? "Unnamed subtitle track"}
      </div>
      {(parts.codec || (parts.title && parts.language)) && (
        <dl className="flex flex-wrap gap-x-3 gap-y-1 text-muted-foreground">
          {parts.title && parts.language && (
            <div className="flex gap-1">
              <dt>Language:</dt>
              <dd className="text-foreground">{parts.language}</dd>
            </div>
          )}
          {parts.codec && (
            <div className="flex gap-1">
              <dt>Format:</dt>
              <dd className="text-foreground">{parts.codec}</dd>
            </div>
          )}
        </dl>
      )}
      {parts.flags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {parts.flags.map((flag) => (
            <span
              key={flag}
              className="rounded border border-editor-border px-1.5 py-0.5 text-ui-micro text-foreground"
            >
              {flag}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
