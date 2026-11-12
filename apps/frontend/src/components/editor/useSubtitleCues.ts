import {
  compactLogFields,
  logDurationFields,
  logErrorFields,
  logEventFields,
  warnWithError,
} from "@cliparr/shared/logging";
import {
  type PlaybackSubtitleTrack,
  SUBTITLE_IMPORT_TIMEOUT_MS,
  subtitleTrackSupportsBurnIn,
} from "@cliparr/shared/providers";
import { useCallback, useEffect, useState } from "react";

import { readResponseErrorDetails } from "@/api/responseError";
import { parseSubtitleTextAsync } from "@/lib/subtitles/parseSubtitleTextAsync";
import { subtitleTrackUnavailableMessage } from "@/lib/subtitles/selectPreferredSubtitleTrack";
import type { SubtitleCue } from "@/lib/subtitles/types";
import { getFrontendLogger } from "@/logging";

export type SubtitleImportSource = File | PlaybackSubtitleTrack;

interface UseSubtitleCuesOptions {
  source: SubtitleImportSource | null;
  providerId: string;
}

const logger = getFrontendLogger(["editor", "subtitle"]);

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

async function readSubtitleSource(
  source: SubtitleImportSource,
  providerId: string,
  signal: AbortSignal,
): Promise<
  | { ok: true; text: string; format?: string }
  | { ok: false; status: number; message: string }
> {
  if (source instanceof File) {
    const format = source.name.split(".").at(-1)?.toLowerCase();
    if (format !== "srt" && format !== "vtt") {
      throw new Error("Choose an SRT or WebVTT subtitle file.");
    }
    return { ok: true, text: await source.text(), format };
  }

  if (!source.contentUrl || !subtitleTrackSupportsBurnIn(source)) {
    throw new Error(
      subtitleTrackUnavailableMessage(source, providerId) ??
        "This subtitle track is not supported.",
    );
  }
  const response = await fetch(source.contentUrl, { signal });
  if (!response.ok) {
    const error = await readResponseErrorDetails(response);
    return {
      ok: false,
      status: response.status,
      message:
        error.message ?? `Could not load subtitles (${response.status}).`,
    };
  }
  return {
    ok: true,
    text: await response.text(),
    format: source.contentFormat,
  };
}

export function useSubtitleCues({
  source,
  providerId,
}: UseSubtitleCuesOptions) {
  const [subtitleCues, setSubtitleCues] = useState<SubtitleCue[]>([]);
  const [subtitleError, setSubtitleError] = useState<string | null>(null);
  const [loadedSource, setLoadedSource] = useState<SubtitleImportSource | null>(
    null,
  );

  const resetSubtitleCues = useCallback(() => {
    setSubtitleCues([]);
    setSubtitleError(null);
    setLoadedSource(null);
  }, []);

  useEffect(() => {
    if (!source) {
      resetSubtitleCues();
      return;
    }
    let cancelled = false;
    const abortController = new AbortController();
    const timeout = globalThis.setTimeout(() => {
      abortController.abort();
    }, SUBTITLE_IMPORT_TIMEOUT_MS);

    async function loadSubtitleCues(input: SubtitleImportSource) {
      const startedAt = Date.now();
      const fields =
        input instanceof File
          ? { "subtitle.external": true }
          : subtitleTrackLogFields(input, providerId);
      setSubtitleCues([]);
      setLoadedSource(null);
      setSubtitleError(null);
      try {
        const result = await readSubtitleSource(
          input,
          providerId,
          abortController.signal,
        );
        if (cancelled) {
          return;
        }

        if (!result.ok) {
          logger.warn("Could not load subtitle cues.", {
            ...logEventFields("editor.subtitle.load", "failure"),
            ...logDurationFields(startedAt),
            ...fields,
            "subtitle.timeout": false,
            "http.status_code": result.status,
            "error.name": "SubtitleDownloadFailure",
            "error.message": result.message,
          });
          setSubtitleCues([]);
          setSubtitleError(result.message);
          return;
        }

        const parsedSubtitleCues = await parseSubtitleTextAsync(
          result.text,
          result.format,
          abortController.signal,
        );
        if (cancelled) {
          return;
        }
        setSubtitleCues(parsedSubtitleCues);
        setLoadedSource(input);
        setSubtitleError(
          parsedSubtitleCues.length === 0
            ? "No subtitles found in this track."
            : null,
        );
        logger.info("Subtitle cues loaded.", {
          ...logEventFields("editor.subtitle.load", "success"),
          ...logDurationFields(startedAt),
          ...fields,
          "subtitle.cue.count": parsedSubtitleCues.length,
        });
      } catch (error) {
        if (cancelled || abortController.signal.aborted) {
          if (!cancelled) {
            setSubtitleCues([]);
            setLoadedSource(null);
            setSubtitleError("Subtitles timed out. Try again.");
            logger.warn("Subtitle cue load timed out.", {
              ...logEventFields("editor.subtitle.load", "failure"),
              ...logDurationFields(startedAt),
              ...fields,
              "subtitle.timeout": true,
              "subtitle.timeout.ms": SUBTITLE_IMPORT_TIMEOUT_MS,
            });
          }
          return;
        }

        warnWithError(logger, error, "Could not load subtitle cues.", {
          ...logEventFields("editor.subtitle.load", "failure"),
          ...logDurationFields(startedAt),
          ...logErrorFields(error),
          ...fields,
          "subtitle.timeout": false,
        });
        setSubtitleCues([]);
        setLoadedSource(null);
        setSubtitleError(
          error instanceof Error ? error.message : "Could not load subtitles.",
        );
      }
    }

    void loadSubtitleCues(source);

    return () => {
      cancelled = true;
      globalThis.clearTimeout(timeout);
      abortController.abort();
    };
  }, [providerId, resetSubtitleCues, source]);

  return {
    subtitleCues,
    subtitleError,
    loadedSource,
    resetSubtitleCues,
  };
}
