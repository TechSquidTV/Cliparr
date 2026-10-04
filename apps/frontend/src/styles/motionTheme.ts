import plugin from "tailwindcss/plugin";
import { cliparrMotionTokens } from "#/lib/motionTokens.ts";

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
