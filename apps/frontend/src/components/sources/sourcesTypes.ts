import type { sourceCounts } from "#/components/sources/sourcesStateUtilities";

export type SourceCounts = ReturnType<typeof sourceCounts>;

export type SourceFilter = "all" | "enabled" | "disabled" | "attention";

export interface Feedback {
  tone: "error" | "success" | "warning";
  message: string;
}
