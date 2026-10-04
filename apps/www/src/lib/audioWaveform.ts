export const waveformBarCount = 96;

/** Peak amplitude per time bucket, across every channel, normalized for display. */
export function audioWaveformPeaks(channels: readonly Float32Array[]) {
  const length = channels[0]?.length ?? 0;
  const peaks = Array.from({ length: waveformBarCount }, (_, bucket) => {
    const start = Math.floor((bucket * length) / waveformBarCount);
    const end = Math.floor(((bucket + 1) * length) / waveformBarCount);
    let peak = 0;

    for (const channel of channels) {
      for (let sample = start; sample < end; sample++) {
        peak = Math.max(peak, Math.abs(channel[sample] ?? 0));
      }
    }

    return peak;
  });
  const maximum = Math.max(...peaks);
  return peaks.map((peak) => (maximum > 0 ? peak / maximum : 0));
}

export function audioWaveformPath(peaks: readonly number[]) {
  return peaks
    .map((peak, index) => {
      const x = ((index + 0.5) / peaks.length) * 576;
      const height = Math.max(2, Math.min(1, Math.max(0, peak)) * 56);
      return `M${x},${32 - height / 2}v${height}`;
    })
    .join(" ");
}
