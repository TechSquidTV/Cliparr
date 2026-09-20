import type { AstroIntegration } from "astro";
import type { Element, Root } from "hast";
import { select, selectAll } from "hast-util-select";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import rehypeParse from "rehype-parse";
import rehypeRemark from "rehype-remark";
import remarkGfm from "remark-gfm";
import remarkStringify from "remark-stringify";
import { unified } from "unified";
// Loaded by Astro configuration before app aliases are available.
// eslint-disable-next-line no-restricted-imports
import { markdownAssetPath } from "./markdown";

function cleanContent(target: Element, pageUrl: string): void {
  target.children = target.children.filter(
    (child) =>
      child.type !== "element" ||
      (![
        "script",
        "style",
        "nav",
        "button",
        "input",
        "select",
        "textarea",
        "svg",
        "video",
        "audio",
      ].includes(child.tagName) &&
        !("dataMarkdownExclude" in child.properties)),
  );
  for (const child of target.children) {
    if (child.type !== "element") {
      continue;
    }
    for (const attribute of ["href", "src"] as const) {
      const value = child.properties[attribute];
      if (typeof value === "string") {
        child.properties[attribute] = new URL(value, pageUrl).href;
      }
    }
    // Shiki stores its language on <pre>; Markdown conversion reads <code>.
    if (
      child.tagName === "pre" &&
      typeof child.properties.dataLanguage === "string"
    ) {
      const code = select("code", child);
      if (code) {
        code.properties.className = [
          `language-${child.properties.dataLanguage}`,
        ];
      }
    }
    cleanContent(child, pageUrl);
  }
}

function prepareContent(pageUrl: string) {
  return (tree: Root) => {
    const main = select("main", tree);
    if (!main) {
      throw new Error(`Missing main content: ${pageUrl}`);
    }
    cleanContent(main, pageUrl);
    // Avoid serializing scripts, global navigation, and the surrounding layout.
    tree.children.splice(0, tree.children.length, main);
    for (const image of selectAll('img[alt=""]', main)) {
      image.properties.dataMdast = "ignore";
    }
  };
}

export async function pageMarkdown(
  html: string,
  pageUrl: string,
): Promise<string> {
  const processor = unified()
    .use(rehypeParse)
    .use(prepareContent, pageUrl)
    .use(rehypeRemark)
    .use(remarkGfm)
    .use(remarkStringify, { fences: true });
  const markdown = String(await processor.process(html));
  return `Source: ${pageUrl}\n\n${markdown}`;
}

export default function markdownExport(): AstroIntegration {
  let siteUrl: string;
  return {
    name: "cliparr-markdown-export",
    hooks: {
      "astro:config:done": ({ config }) => {
        if (!config.site) {
          throw new Error("Markdown export requires a site URL.");
        }
        siteUrl = config.site;
      },
      "astro:build:done": async ({ dir, pages, logger }) => {
        for (const page of pages) {
          const pathname = `/${page.pathname.replaceAll(/^\/|\/$/gu, "")}`;
          if (pathname === "/404" || pathname === "/404.html") {
            continue;
          }
          const htmlPath = new URL(
            `.${markdownAssetPath(pathname).replace(/\.md$/u, ".html")}`,
            dir,
          );
          const markdown = await pageMarkdown(
            await readFile(htmlPath, "utf8"),
            new URL(`${pathname.replace(/\/$/u, "")}/`, siteUrl).href,
          );
          const output = fileURLToPath(
            new URL(`.${markdownAssetPath(pathname)}`, dir),
          );
          await mkdir(path.dirname(output), { recursive: true });
          await writeFile(output, markdown);
        }
        logger.info("Generated Markdown representations of public pages.");
      },
    },
  };
}
