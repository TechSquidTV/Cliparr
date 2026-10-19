import plugin from "tailwindcss/plugin";

// Tailwind loads plugins outside Vite and its path aliases.
// eslint-disable-next-line no-restricted-imports
import { cliparrMotionTokens } from "../lib/motion.ts";

export default plugin((theme) => {
  theme.addBase({
    ":root": {
      ...Object.fromEntries(
        Object.entries(cliparrMotionTokens.durations).map(
          ([name, duration]) => [
            `--motion-duration-${name}`,
            `${duration * 1000}ms`,
          ],
        ),
      ),
      "--motion-easing-standard": `cubic-bezier(${cliparrMotionTokens.ease.join(", ")})`,
    },
  });
});
