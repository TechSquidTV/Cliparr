import type { SubtitleCue } from "#/lib/subtitles/types";

/**
Maximum transcript length embedded in the `clpr` payload. Dialogue for a
typical clip is a few hundred characters; the cap keeps long clips from
bloating file metadata.
*/
export const MAX_TRANSCRIPT_LENGTH = 4000;

/**
Builds a plain-text transcript from subtitle cues that have already been
clipped to the export range (see `trimSubtitleCues`). Imported cue text
has been normalized by the subtitle parser; custom caption text is kept
as authored. Stops collecting text once the metadata limit is reached.

Returns `undefined` when there is nothing to embed so the payload omits
the field entirely instead of carrying an empty string.
*/
export function buildTranscript(
  cues: readonly SubtitleCue[],
  maxLength: number = MAX_TRANSCRIPT_LENGTH,
): string | undefined {
  if (maxLength <= 0) {
    return undefined;
  }
  let text = "";
  for (const cue of cues) {
    const dialogue = cue.text.trim();
    if (!dialogue) {
      continue;
    }
    const separator = text ? "\n" : "";
    text += `${separator}${dialogue}`.slice(0, maxLength - text.length);
    if (text.length >= maxLength) {
      break;
    }
  }
  // A UTF-16 length limit must not leave half of an emoji in the payload.
  return text.replace(/[\uD800-\uDBFF]$/u, "") || undefined;
}
