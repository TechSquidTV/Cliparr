export type SourceFilter = "all" | "enabled" | "disabled" | "attention";

export interface Feedback {
  tone: "error" | "success" | "warning";
  message: string;
}
