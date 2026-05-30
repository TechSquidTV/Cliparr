import fs from "node:fs";
import path from "node:path";
import prettier from "prettier";
import {
  dockerRunCommand,
  envVars,
  features,
  warnings,
} from "../src/data/product";

const rootDir = path.resolve(import.meta.dirname, "../../..");
const readmePath = path.join(rootDir, "README.md");

type SectionName = "features" | "docker-quick-start" | "configuration";

const sectionOrder: SectionName[] = [
  "features",
  "docker-quick-start",
  "configuration",
];

function marker(name: SectionName, edge: "start" | "end") {
  return `<!-- CLIPARR_DOCS_SYNC:${name}:${edge} -->`;
}

function renderFeatures() {
  return features
    .map((feature) => `- **${feature.title}**: ${feature.description}`)
    .join("\n");
}

function renderDockerQuickStart() {
  const warningBlocks = warnings
    .map((warning) => `> [!IMPORTANT]\n> **${warning.title}**: ${warning.body}`)
    .join("\n\n");

  return `The fastest way to get Cliparr running is via the GitHub Container Registry.\n\n\`\`\`bash\n${dockerRunCommand}\n\`\`\`\n\n${warningBlocks}`;
}

function renderConfiguration() {
  const rows = envVars.map((item) => {
    return `| \`${item.name}\` | ${item.description} | \`${item.defaultValue}\` |`;
  });

  return `| Variable | Description | Default |\n| :--- | :--- | :--- |\n${rows.join("\n")}`;
}

const renderers: Record<SectionName, () => string> = {
  features: renderFeatures,
  "docker-quick-start": renderDockerQuickStart,
  configuration: renderConfiguration,
};

function replaceSection(readme: string, name: SectionName) {
  const start = marker(name, "start");
  const end = marker(name, "end");
  const pattern = new RegExp(
    `${escapeRegExp(start)}\\n[\\s\\S]*?\\n${escapeRegExp(end)}`,
  );

  if (!pattern.test(readme)) {
    throw new Error(`README.md is missing generated docs markers for ${name}.`);
  }

  return readme.replace(pattern, `${start}\n${renderers[name]()}\n${end}`);
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function syncedReadme(readme: string) {
  return sectionOrder.reduce(
    (next, section) => replaceSection(next, section),
    readme,
  );
}

const mode = process.argv.includes("--write") ? "write" : "check";
const readme = fs.readFileSync(readmePath, "utf8");
const prettierConfig = await prettier.resolveConfig(readmePath);
const nextReadme = await prettier.format(syncedReadme(readme), {
  ...prettierConfig,
  filepath: readmePath,
});

if (mode === "write") {
  if (nextReadme !== readme) {
    fs.writeFileSync(readmePath, nextReadme);
  }
  console.log("README docs blocks are synced.");
} else if (nextReadme !== readme) {
  console.error("README docs blocks are out of sync. Run `pnpm docs:sync`.");
  process.exit(1);
} else {
  console.log("README docs blocks are synced.");
}
