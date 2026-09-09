import { appendFileSync } from "node:fs";

export function writeGithubOutput(outputs) {
  const outputFile = process.env.GITHUB_OUTPUT;
  if (!outputFile) {
    return;
  }
  const lines = Object.entries(outputs).flatMap(([key, value]) =>
    Array.isArray(value)
      ? [`${key}<<EOF`, ...value, "EOF"]
      : [`${key}=${value}`],
  );
  appendFileSync(outputFile, `${lines.join("\n")}\n`);
}
