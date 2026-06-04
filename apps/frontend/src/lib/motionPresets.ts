import type { Transition } from "motion/react";

const cliparrMotionEase = [0.2, 0, 0, 1] as [number, number, number, number];

const cliparrMotionDurations = {
  fast: 0.18,
  medium: 0.28,
  standard: 0.3,
} as const;

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
