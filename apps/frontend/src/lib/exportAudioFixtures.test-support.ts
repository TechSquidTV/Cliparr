/** Small deterministic PCM fixtures, generated without external media tools. */
export function createPcmWav({
  bits,
  samples,
  sampleRate = 48_000,
  channels = 1,
}: {
  bits: 8 | 16 | 24 | 32;
  samples: readonly number[];
  sampleRate?: number;
  channels?: number;
}) {
  const bytesPerSample = bits / 8;
  const dataSize = samples.length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize + (dataSize % 2));
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  const text = new TextEncoder();
  bytes.set(text.encode("RIFF"));
  view.setUint32(4, buffer.byteLength - 8, true);
  bytes.set(text.encode("WAVEfmt "), 8);
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channels * bytesPerSample, true);
  view.setUint16(32, channels * bytesPerSample, true);
  view.setUint16(34, bits, true);
  bytes.set(text.encode("data"), 36);
  view.setUint32(40, dataSize, true);
  for (const [index, sample] of samples.entries()) {
    const offset = 44 + index * bytesPerSample;
    for (let byte = 0; byte < bytesPerSample; byte++) {
      bytes[offset + byte] = (sample >> (byte * 8)) & 255;
    }
  }
  return new File([buffer], "precision.wav", { type: "audio/wav" });
}
