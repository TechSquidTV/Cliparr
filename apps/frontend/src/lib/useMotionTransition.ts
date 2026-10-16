import { useReducedMotion } from "motion/react";

import { cliparrMotionTransitions } from "@/lib/motion";

const reducedMotionTransition = { duration: 0 };

export function useMotionTransition(
  kind: keyof typeof cliparrMotionTransitions,
) {
  const reduceMotion = useReducedMotion();
  return reduceMotion
    ? reducedMotionTransition
    : cliparrMotionTransitions[kind];
}
