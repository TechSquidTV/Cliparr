import { ALL_FORMATS, AudioSampleSink, BufferSource, Input } from "mediabunny";

const layouts = new Map<string, Promise<readonly string[]>>();

/**
WebCodecs implementations differ in their decoded surround ordering. These tiny,
synthetic fixtures have distinct channel amplitudes. Reference speaker energies
are measured independently with FFmpeg, including codec-specific filtering.
Inspect decoder behavior, never infer the source layout from programme audio.
Probes are generated at 48 kHz with 200 ms of 40 Hz, amplitude .025 * (channel + 1).
*/
export function identifyDecoderLayout(
  codec: string,
  channels: number,
): Promise<readonly string[]> {
  const key = `${codec}:${channels}`;
  const cached = layouts.get(key);
  if (cached) {
    return cached;
  }
  const pending = (async () => {
    const { default: probes } = await import("#/lib/audioLayoutProbes.json");
    const probe = Object.entries(probes).find(([name]) => name === key)?.[1];
    if (!probe) {
      throw new Error(
        "No verified decoder channel mapping is available for this audio layout.",
      );
    }
    const data = Uint8Array.from(
      atob(probe.data),
      (character) => character.codePointAt(0) ?? 0,
    );
    const input = new Input({
      formats: ALL_FORMATS,
      source: new BufferSource(data),
    });
    try {
      const track = await input.getPrimaryAudioTrack();
      if (!track || (await track.getNumberOfChannels()) !== channels) {
        throw new Error(
          "Could not verify the audio decoder's channel mapping.",
        );
      }
      const energy = new Float64Array(channels);
      let frames = 0;
      for await (const sample of new AudioSampleSink(track).samples()) {
        try {
          if (sample.numberOfChannels !== channels) {
            throw new Error("The audio decoder changed its channel count.");
          }
          frames += sample.numberOfFrames;
          const plane = new Float32Array(sample.numberOfFrames);
          for (let channel = 0; channel < channels; channel++) {
            sample.copyTo(plane, { format: "f32-planar", planeIndex: channel });
            for (const value of plane) {
              energy[channel] += value * value;
            }
          }
        } finally {
          sample.close();
        }
      }
      const ranked = Array.from(energy, (value, index) => ({
        value: Math.sqrt(value / frames),
        index,
      })).toSorted((a, b) => a.value - b.value);
      const reference = probe.levels
        .map((value, index) => ({ value, speaker: probe.layout[index] }))
        .toSorted((a, b) => a.value - b.value);
      const order: string[] = Array.from({ length: channels }, () => "");
      for (let rank = 0; rank < ranked.length; rank++) {
        // A missing/merged channel or very distorted probe must fail closed.
        const expectedRatio = reference[rank].value;
        const ratio = ranked[rank].value / ranked[channels - 1].value;
        if (!Number.isFinite(ratio) || Math.abs(ratio - expectedRatio) > 0.02) {
          throw new Error(
            "The audio decoder's surround ordering could not be verified. Choose another audio track.",
          );
        }
        order[ranked[rank].index] = reference[rank].speaker;
      }
      return order;
    } finally {
      input.dispose();
    }
  })().catch((error: Error) => {
    layouts.delete(key);
    throw error;
  });
  layouts.set(key, pending);
  return pending;
}
