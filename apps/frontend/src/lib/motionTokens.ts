// Motion uses seconds; the Tailwind plugin converts these values to CSS times.
export const cliparrMotionTokens = {
  durations: {
    fast: 0.18,
    medium: 0.28,
    standard: 0.3,
  },
  ease: [0.2, 0, 0, 1] as [number, number, number, number],
} as const;
