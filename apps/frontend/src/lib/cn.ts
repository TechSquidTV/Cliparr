import { type ClassValue, clsx } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// Custom text sizes must stay distinct from text color classes when merging.
const mergeClasses = extendTailwindMerge({
  extend: {
    theme: {
      text: [
        "ui-micro",
        "ui-label",
        "editor-property",
        "editor-input",
        "editor-preview-fallback",
      ],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return mergeClasses(clsx(inputs));
}
