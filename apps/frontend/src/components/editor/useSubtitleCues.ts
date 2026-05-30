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
const logger = getFrontendLogger(["editor", "subtitle"]);

interface SubtitleDownloadFailure {
  status: number;
  message: string;
}

type SubtitleDownloadResult =
  | {
      ok: true;
      cues: SubtitleCue[];
    }
  | {
      ok: false;
      failure: SubtitleDownloadFailure;
    };

function subtitleDownloadFailure(status: number): SubtitleDownloadFailure {
  return {
    status,
    message: `Could not load subtitles (${status}).`,
  };
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
): Promise<SubtitleDownloadResult> {
  const response = await fetch(contentUrl, { signal });
  if (!response.ok) {
    return {
      ok: false,
      failure: subtitleDownloadFailure(response.status),
    };
  }

  return {
    ok: true,
    cues: parseSubtitleText(await response.text(), track.contentFormat),
  };
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
        const downloadResult = await downloadSubtitleCues(
          selectedSubtitleTrack,
          contentUrl,
          abortController.signal,
        );

        if (cancelled) {
          return;
        }

        if (!downloadResult.ok) {
          logger.warn("Could not load subtitle cues.", {
            ...logEventFields("editor.subtitle.load", "failure"),
            ...logDurationFields(startedAt),
            ...subtitleTrackLogFields(selectedSubtitleTrack, providerId),
            "subtitle.timeout": false,
            "http.status_code": downloadResult.failure.status,
            "error.name": "SubtitleDownloadFailure",
            "error.message": downloadResult.failure.message,
          });
          setSubtitleCues([]);
          setSubtitleError(downloadResult.failure.message);
          return;
        }

        const parsedSubtitleCues = downloadResult.cues;
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
