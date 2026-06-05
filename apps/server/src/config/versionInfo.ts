import {
  compactLogFields,
  logDurationFields,
  logErrorFields,
  logEventFields,
} from "@cliparr/shared/logging";
import { CLIPARR_CLIENT_VERSION } from "@/config/version";
import { getServerLogger, warnWithError } from "@/logging";

type VersionInfoStatus =
  | "current"
  | "update_available"
  | "unknown"
  | "unavailable";

interface LatestReleaseInfo {
  tagName: string;
  url: string;
  publishedAt: string;
}

export interface CliparrVersionInfo {
  currentVersion?: string;
  latestRelease?: LatestReleaseInfo;
  updateAvailable: boolean;
  checkedAt?: string;
  status: VersionInfoStatus;
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

interface SemverVersion {
  major: number;
  minor: number;
  patch: number;
}

interface ReleaseCheckResult {
  checkedAt: number;
  expiresAt: number;
  release?: LatestReleaseInfo;
}

interface VersionInfoServiceOptions {
  currentVersion?: string;
  failureCacheTtlMs?: number;
  fetchImpl?: FetchLike;
  latestReleaseApiUrl?: string;
  now?: () => number;
  releaseCheckTimeoutMs?: number;
  successCacheTtlMs?: number;
}

const LATEST_RELEASE_API_URL =
  "https://api.github.com/repos/TechSquidTV/Cliparr/releases/latest";
const SUCCESS_CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const FAILURE_CACHE_TTL_MS = 60 * 60 * 1000;
const RELEASE_CHECK_TIMEOUT_MS = 10_000;
const GITHUB_API_VERSION = "2022-11-28";
const STABLE_SEMVER_TAG_PATTERN =
  /^v?(?<major>0|[1-9]\d*)\.(?<minor>0|[1-9]\d*)\.(?<patch>0|[1-9]\d*)$/u;
const logger = getServerLogger("lifecycle");

function normalizeVersion(value: string | undefined) {
  const normalized = value?.trim();
  return normalized || undefined;
}

export function parseStableSemverTag(tag: string) {
  const match = STABLE_SEMVER_TAG_PATTERN.exec(tag.trim());
  if (!match?.groups) {
    return undefined;
  }

  return {
    major: Number(match.groups.major),
    minor: Number(match.groups.minor),
    patch: Number(match.groups.patch),
  } satisfies SemverVersion;
}

function compareSemverVersions(left: SemverVersion, right: SemverVersion) {
  if (left.major !== right.major) {
    return left.major - right.major;
  }

  if (left.minor !== right.minor) {
    return left.minor - right.minor;
  }

  return left.patch - right.patch;
}

function latestReleaseFromPayload(payload: unknown) {
  if (!payload || typeof payload !== "object") {
    return undefined;
  }

  const release = payload as Record<string, unknown>;
  if (
    typeof release.tag_name !== "string" ||
    typeof release.html_url !== "string" ||
    typeof release.published_at !== "string"
  ) {
    return undefined;
  }

  return {
    tagName: release.tag_name,
    url: release.html_url,
    publishedAt: release.published_at,
  } satisfies LatestReleaseInfo;
}

function parseRetryAfterExpiresAt(value: string | null, now: number) {
  if (!value) {
    return undefined;
  }

  const retrySeconds = Number(value);
  if (Number.isFinite(retrySeconds) && retrySeconds > 0) {
    return now + retrySeconds * 1000;
  }

  const retryDate = Date.parse(value);
  if (Number.isFinite(retryDate) && retryDate > now) {
    return retryDate;
  }

  return undefined;
}

function parseRateLimitResetExpiresAt(value: string | null, now: number) {
  if (!value) {
    return undefined;
  }

  const resetSeconds = Number(value);
  if (!Number.isFinite(resetSeconds)) {
    return undefined;
  }

  const resetAt = resetSeconds * 1000;
  return resetAt > now ? resetAt : undefined;
}

function failureExpiresAt(
  response: Response | undefined,
  now: number,
  fallbackTtlMs: number,
) {
  return (
    parseRetryAfterExpiresAt(
      response?.headers.get("retry-after") ?? null,
      now,
    ) ??
    parseRateLimitResetExpiresAt(
      response?.headers.get("x-ratelimit-reset") ?? null,
      now,
    ) ??
    now + fallbackTtlMs
  );
}

function releaseCheckFailureFields({
  checkedAt,
  expiresAt,
  failedAt,
  reason,
  response,
}: {
  checkedAt: number;
  expiresAt: number;
  failedAt: number;
  reason: string;
  response?: Response;
}) {
  return compactLogFields({
    ...logEventFields("version.release_check", "failure"),
    ...logDurationFields(checkedAt, failedAt),
    "release.check.reason": reason,
    "release.check.retry_at": new Date(expiresAt).toISOString(),
    "http.status_code": response?.status,
    "github.retry_after": response?.headers.get("retry-after") ?? undefined,
    "github.rate_limit.reset":
      response?.headers.get("x-ratelimit-reset") ?? undefined,
  });
}

async function fetchWithTimeout(
  fetchImpl: FetchLike,
  latestReleaseApiUrl: string,
  timeoutMs: number,
) {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;

  if (timeoutMs > 0) {
    timeout = setTimeout(() => {
      const timeoutError = new Error("GitHub release check timed out");
      timeoutError.name = "TimeoutError";
      controller.abort(timeoutError);
    }, timeoutMs);
  }

  try {
    return await fetchImpl(latestReleaseApiUrl, {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "Cliparr",
        "X-GitHub-Api-Version": GITHUB_API_VERSION,
      },
      signal: controller.signal,
    });
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

async function fetchLatestReleaseCheck({
  failureCacheTtlMs,
  fetchImpl,
  latestReleaseApiUrl,
  now,
  releaseCheckTimeoutMs,
  successCacheTtlMs,
}: Required<Omit<VersionInfoServiceOptions, "currentVersion">>) {
  const checkedAt = now();

  try {
    const response = await fetchWithTimeout(
      fetchImpl,
      latestReleaseApiUrl,
      releaseCheckTimeoutMs,
    );

    if (!response.ok) {
      const failedAt = now();
      const expiresAt = failureExpiresAt(response, failedAt, failureCacheTtlMs);
      logger.warn(
        "GitHub release check failed.",
        releaseCheckFailureFields({
          checkedAt,
          expiresAt,
          failedAt,
          reason: "github_http_error",
          response,
        }),
      );

      return {
        checkedAt,
        expiresAt,
      } satisfies ReleaseCheckResult;
    }

    const release = latestReleaseFromPayload(await response.json());
    if (!release) {
      const failedAt = now();
      const expiresAt = failedAt + failureCacheTtlMs;
      logger.warn(
        "GitHub release check returned an invalid payload.",
        releaseCheckFailureFields({
          checkedAt,
          expiresAt,
          failedAt,
          reason: "invalid_release_payload",
        }),
      );

      return {
        checkedAt,
        expiresAt,
      } satisfies ReleaseCheckResult;
    }

    return {
      checkedAt,
      expiresAt: checkedAt + successCacheTtlMs,
      release,
    } satisfies ReleaseCheckResult;
  } catch (err) {
    const failedAt = now();
    const expiresAt = failedAt + failureCacheTtlMs;
    warnWithError(logger, err, "GitHub release check failed.", {
      ...releaseCheckFailureFields({
        checkedAt,
        expiresAt,
        failedAt,
        reason: "request_error",
      }),
      ...logErrorFields(err),
    });

    return {
      checkedAt,
      expiresAt,
    } satisfies ReleaseCheckResult;
  }
}

function unknownVersionInfo(currentVersion: string | undefined) {
  return {
    ...(currentVersion ? { currentVersion } : {}),
    updateAvailable: false,
    status: "unknown",
  } satisfies CliparrVersionInfo;
}

function versionInfoFromReleaseCheck(
  currentVersion: string,
  currentSemver: SemverVersion,
  releaseCheck: ReleaseCheckResult,
) {
  const checkedAt = new Date(releaseCheck.checkedAt).toISOString();
  if (!releaseCheck.release) {
    return {
      currentVersion,
      updateAvailable: false,
      checkedAt,
      status: "unavailable",
    } satisfies CliparrVersionInfo;
  }

  const latestSemver = parseStableSemverTag(releaseCheck.release.tagName);
  if (!latestSemver) {
    return {
      currentVersion,
      latestRelease: releaseCheck.release,
      updateAvailable: false,
      checkedAt,
      status: "unknown",
    } satisfies CliparrVersionInfo;
  }

  const updateAvailable =
    compareSemverVersions(latestSemver, currentSemver) > 0;

  return {
    currentVersion,
    latestRelease: releaseCheck.release,
    updateAvailable,
    checkedAt,
    status: updateAvailable ? "update_available" : "current",
  } satisfies CliparrVersionInfo;
}

export function createVersionInfoService({
  currentVersion = CLIPARR_CLIENT_VERSION,
  failureCacheTtlMs = FAILURE_CACHE_TTL_MS,
  fetchImpl = fetch,
  latestReleaseApiUrl = LATEST_RELEASE_API_URL,
  now = Date.now,
  releaseCheckTimeoutMs = RELEASE_CHECK_TIMEOUT_MS,
  successCacheTtlMs = SUCCESS_CACHE_TTL_MS,
}: VersionInfoServiceOptions = {}) {
  let cachedReleaseCheck: ReleaseCheckResult | null = null;
  let inflightReleaseCheck: Promise<ReleaseCheckResult> | null = null;

  async function getLatestReleaseCheck() {
    const currentTime = now();
    if (cachedReleaseCheck && cachedReleaseCheck.expiresAt > currentTime) {
      return cachedReleaseCheck;
    }

    inflightReleaseCheck ??= fetchLatestReleaseCheck({
      failureCacheTtlMs,
      fetchImpl,
      latestReleaseApiUrl,
      now,
      releaseCheckTimeoutMs,
      successCacheTtlMs,
    })
      .then((releaseCheck) => {
        cachedReleaseCheck = releaseCheck;
        return releaseCheck;
      })
      .finally(() => {
        inflightReleaseCheck = null;
      });

    return inflightReleaseCheck;
  }

  return {
    async getVersionInfo(): Promise<CliparrVersionInfo> {
      const normalizedCurrentVersion = normalizeVersion(currentVersion);
      if (!normalizedCurrentVersion) {
        return unknownVersionInfo(undefined);
      }

      const currentSemver = parseStableSemverTag(normalizedCurrentVersion);
      if (!currentSemver) {
        return unknownVersionInfo(normalizedCurrentVersion);
      }

      const releaseCheck = await getLatestReleaseCheck();
      return versionInfoFromReleaseCheck(
        normalizedCurrentVersion,
        currentSemver,
        releaseCheck,
      );
    },
  };
}

export const versionInfoService = createVersionInfoService();
