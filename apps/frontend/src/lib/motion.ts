import type { Transition } from "motion/react";

// Motion uses seconds; the Tailwind plugin converts these values to CSS times.
export const cliparrMotionTokens = {
  durations: {
    fast: 0.18,
    medium: 0.28,
    standard: 0.3,
  },
  ease: [0.2, 0, 0, 1] as [number, number, number, number],
} as const;

const { durations: cliparrMotionDurations, ease: cliparrMotionEase } =
  cliparrMotionTokens;

export const cliparrMotionTransitions = {
  fast: {
    duration: cliparrMotionDurations.fast,
    ease: cliparrMotionEase,
  },
  medium: {
    duration: cliparrMotionDurations.medium,
    ease: cliparrMotionEase,
  },
  standard: {
    duration: cliparrMotionDurations.standard,
    ease: cliparrMotionEase,
  },
  layout: {
    duration: cliparrMotionDurations.standard,
    ease: cliparrMotionEase,
  },
} satisfies Record<string, Transition>;

const reducedMotionTransition = { duration: 0 };

export function motionTransitionFor(
  kind: keyof typeof cliparrMotionTransitions,
  reduceMotion: boolean | null,
) {
  return reduceMotion
    ? reducedMotionTransition
    : cliparrMotionTransitions[kind];
}
