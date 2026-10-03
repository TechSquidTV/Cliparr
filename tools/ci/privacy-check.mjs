import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync, readlinkSync } from "node:fs";
import { isIP } from "node:net";
import { pathToFileURL } from "node:url";

// Byte-identical to the public specification at https://developer.plex.tv/pms/.
// A changed snapshot must be reviewed against its public source before updating this hash.
const publicSnapshots = new Map([
  // The supplement repeats the public part.file example in its expected/value contract correction.
  [
    "packages/plex/openapi/pms-supplement.json",
    "36513ab6882cd81a097d04b2b811ff3854c1f17c150afa36f5ed53c3fb5d0cf3",
  ],
  [
    "packages/plex/openapi/pms.json",
    "d6d86b0187ff51391d21f08ebd35fbe7e7c8d34747759d383db4152ddc8f010d",
  ],
]);
const privatePolicyAddresses = new Set(
  [
    [10, 0, 0, 1],
    [172, 16, 0, 1],
    [192, 168, 0, 1],
  ].map((octets) => octets.join(".")),
);
// Reviewed public project, attribution, specification, and documentation origins.
const publicHosts = new Set([
  "durian.blender.org",
  "creativecommons.org",
  "api.github.com",
  "github.com",
  "app.plex.tv",
  "clients.plex.tv",
  "plex.tv",
  "www.plex.tv",
  "developer.plex.tv",
  "forums.plex.tv",
  "support.plex.tv",
  "www.plexopedia.com",
  "beui.dev",
  "canvastimeline.com",
  "caniuse.com",
  "cliparr.dev",
  "developer.mozilla.org",
  "docs.renovatebot.com",
  "download.blender.org",
  "ftp.halifax.rwth-aachen.de",
  "en.wikipedia.org",
  "http.cat",
  "img.shields.io",
  "kyletryon.github.io",
  "mediabunny.dev",
  "schema.org",
  "semver.org",
  "swagger.io",
  "tailwindcss.com",
  "ui.shadcn.com",
  "unpkg.com",
  "webcodecsfundamentals.org",
  "www.contributor-covenant.org",
  "www.npmjs.com",
  "www.w3.org",
]);
const localNames = new Set([
  "localhost",
  "plex",
  "jellyfin",
  "cliparr.local",
  "metadata",
  "metadata.google.internal",
  "metadata.azure.internal",
]);

function permittedAddress(address, file) {
  let normalized = address.replaceAll(/^\[|\]$/g, "");
  if (isIP(normalized) === 6) {
    normalized = new URL(`http://[${normalized}]`).hostname.slice(1, -1);
    if (normalized.startsWith("::ffff:")) {
      const words = normalized
        .slice(7)
        .split(":")
        .map((word) => Number.parseInt(word, 16));
      normalized = [
        words[0] >> 8,
        words[0] & 255,
        words[1] >> 8,
        words[1] & 255,
      ].join(".");
    } else {
      return (
        normalized === "::" ||
        normalized === "::1" ||
        normalized.startsWith("2001:db8:") ||
        /^fe[89ab]/i.test(normalized) ||
        normalized.startsWith("ff") ||
        (file === "apps/server/src/test/networkPolicyFixtures.ts" &&
          normalized === ["fd00", "", "1"].join(":"))
      );
    }
  }
  if (
    file === "apps/server/src/test/networkPolicyFixtures.ts" &&
    privatePolicyAddresses.has(normalized)
  ) {
    return true;
  }
  if (
    file === "docker/compose.dev.yml" &&
    normalized === [172, 28, 0, 0].join(".")
  ) {
    return true;
  }
  const [first, second, third] = normalized.split(".").map(Number);
  return (
    first === 0 ||
    first === 127 ||
    first >= 224 ||
    (first === 169 && second === 254) ||
    (first === 192 && second === 0 && third === 2) ||
    (first === 198 && second === 51 && third === 100) ||
    (first === 203 && second === 0 && third === 113)
  );
}

function endpointCategory(value, file) {
  // Inspect the authority independently of an interpolated port, path, or query.
  // Only a dynamic hostname (JS or OpenAPI template) cannot be checked statically.
  const authority = /^(?:https?:)?\/\/([^/?#]+)/i.exec(value)?.[1];
  const hostAndPort = authority?.slice(authority.lastIndexOf("@") + 1);
  const host = hostAndPort?.startsWith("[")
    ? /^\[[^\]]+\]/.exec(hostAndPort)?.[0]
    : hostAndPort?.split(":")[0];
  if (!host || host.includes("${") || /\{[^}]+\}/.test(host)) {
    return;
  }
  let url;
  try {
    url = new URL(`http://${host}`);
  } catch {
    return;
  }
  const hostname = url.hostname.replaceAll(/^\[|\]$/g, "");
  if (isIP(hostname)) {
    return permittedAddress(hostname, file) ? undefined : "unapproved-address";
  }
  if (localNames.has(hostname)) {
    return;
  }
  if (hostname.endsWith(".plex.direct")) {
    const match = /^(\d+-\d+-\d+-\d+)\.fixture\.plex\.direct$/.exec(hostname);
    return match && permittedAddress(match[1].replaceAll("-", "."), file)
      ? undefined
      : "provider-host-identifier";
  }
  if (/\.(?:local|lan|internal|home)$/i.test(hostname)) {
    return "private-hostname";
  }
  if (
    publicHosts.has(hostname) ||
    /(?:^|\.)(?:example\.(?:com|net|org)|example|test|invalid|localhost)$/.test(
      hostname,
    )
  ) {
    return;
  }
  return "unapproved-endpoint";
}

// Return locations and categories only. Never echo the matched source or value.
export function findPrivacyIssues(file, content) {
  const expectedHash = publicSnapshots.get(file);
  if (
    expectedHash &&
    createHash("sha256").update(content).digest("hex") === expectedHash
  ) {
    return [];
  }
  const issues = [];
  for (const [index, line] of content.split("\n").entries()) {
    const categories = new Set();
    for (const match of line.matchAll(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g)) {
      if (isIP(match[0]) && !permittedAddress(match[0], file)) {
        categories.add("unapproved-address");
      }
    }
    for (const match of line.matchAll(
      /(?<=["'`\s[])(?:[\da-f]{0,4}:){2,}[\da-f:.]+(?=["'`\s\],;]|$)/gi,
    )) {
      if (isIP(match[0]) && !permittedAddress(match[0], file)) {
        categories.add("unapproved-address");
      }
    }
    for (const match of line.matchAll(
      /(?:https?:\/\/|(?<=^|[\s"'`(=])\/\/)[^\s"'`<>\\)]+/gi,
    )) {
      const category = endpointCategory(match[0], file);
      if (category) {
        categories.add(category);
      }
    }
    for (const match of line.matchAll(
      /["'`]((?:[a-z\d-]+\.)+(?:local|lan|home|internal|home\.arpa|plex\.direct|com|net|org|dev|app|io|tv|cloud))["'`]/gi,
    )) {
      const category = endpointCategory(`http://${match[1]}`, file);
      if (category) {
        categories.add(category);
      }
    }
    // A user's home directory contains a user segment and a following path;
    // Jellyfin /Users/Me and /Users/AuthenticateByName API routes do not.
    if (
      /(?:^|[\s"'`(])\/(?:Users|home)\/[^/\s"'`]+\//.test(line) ||
      /[A-Z]:\\+(?:Users|Documents and Settings)\\+[^\\\s"']+\\+/i.test(line)
    ) {
      categories.add("personal-filesystem-path");
    }
    for (const category of categories) {
      issues.push({ file, line: index + 1, category });
    }
  }
  return issues;
}

export function checkRepository() {
  const paths = execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    { encoding: "utf8" },
  )
    .split("\0")
    .filter(Boolean);
  let findings = 0;
  for (const file of new Set(paths)) {
    let bytes;
    try {
      bytes = lstatSync(file).isSymbolicLink()
        ? Buffer.from(readlinkSync(file))
        : readFileSync(file);
    } catch (error) {
      if (error.code === "ENOENT") {
        continue;
      }
      throw error;
    }
    if (bytes.includes(0)) {
      continue;
    } // Visual/binary assets are covered by the documented manual audit.
    for (const issue of findPrivacyIssues(file, bytes.toString("utf8"))) {
      process.stderr.write(`${issue.file}:${issue.line}: ${issue.category}\n`);
      findings++;
    }
  }
  if (findings) {
    process.exitCode = 1;
  } else {
    process.stdout.write("Privacy fixture checks passed.\n");
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  checkRepository();
}
