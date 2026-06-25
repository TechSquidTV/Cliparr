import fs from "node:fs";
import path from "node:path";
import prettier from "prettier";
import {
  dockerLinuxContainerNote,
  dockerRunCommand,
  dockerRunPowerShellCommand,
  envVariables,
  features,
  warnings,
} from "@/data/product";

const rootDir = path.resolve(import.meta.dirname, "../../..");
const readmePath = path.join(rootDir, "README.md");
const prettierConfigPath = path.join(rootDir, "config/prettier.config.js");

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

  return `The fastest way to get Cliparr running is via the GitHub Container Registry.\n\n**macOS / Linux**\n\n\`\`\`bash\n${dockerRunCommand}\n\`\`\`\n\n**PowerShell**\n\n\`\`\`powershell\n${dockerRunPowerShellCommand}\n\`\`\`\n\n${dockerLinuxContainerNote}\n\n${warningBlocks}`;
}

function renderConfiguration() {
  const rows = envVariables.map((item) => {
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
    String.raw`${escapeRegExp(start)}\n[\s\S]*?\n${escapeRegExp(end)}`,
  );

  if (!pattern.test(readme)) {
    throw new Error(`README.md is missing generated docs markers for ${name}.`);
  }

  return readme.replace(pattern, `${start}\n${renderers[name]()}\n${end}`);
}

function escapeRegExp(value: string) {
  return value.replaceAll(/[$()*+.?[\\\]^{|}]/g, String.raw`\$&`);
}

function syncedReadme(readme: string) {
  let nextReadme = readme;

  for (const section of sectionOrder) {
    nextReadme = replaceSection(nextReadme, section);
  }

  return nextReadme;
}

const mode = process.argv.includes("--write") ? "write" : "check";
const readme = fs.readFileSync(readmePath, "utf8");
const prettierConfig = await prettier.resolveConfig(readmePath, {
  config: prettierConfigPath,
});
const nextReadme = await prettier.format(syncedReadme(readme), {
  ...prettierConfig,
  filepath: readmePath,
});

if (mode === "write") {
  if (nextReadme !== readme) {
    fs.writeFileSync(readmePath, nextReadme);
  }
  process.stdout.write("README docs blocks are synced.\n");
} else if (nextReadme === readme) {
  process.stdout.write("README docs blocks are synced.\n");
} else {
  process.stderr.write(
    "README docs blocks are out of sync. Run `pnpm docs:sync`.\n",
  );
  process.exit(1);
}
