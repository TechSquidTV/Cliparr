import { existsSync, globSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

import { parseDocument } from "yaml";

const exactVersion = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/u;

export function nodeVersionViolations(
  files,
  runtimeVersion,
  { exactRuntime = false } = {},
) {
  const errors = [];
  const version = files.get(".nvmrc")?.trim();
  if (!version || !exactVersion.test(version)) {
    return [".nvmrc: pin one exact Node version (major.minor.patch)."];
  }
  const [major, minor, patch] = version.split(".").map(Number);
  const running = exactVersion.test(runtimeVersion)
    ? runtimeVersion.split(".").map(Number)
    : undefined;
  const compatibleRuntime =
    running?.[0] === major &&
    (running[1] > minor || (running[1] === minor && running[2] >= patch));
  if (exactRuntime ? runtimeVersion !== version : !compatibleRuntime) {
    errors.push(
      `.nvmrc: running Node ${runtimeVersion}; ${exactRuntime ? `CI requires Node ${version}` : `use a stable Node ${major} version satisfying ^${version}`}.`,
    );
  }

  function configuration(file, yaml = false) {
    const text = files.get(file);
    if (text === undefined) {
      errors.push(`${file}: required configuration is missing.`);
      return;
    }
    try {
      if (!yaml) {
        return JSON.parse(text);
      }
      const document = parseDocument(text);
      if (document.errors.length > 0) {
        throw document.errors[0];
      }
      return document.toJS();
    } catch {
      errors.push(`${file}: configuration could not be parsed.`);
    }
  }

  const workspace = configuration("pnpm-workspace.yaml", true);
  const typings = workspace?.catalog?.["@types/node"];
  if (
    typeof typings !== "string" ||
    !typings.startsWith(`^${major}.`) ||
    !exactVersion.test(typings.slice(1))
  ) {
    errors.push(
      `pnpm-workspace.yaml: catalog @types/node must use a ^${major}.minor.patch range.`,
    );
  }
  const manifest = configuration("package.json");
  if (manifest?.engines?.node !== `^${version}`) {
    errors.push(`package.json: engines.node must be ^${version}.`);
  }
  for (const file of files.keys()) {
    if (!file.endsWith("package.json")) {
      continue;
    }
    const contents = file === "package.json" ? manifest : configuration(file);
    if (
      contents?.engines?.node !== undefined &&
      contents.engines.node !== `^${version}` &&
      file !== "package.json"
    ) {
      errors.push(`${file}: engines.node must be ^${version}.`);
    }
    for (const field of [
      "dependencies",
      "devDependencies",
      "optionalDependencies",
      "peerDependencies",
    ]) {
      const dependency = contents?.[field]?.["@types/node"];
      if (dependency !== undefined && dependency !== "catalog:") {
        errors.push(`${file}: ${field}.@types/node must use catalog:.`);
      }
    }
  }

  const dockerfile = files.get("docker/Dockerfile") ?? "";
  const stages = [
    ...dockerfile.matchAll(
      /^FROM[\t ]+(?:(?<platform>--platform=\S+)[\t ]+)?(?<source>\S+)(?:[\t ]+AS[\t ]+(?<alias>\S+))?[\t ]*$/gimu,
    ),
  ].map((match) => match.groups);
  for (const [name, tag, platform] of [
    ["toolchain", `node:${version}-trixie-slim`, "--platform=$BUILDPLATFORM"],
    [
      "production",
      `gcr.io/distroless/nodejs${major}-debian13:nonroot`,
      undefined,
    ],
  ]) {
    const matching = stages.filter(
      (stage) => stage.alias?.toLowerCase() === name,
    );
    const stage = matching[0];
    const prefix = `${tag}@sha256:`;
    if (
      matching.length !== 1 ||
      !stage.source.startsWith(prefix) ||
      !/^[a-f0-9]{64}$/u.test(stage.source.slice(prefix.length))
    ) {
      errors.push(
        `docker/Dockerfile: ${name} must use ${prefix}<index digest>.`,
      );
    } else if (stage.platform !== platform) {
      errors.push(
        `docker/Dockerfile: ${name} must retain its ${name === "toolchain" ? "build" : "target"} platform.`,
      );
    }
  }
  const slimStages = new Set(["toolchain"]);
  for (const { source, alias } of stages) {
    if (alias && slimStages.has(source.toLowerCase())) {
      slimStages.add(alias.toLowerCase());
    }
  }
  for (const target of [
    "server-build",
    "frontend-build",
    "capture-frontend-build",
    "development",
    "capture",
  ]) {
    if (!slimStages.has(target)) {
      errors.push(`docker/Dockerfile: ${target} must inherit from toolchain.`);
    }
  }

  let setups = 0;
  function inspectSteps(value, file) {
    if (!value || typeof value !== "object") {
      return;
    }
    if (
      typeof value.uses === "string" &&
      value.uses.startsWith("actions/setup-node@")
    ) {
      setups += 1;
      if (
        value.with?.["node-version-file"] !== ".nvmrc" ||
        Object.hasOwn(value.with ?? {}, "node-version")
      ) {
        errors.push(
          `${file}: setup-node must use node-version-file: .nvmrc without node-version.`,
        );
      }
    }
    for (const child of Object.values(value)) {
      inspectSteps(child, file);
    }
  }
  for (const file of files.keys()) {
    if (file.startsWith(".github/") && /\.ya?ml$/u.test(file)) {
      inspectSteps(configuration(file, true), file);
    }
  }
  if (setups === 0) {
    errors.push(".github/: no setup-node steps found using .nvmrc.");
  }
  return errors;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const paths = new Set([
    ".nvmrc",
    "package.json",
    "pnpm-workspace.yaml",
    "docker/Dockerfile",
    ...globSync([
      ".github/**/*.{yml,yaml}",
      "apps/*/package.json",
      "packages/*/package.json",
      "tools/*/package.json",
    ]).map((file) => file.replaceAll("\\", "/")),
  ]);
  const files = new Map(
    [...paths]
      .filter((file) => existsSync(file))
      .map((file) => [file, readFileSync(file, "utf8")]),
  );
  const errors = nodeVersionViolations(files, process.versions.node, {
    exactRuntime: process.env.CI === "true" || process.env.CI === "1",
  });
  if (errors.length > 0) {
    process.stderr.write(`${errors.join("\n")}\n`);
    process.exitCode = 1;
  } else {
    process.stdout.write(
      `Node configuration is synchronized at ${files.get(".nvmrc").trim()} (running ${process.versions.node}).\n`,
    );
  }
}
