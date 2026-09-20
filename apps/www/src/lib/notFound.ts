import { markdownPath } from "@/lib/markdown";
import { canonicalSiteUrl } from "@/lib/structuredData";

export const recoveryLinks = [
  { label: "Go home", path: "/" },
  { label: "Read docs", path: "/docs/" },
  { label: "Try Convert", path: "/convert/" },
] as const;

export const notFoundMarkdown = [
  "# Page not found",
  "",
  "No page exists at this URL. Use these links to find the right destination:",
  "",
  `- [Site guide](${canonicalSiteUrl("/llms.txt")})`,
  ...recoveryLinks.map(
    ({ label, path }) =>
      `- [${label}](${canonicalSiteUrl(markdownPath(path))})`,
  ),
  "",
].join("\n");
