import { EncodedPacketSink, FLAC, type InputAudioTrack } from "mediabunny";

export function createIncompleteSourceAudioError() {
  return Object.assign(
    new Error(
      "Cliparr can’t export this selection because part of its source audio is unreadable.",
    ),
    { name: "IncompleteSourceAudioError" as const },
  );
}

type IncompleteSourceAudioError = ReturnType<
  typeof createIncompleteSourceAudioError
>;

export function isIncompleteSourceAudioError(
  error: unknown,
): error is IncompleteSourceAudioError {
  return error instanceof Error && error.name === "IncompleteSourceAudioError";
}

/** Protect native FLAC selections from the released reader's missing-tail behavior. */
export async function assertSourceAudioRange(
  track: InputAudioTrack | null,
  start: number,
  end: number,
  includeAudio: boolean,
  signal?: AbortSignal,
) {
  signal?.throwIfAborted();
  if (!includeAudio || !track) {
    return;
  }
  if ((await track.input.getFormat()) !== FLAC) {
    return;
  }
  const sampleDuration = 1 / (await track.getSampleRate());
  signal?.throwIfAborted();
  // Query within the selection, not at the next packet boundary or file end.
  // Reuse the conversion input's packet index; do not decode or reopen the source.
  const packet = await new EncodedPacketSink(track).getPacket(
    Math.max(start, end - sampleDuration / 2),
    { metadataOnly: true },
  );
  signal?.throwIfAborted();
  if (!packet || packet.timestamp + packet.duration + sampleDuration < end) {
    throw createIncompleteSourceAudioError();
  }
}
