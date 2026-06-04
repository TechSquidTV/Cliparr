import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  compactLogFields,
  logDurationFields,
  logErrorFields,
  logEventFields,
} from "@cliparr/shared/logging";
import type { PlaybackSubtitleTrack } from "@/providers/types";
import {
  subtitleTrackKey,
  subtitleTrackSupportsBurnIn,
  subtitleTrackUnavailableMessage,
} from "@/lib/selectPreferredSubtitleTrack";
import { parseSubtitleTextAsync } from "@/lib/subtitles/parseSubtitleTextAsync";
import type { SubtitleCue } from "@/lib/subtitles/types";
import { getFrontendLogger, warnWithError } from "@/logging";

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

export interface SubtitleResponseDiagnostics {
  charCount: number;
  contentLength?: number;
  contentType?: string;
  empty: boolean;
  status: number;
}

export type SubtitleDownloadResult =
  | {
      ok: true;
      cues: SubtitleCue[];
      response: SubtitleResponseDiagnostics;
    }
  | {
      ok: false;
      failure: SubtitleDownloadFailure;
      response: SubtitleResponseDiagnostics;
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

function numericHeaderValue(value: string | null) {
  if (!value) {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

export function subtitleResponseDiagnostics(
  response: Pick<Response, "headers" | "status">,
  body: string,
): SubtitleResponseDiagnostics {
  return {
    charCount: body.length,
    contentLength: numericHeaderValue(response.headers.get("content-length")),
    contentType: response.headers.get("content-type") ?? undefined,
    empty: body.length === 0,
    status: response.status,
  };
}

export function subtitleResponseDiagnosticFields(
  response: SubtitleResponseDiagnostics,
  cueCount: number,
) {
  return compactLogFields({
    "http.status_code": response.status,
    "http.content_type": response.contentType,
    "http.content_length": response.contentLength,
    "subtitle.response.char_count": response.charCount,
    "subtitle.response.empty": response.empty,
    "subtitle.cue.count": cueCount,
    "subtitle.empty": cueCount === 0,
  });
}

export function subtitleCueLoadKey(track: PlaybackSubtitleTrack | null) {
  if (!track) {
    return "none";
  }

  return [
    subtitleTrackKey(track),
    track.contentFormat ?? "",
    track.codec ?? "",
    track.isText ? "text" : "not-text",
    track.contentUrl ?? "",
  ].join("\u001f");
}

export async function downloadSubtitleCues(
  track: PlaybackSubtitleTrack,
  contentUrl: string,
  signal: AbortSignal,
): Promise<SubtitleDownloadResult> {
  const response = await fetch(contentUrl, { signal });
  const body = await response.text();
  const responseDiagnostics = subtitleResponseDiagnostics(response, body);
  if (!response.ok) {
    return {
      ok: false,
      failure: subtitleDownloadFailure(response.status),
      response: responseDiagnostics,
    };
  }

  return {
    ok: true,
    cues: await parseSubtitleTextAsync(body, track.contentFormat, signal),
    response: responseDiagnostics,
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
  const selectedSubtitleTrackRef = useRef(selectedSubtitleTrack);
  const selectedSubtitleTrackLoadKey = useMemo(
    () => subtitleCueLoadKey(selectedSubtitleTrack),
    [selectedSubtitleTrack],
  );

  useEffect(() => {
    selectedSubtitleTrackRef.current = selectedSubtitleTrack;
  }, [selectedSubtitleTrack]);

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
      const selectedSubtitleTrack = selectedSubtitleTrackRef.current;

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
            ...subtitleResponseDiagnosticFields(downloadResult.response, 0),
            "subtitle.timeout": false,
            "error.name": "SubtitleDownloadFailure",
            "error.message": downloadResult.failure.message,
          });
          setSubtitleCues([]);
          setSubtitleError(downloadResult.failure.message);
          return;
        }

        const parsedSubtitleCues = downloadResult.cues;
        const subtitleEmpty = parsedSubtitleCues.length === 0;
        setSubtitleCues(parsedSubtitleCues);
        setSubtitleError(
          subtitleEmpty ? "No subtitles found in this track." : null,
        );
        logger.info("Subtitle cues loaded.", {
          ...logEventFields(
            "editor.subtitle.load",
            subtitleEmpty ? "empty" : "success",
          ),
          ...logDurationFields(startedAt),
          ...subtitleTrackLogFields(selectedSubtitleTrack, providerId),
          ...subtitleResponseDiagnosticFields(
            downloadResult.response,
            parsedSubtitleCues.length,
          ),
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
  }, [
    providerId,
    resetSubtitleCues,
    selectedSubtitleTrackLoadKey,
    subtitleEnabled,
  ]);

  return {
    subtitleCues,
    subtitleLoading,
    subtitleError,
    resetSubtitleCues,
    clearSubtitleError,
  };
}
