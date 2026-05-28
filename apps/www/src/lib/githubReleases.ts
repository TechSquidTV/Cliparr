import { renderReleaseMarkdown } from "./markdown";
import { site } from "../data/product";

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

export interface ChangelogRelease {
  id: number;
  url: string;
  tagName: string;
  name: string;
  htmlBody: string;
  prerelease: boolean;
  publishedAt: Date;
}

const releasesApiUrl = "https://api.github.com/repos/TechSquidTV/Cliparr/releases?per_page=20";

export async function getChangelogReleases(): Promise<ChangelogRelease[]> {
  const token = import.meta.env.GITHUB_TOKEN;
  const response = await fetch(releasesApiUrl, {
    headers: {
      "Accept": "application/vnd.github+json",
      "User-Agent": "cliparr-dev-site",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(token ? { "Authorization": `Bearer ${token}` } : {}),
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to load GitHub releases for ${site.name}: ${response.status} ${await response.text()}`);
  }

  const releases = await response.json() as GitHubRelease[];

  return releases
    .filter((release) => !release.draft && release.published_at)
    .map((release) => ({
      id: release.id,
      url: release.html_url,
      tagName: release.tag_name,
      name: release.name?.trim() || release.tag_name,
      htmlBody: renderReleaseMarkdown(release.body ?? ""),
      prerelease: release.prerelease,
      publishedAt: new Date(release.published_at ?? ""),
    }));
}
