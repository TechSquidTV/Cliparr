import type { ExportFormat } from "#/lib/export/exportFormats";

// Expectations are authored independently of the emitted module graph.
export const setupExpectations = {
  mp4: ["audioPlan", "@mediabunny/aac-encoder"],
  mov: ["audioPlan", "@mediabunny/aac-encoder"],
  mkv: ["audioPlan", "@mediabunny/aac-encoder"],
  webm: ["audioPlan"],
  mp3: ["audioPlan", "@mediabunny/mp3-encoder"],
  m4a: ["audioPlan", "@mediabunny/aac-encoder"],
  ogg: ["audioPlan"],
  flac: ["audioPlan", "@mediabunny/flac-encoder"],
  wav: ["audioPlan"],
  gif: [],
} as const satisfies Record<ExportFormat, readonly string[]>;
