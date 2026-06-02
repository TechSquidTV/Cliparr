import { parseSubtitleText } from "@/lib/subtitles/parseSubtitleText";
import type { SubtitleCue } from "@/lib/subtitles/types";

interface SubtitleParseWorkerRequest {
  text: string;
  format?: string;
}

interface SubtitleParseWorkerResponseSuccess {
  ok: true;
  cues: SubtitleCue[];
}

interface SubtitleParseWorkerResponseFailure {
  ok: false;
  message: string;
}

type SubtitleParseWorkerResponse =
  | SubtitleParseWorkerResponseSuccess
  | SubtitleParseWorkerResponseFailure;

function errorMessage(err: unknown) {
  return err instanceof Error ? err.message : "Could not parse subtitles.";
}

self.addEventListener(
  "message",
  (event: MessageEvent<SubtitleParseWorkerRequest>) => {
    try {
      const { format, text } = event.data;
      const response = {
        ok: true,
        cues: parseSubtitleText(text, format),
      } satisfies SubtitleParseWorkerResponse;

      self.postMessage(response);
    } catch (err) {
      const response = {
        ok: false,
        message: errorMessage(err),
      } satisfies SubtitleParseWorkerResponse;

      self.postMessage(response);
    }
  },
);
