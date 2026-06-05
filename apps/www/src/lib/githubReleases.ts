import type { Loader } from "astro/loaders";
import { site } from "@/data/product";

interface GitHubRelease {
  id: number;
  html_url: string;
  tag_name: string;
  name: string | null;
  body: string | null;
  draft: boolean;
  prerelease: boolean;
  published_at: string | null;
}

const releasesApiUrl =
  "https://api.github.com/repos/TechSquidTV/Cliparr/releases?per_page=20";
const pullRequestUrlPattern =
  / by @([^ ]+) in https:\/\/github\.com\/TechSquidTV\/Cliparr\/pull\/(\d+)/gu;
const fullChangelogPattern =
  /^\*\*Full Changelog\*\*: (https:\/\/github\.com\/TechSquidTV\/Cliparr\/(?:compare|commits)\/\S+)$/u;
const bareAttachmentPattern =
  /^https:\/\/github\.com\/user-attachments\/assets\/\S+$/u;

interface ChangelogReleaseData extends Record<string, unknown> {
  releaseId: number;
  url: string;
  tagName: string;
  name: string;
  title: string;
  prerelease: boolean;
  publishedAt: string;
}

function releaseId(release: GitHubRelease) {
  return release.tag_name.replaceAll("/", "-");
}

function releaseTitle(release: GitHubRelease) {
  const name = release.name?.trim() || release.tag_name;
  const tagPattern = new RegExp(
    String.raw`^${release.tag_name.replaceAll(/[.*+?^${}()|[\]\\]/gu, String.raw`\$&`)}(?:\s+-\s+|\s+)?`,
    "u",
  );
  const title = name.replace(tagPattern, "").trim();

  return title || release.tag_name;
}

function normalizeReleaseLine(value: string) {
  const fullChangelog = fullChangelogPattern.exec(value);

  if (fullChangelog) {
    return `[Compare changes](${fullChangelog[1]})`;
  }

  if (bareAttachmentPattern.test(value)) {
    return `[Release media](${value})`;
  }

  return value
    .replaceAll("[codex] ", "")
    .replaceAll(
      pullRequestUrlPattern,
      " ([#$2](https://github.com/TechSquidTV/Cliparr/pull/$2))",
    );
}

function normalizeReleaseBody(markdown: string) {
  return markdown
    .replaceAll("\r\n", "\n")
    .split("\n")
    .map((line) => normalizeReleaseLine(line.trimEnd()))
    .join("\n")
    .trim();
}

async function fetchGitHubReleases() {
  const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;

  if (process.env.CF_PAGES && !token) {
    throw new Error(
      "GITHUB_TOKEN or GH_TOKEN is required for Cloudflare Pages builds that mirror GitHub Releases.",
    );
  }

  const response = await fetch(releasesApiUrl, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "cliparr-dev-site",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });

  if (!response.ok) {
    throw new Error(
      `Failed to load GitHub releases for ${site.name}: ${response.status} ${await response.text()}`,
    );
  }

  return (await response.json()) as GitHubRelease[];
}

export function githubReleasesLoader(): Loader {
  return {
    name: "cliparr-github-releases",
    async load(loaderContext) {
      const releases = await fetchGitHubReleases();

      loaderContext.store.clear();

      for (const release of releases) {
        if (release.draft || !release.published_at) {
          continue;
        }

        const id = releaseId(release);
        const body = normalizeReleaseBody(release.body ?? "");
        const data = await loaderContext.parseData<ChangelogReleaseData>({
          id,
          data: {
            releaseId: release.id,
            url: release.html_url,
            tagName: release.tag_name,
            name: release.name?.trim() || release.tag_name,
            title: releaseTitle(release),
            prerelease: release.prerelease,
            publishedAt: release.published_at,
          },
        });

        loaderContext.store.set({
          id,
          data,
          body,
          rendered: await loaderContext.renderMarkdown(body),
          digest: loaderContext.generateDigest({ data, body }),
        });
      }
    },
  };
}
