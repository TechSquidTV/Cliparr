export const releaseTypeOrder = ["none", "patch", "minor", "major"];
export const allowedCommitTypes = new Set([
  "build",
  "chore",
  "ci",
  "docs",
  "feat",
  "fix",
  "perf",
  "refactor",
  "security",
  "style",
  "test",
]);

const releaseTypeByCommitType = new Map([
  ["fix", "patch"],
  ["perf", "patch"],
  ["security", "patch"],
  ["feat", "minor"],
]);

const conventionalTitlePattern = /^(?<type>[a-z]+)(?:\((?<scope>[^)]+)\))?(?<breaking>!)?: (?<subject>.+)$/;
const semverTagPattern = /^v(?<major>0|[1-9]\d*)\.(?<minor>0|[1-9]\d*)\.(?<patch>0|[1-9]\d*)(?:-(?<channel>beta|rc)\.(?<prereleaseNumber>0|[1-9]\d*))?$/;

export function parseConventionalTitle(title) {
  const trimmed = title.trim();
  const match = conventionalTitlePattern.exec(trimmed);

  if (!match?.groups) {
    return {
      valid: false,
      title: trimmed,
      error: "Title must match Conventional Commits, for example `feat: add local previews`.",
    };
  }

  const { type, scope, breaking, subject } = match.groups;

  if (!allowedCommitTypes.has(type)) {
    return {
      valid: false,
      title: trimmed,
      error: `Unknown Conventional Commit type \`${type}\`.`,
    };
  }

  if (!subject.trim()) {
    return {
      valid: false,
      title: trimmed,
      error: "Title subject cannot be empty.",
    };
  }

  return {
    valid: true,
    title: trimmed,
    type,
    scope,
    subject: subject.trim(),
    breaking: breaking === "!",
  };
}

export function releaseTypeForChange(change) {
  if (!change.valid) {
    return "none";
  }

  if (change.breaking) {
    return "major";
  }

  if (change.type === "build" && change.scope === "deps") {
    return "patch";
  }

  return releaseTypeByCommitType.get(change.type) ?? "none";
}

export function maxReleaseType(changes) {
  return changes.reduce((maxType, change) => {
    const nextType = releaseTypeForChange(change);
    return releaseTypeOrder.indexOf(nextType) > releaseTypeOrder.indexOf(maxType)
      ? nextType
      : maxType;
  }, "none");
}

export function parseSemverTag(tag) {
  const match = semverTagPattern.exec(tag.trim());

  if (!match?.groups) {
    return undefined;
  }

  return {
    tag,
    version: `${match.groups.major}.${match.groups.minor}.${match.groups.patch}`,
    major: Number(match.groups.major),
    minor: Number(match.groups.minor),
    patch: Number(match.groups.patch),
    channel: match.groups.channel,
    prereleaseNumber: match.groups.prereleaseNumber === undefined
      ? undefined
      : Number(match.groups.prereleaseNumber),
  };
}

export function compareSemverTags(leftTag, rightTag) {
  const left = parseSemverTag(leftTag);
  const right = parseSemverTag(rightTag);

  if (!left || !right) {
    return left ? 1 : right ? -1 : 0;
  }

  for (const key of ["major", "minor", "patch"]) {
    if (left[key] !== right[key]) {
      return left[key] - right[key];
    }
  }

  if (!left.channel && right.channel) {
    return 1;
  }

  if (left.channel && !right.channel) {
    return -1;
  }

  if (left.channel !== right.channel) {
    return String(left.channel ?? "").localeCompare(String(right.channel ?? ""));
  }

  return (left.prereleaseNumber ?? 0) - (right.prereleaseNumber ?? 0);
}

export function latestStableTag(tags) {
  return tags
    .filter((tag) => {
      const version = parseSemverTag(tag);
      return version && !version.channel;
    })
    .sort(compareSemverTags)
    .at(-1);
}

export function bumpVersion(version, releaseType) {
  if (releaseType === "major") {
    return {
      major: version.major + 1,
      minor: 0,
      patch: 0,
    };
  }

  if (releaseType === "minor") {
    return {
      major: version.major,
      minor: version.minor + 1,
      patch: 0,
    };
  }

  if (releaseType === "patch") {
    return {
      major: version.major,
      minor: version.minor,
      patch: version.patch + 1,
    };
  }

  throw new Error(`Cannot bump version for release type ${releaseType}.`);
}

export function formatVersion(version) {
  return `${version.major}.${version.minor}.${version.patch}`;
}

export function formatTag(version) {
  return `v${version}`;
}

export function nextPrereleaseNumber(tags, baseVersion, channel) {
  const prefix = `v${baseVersion}-${channel}.`;
  const highest = tags
    .filter((tag) => tag.startsWith(prefix))
    .map(parseSemverTag)
    .filter((version) => version?.channel === channel)
    .map((version) => version.prereleaseNumber ?? 0)
    .sort((left, right) => left - right)
    .at(-1);

  return (highest ?? 0) + 1;
}

export function latestPrereleaseTag(tags, baseVersion, channel) {
  const prefix = `v${baseVersion}-${channel}.`;

  return tags
    .filter((tag) => tag.startsWith(prefix))
    .sort(compareSemverTags)
    .at(-1);
}

export function extractReleaseTitleFromCommitMessage(message) {
  const lines = message.replace(/\r\n/g, "\n").split("\n");
  const subject = lines[0]?.trim() ?? "";

  if (!subject.startsWith("Merge pull request #")) {
    return subject;
  }

  return lines.slice(1).find((line) => line.trim().length > 0)?.trim() ?? subject;
}

export function extractPullRequestNumberFromCommitMessage(message) {
  const subject = message.replace(/\r\n/g, "\n").split("\n")[0]?.trim() ?? "";
  const match = /^(?:Merge pull request #(?<mergeNumber>\d+) |\S[\s\S]* \(#(?<squashNumber>\d+)\)$)/u.exec(subject);
  const number = match?.groups?.mergeNumber ?? match?.groups?.squashNumber;

  return number ? Number(number) : undefined;
}

export function parseGitLogMessages(logOutput) {
  return logOutput
    .split("\x1e")
    .map((record) => record.trim().replace(/\x1f$/u, "").trim())
    .filter(Boolean);
}

export function summarizeChanges(titles) {
  const changes = titles.map(parseConventionalTitle);
  const invalidChanges = changes.filter((change) => !change.valid);
  const releaseType = maxReleaseType(changes);

  return {
    changes,
    invalidChanges,
    releaseType,
    releasableChanges: changes.filter((change) => releaseTypeForChange(change) !== "none"),
  };
}
