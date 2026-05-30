import { useCallback, useEffect, useState } from "react";
import type { PlaybackSubtitleTrack } from "../../providers/types";
import {
  subtitleTrackSupportsBurnIn,
  subtitleTrackUnavailableMessage,
} from "../../lib/selectPreferredSubtitleTrack";
import { parseSubtitleText } from "../../lib/subtitles/parseSubtitleText";
import type { SubtitleCue } from "../../lib/subtitles/types";

interface UseSubtitleCuesOptions {
  selectedSubtitleTrack: PlaybackSubtitleTrack | null;
  subtitleEnabled: boolean;
  providerId: string;
}

const subtitleRequestTimeoutMs = 15_000;

function responseErrorMessage(payload: unknown) {
  if (!payload || typeof payload !== "object" || !("error" in payload)) {
    return "";
  }

  const error = payload.error;
  if (
    !error ||
    typeof error !== "object" ||
    !("message" in error) ||
    typeof error.message !== "string"
  ) {
    return "";
  }

  return error.message.trim();
}

async function subtitleDownloadErrorDetail(response: Response) {
  try {
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.toLowerCase().includes("application/json")) {
      return responseErrorMessage(await response.json());
    }

    return (await response.text()).replace(/\s+/g, " ").trim();
  } catch {
    return "";
  }
}

async function downloadSubtitleCues(
  track: PlaybackSubtitleTrack,
  contentUrl: string,
  signal: AbortSignal,
) {
  const response = await fetch(contentUrl, { signal });
  if (!response.ok) {
    const detail = await subtitleDownloadErrorDetail(response);
    console.error("Subtitle download failed", {
      status: response.status,
      detail,
    });
    throw new Error(`Could not load subtitles (${response.status}).`);
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
      } catch (err) {
        if (cancelled || abortController.signal.aborted) {
          if (!cancelled) {
            setSubtitleCues([]);
            setSubtitleError("Subtitles timed out. Try again.");
            setSubtitleLoading(false);
          }
          return;
        }

        console.error("Could not load subtitle cues", err);
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
