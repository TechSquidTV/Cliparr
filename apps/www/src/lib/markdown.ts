/** Public Markdown location for a canonical page path. */
export function markdownPath(pathname: string): string {
  return `${pathname.replace(/\/$/u, "")}/index.md`;
}

/** Wildcards alone retain the browser default; explicit Markdown can win ties. */
export function prefersMarkdown(accept: string | null): boolean {
  const ranges = (accept ?? "")
    .toLowerCase()
    .split(",")
    .map((range) => {
      const [type = "", ...parameters] = range.trim().split(";");
      const qualityParameter = parameters.find((parameter) =>
        parameter.trim().startsWith("q="),
      );
      const quality = qualityParameter
        ? Number(qualityParameter.trim().slice(2))
        : 1;
      return {
        type: type.trim(),
        quality:
          Number.isFinite(quality) && quality >= 0 && quality <= 1
            ? quality
            : 0,
      };
    });
  const markdown = ranges.find((range) => range.type === "text/markdown");
  const html =
    ranges.find((range) => range.type === "text/html") ??
    ranges.find((range) => range.type === "text/*") ??
    ranges.find((range) => range.type === "*/*");
  return Boolean(
    markdown &&
    markdown.quality > 0 &&
    markdown.quality >= (html?.quality ?? 0),
  );
}
