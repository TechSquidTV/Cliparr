import type { Transition } from "motion/react";
import { cliparrMotionTokens } from "@/lib/motionTokens";

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
