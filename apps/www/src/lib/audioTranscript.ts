import {
  parseText,
  tokenizeVTTCue,
  type VTTCue,
  type VTTNode,
} from "media-captions";

type AudioTranscriptCue = Pick<VTTCue, "id" | "startTime" | "endTime" | "text">;

function plainText(nodes: readonly VTTNode[]): string {
  return nodes
    .map((node) =>
      node.type === "text" ? node.data : plainText(node.children),
    )
    .join("");
}

/** Build-time only: the browser uses timestamps in the rendered transcript. */
export async function parseAudioTranscript(
  raw: string,
): Promise<AudioTranscriptCue[]> {
  const text = raw
    .replace(/^\uFEFF/, "")
    .replaceAll(/\r\n?/g, "\n")
    .trim();
  if (!text) {
    return [];
  }

  const { cues } = await parseText(text, {
    type: text.startsWith("WEBVTT") ? "vtt" : "srt",
    strict: false,
    errors: false,
  });

  return cues
    .flatMap((cue): AudioTranscriptCue[] => {
      if (
        !Number.isFinite(cue.startTime) ||
        !Number.isFinite(cue.endTime) ||
        cue.startTime < 0 ||
        cue.endTime <= cue.startTime
      ) {
        return [];
      }

      const content = plainText(tokenizeVTTCue(cue))
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .join("\n");
      return content
        ? [
            {
              id: cue.id,
              startTime: cue.startTime,
              endTime: cue.endTime,
              text: content,
            },
          ]
        : [];
    })
    .toSorted((left, right) => left.startTime - right.startTime);
}
