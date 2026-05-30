import { useCallback, useEffect, useState } from "react";
import {
  compactLogFields,
  logDurationFields,
  logErrorFields,
  logEventFields,
} from "@cliparr/shared/logging";
import type { PlaybackSubtitleTrack } from "../../providers/types";
import {
  subtitleTrackSupportsBurnIn,
  subtitleTrackUnavailableMessage,
} from "../../lib/selectPreferredSubtitleTrack";
import { parseSubtitleText } from "../../lib/subtitles/parseSubtitleText";
import type { SubtitleCue } from "../../lib/subtitles/types";
import { getFrontendLogger, warnWithError } from "../../logging";

interface UseSubtitleCuesOptions {
  selectedSubtitleTrack: PlaybackSubtitleTrack | null;
  subtitleEnabled: boolean;
  providerId: string;
}

const subtitleRequestTimeoutMs = 15_000;
const logger = getFrontendLogger(["editor", "subtitles"]);

class SubtitleDownloadError extends Error {
  status: number;

  constructor(status: number) {
    super(`Could not load subtitles (${status}).`);
    this.name = "SubtitleDownloadError";
    this.status = status;
  }
}

function subtitleTrackLogFields(
  track: PlaybackSubtitleTrack,
  providerId: string,
) {
  return compactLogFields({
    "provider.id": providerId,
    "subtitle.track.id": track.streamId,
    "subtitle.track.index": track.index,
    "subtitle.format": track.contentFormat,
    "subtitle.codec": track.codec,
    "subtitle.text": track.isText,
    "subtitle.external": track.isExternal,
  });
}

async function downloadSubtitleCues(
  track: PlaybackSubtitleTrack,
  contentUrl: string,
  signal: AbortSignal,
) {
  const response = await fetch(contentUrl, { signal });
  if (!response.ok) {
    throw new SubtitleDownloadError(response.status);
  }

  return parseSubtitleText(await response.text(), track.contentFormat);
}

export function useSubtitleCues({
  selectedSubtitleTrack,
  subtitleEnabled,
  providerId,
}: UseSubtitleCuesOptions) {
  const [subtitleCues, setSubtitleCues] = useState<SubtitleCue[]>([]);
  const [subtitleLoading, setSubtitleLoading] = useState(false);
  const [subtitleError, setSubtitleError] = useState<string | null>(null);

  const resetSubtitleCues = useCallback(() => {
    setSubtitleCues([]);
    setSubtitleLoading(false);
    setSubtitleError(null);
  }, []);

  const clearSubtitleError = useCallback(() => {
    setSubtitleError(null);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const abortController = new AbortController();
    const timeout = window.setTimeout(() => {
      abortController.abort();
    }, subtitleRequestTimeoutMs);

    async function loadSubtitleCues() {
      if (!subtitleEnabled || !selectedSubtitleTrack) {
        resetSubtitleCues();
        return;
      }

      const contentUrl = selectedSubtitleTrack.contentUrl;
      if (!subtitleTrackSupportsBurnIn(selectedSubtitleTrack) || !contentUrl) {
        setSubtitleLoading(false);
        setSubtitleCues([]);
        setSubtitleError(
          subtitleTrackUnavailableMessage(selectedSubtitleTrack, providerId) ??
            "This subtitle track is not supported.",
        );
        return;
      }

      setSubtitleCues([]);
      setSubtitleLoading(true);
      setSubtitleError(null);

      const startedAt = Date.now();
      try {
        const parsedSubtitleCues = await downloadSubtitleCues(
          selectedSubtitleTrack,
          contentUrl,
          abortController.signal,
        );

        if (cancelled) {
          return;
        }

        setSubtitleCues(parsedSubtitleCues);
        setSubtitleError(
          parsedSubtitleCues.length === 0
            ? "No subtitles found in this track."
            : null,
        );
        logger.info("Subtitle cues loaded.", {
          ...logEventFields("editor.subtitle.load", "success"),
          ...logDurationFields(startedAt),
          ...subtitleTrackLogFields(selectedSubtitleTrack, providerId),
          "subtitle.cue.count": parsedSubtitleCues.length,
        });
      } catch (err) {
        if (cancelled || abortController.signal.aborted) {
          if (!cancelled) {
            setSubtitleCues([]);
            setSubtitleError("Subtitles timed out. Try again.");
            setSubtitleLoading(false);
            logger.warn("Subtitle cue load timed out.", {
              ...logEventFields("editor.subtitle.load", "failure"),
              ...logDurationFields(startedAt),
              ...subtitleTrackLogFields(selectedSubtitleTrack, providerId),
              "subtitle.timeout": true,
              "subtitle.timeout.ms": subtitleRequestTimeoutMs,
            });
          }
          return;
        }

        warnWithError(logger, err, "Could not load subtitle cues.", {
          ...logEventFields("editor.subtitle.load", "failure"),
          ...logDurationFields(startedAt),
          ...logErrorFields(err),
          ...subtitleTrackLogFields(selectedSubtitleTrack, providerId),
          "subtitle.timeout": false,
          "http.status_code":
            err instanceof SubtitleDownloadError ? err.status : undefined,
        });
        setSubtitleCues([]);
        setSubtitleError(
          err instanceof Error ? err.message : "Could not load subtitles.",
        );
      } finally {
        if (!cancelled) {
          setSubtitleLoading(false);
        }
      }
    }

    void loadSubtitleCues();

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
      abortController.abort();
    };
  }, [providerId, resetSubtitleCues, selectedSubtitleTrack, subtitleEnabled]);

  return {
    subtitleCues,
    subtitleLoading,
    subtitleError,
    resetSubtitleCues,
    clearSubtitleError,
  };
}
