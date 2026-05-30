import type { MediaSource, MediaSourceCheckResult } from "../providers/types";
import type { Feedback, SourceFilter } from "./sourcesModalTypes";

function compareStrings(left: string, right: string) {
  return left.localeCompare(right, undefined, { sensitivity: "base" });
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function formatProviderNameForSort(providerId: string) {
  return providerId
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");
}

export function sortSources(sources: MediaSource[]) {
  return [...sources].sort(
    (left, right) =>
      compareStrings(
        formatProviderNameForSort(left.providerId),
        formatProviderNameForSort(right.providerId),
      ) ||
      compareStrings(left.name, right.name) ||
      compareStrings(left.id, right.id),
  );
}

export function draftBaseUrlsFor(sources: readonly MediaSource[]) {
  return Object.fromEntries(
    sources.map((source) => [source.id, source.baseUrl]),
  );
}

export function draftNamesFor(sources: readonly MediaSource[]) {
  return Object.fromEntries(sources.map((source) => [source.id, source.name]));
}

export function buildSourceEditInput(
  source: MediaSource,
  draftNames: Record<string, string>,
  draftBaseUrls: Record<string, string>,
) {
  const nextName = (draftNames[source.id] ?? source.name).trim();
  const nextBaseUrl = (draftBaseUrls[source.id] ?? source.baseUrl).trim();
  const hasNameChange = Boolean(nextName) && nextName !== source.name;
  const hasBaseUrlChange =
    Boolean(nextBaseUrl) && nextBaseUrl !== source.baseUrl;

  return {
    ...(hasNameChange ? { name: nextName } : {}),
    ...(hasBaseUrlChange ? { baseUrl: nextBaseUrl } : {}),
  };
}

export function sourceCounts(sources: readonly MediaSource[]) {
  return {
    all: sources.length,
    enabled: sources.filter((source) => source.enabled).length,
    disabled: sources.filter((source) => !source.enabled).length,
    attention: sources.filter((source) => Boolean(source.lastError)).length,
  };
}

export function sourceProviderOptions(sources: readonly MediaSource[]) {
  const providers = [...new Set(sources.map((source) => source.providerId))];
  return providers.sort(compareStrings);
}

export function filterSources({
  sources,
  providerFilter,
  statusFilter,
  query,
}: {
  sources: readonly MediaSource[];
  providerFilter: string;
  statusFilter: SourceFilter;
  query: string;
}) {
  const normalizedQuery = query.trim().toLowerCase();

  return sources.filter((source) => {
    if (providerFilter !== "all" && source.providerId !== providerFilter) {
      return false;
    }

    if (statusFilter === "enabled" && !source.enabled) {
      return false;
    }

    if (statusFilter === "disabled" && source.enabled) {
      return false;
    }

    if (statusFilter === "attention" && !source.lastError) {
      return false;
    }

    if (!normalizedQuery) {
      return true;
    }

    const haystack = [
      source.name,
      source.baseUrl,
      source.providerId,
      stringValue(source.metadata.product),
      stringValue(source.metadata.platform),
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    return haystack.includes(normalizedQuery);
  });
}

export function mergeRefreshAllSourceResults(
  sources: readonly MediaSource[],
  results: readonly PromiseSettledResult<{
    source: MediaSource;
    result: MediaSourceCheckResult;
  }>[],
) {
  const nextSources = new Map(sources.map((source) => [source.id, source]));
  let healthyCount = 0;
  let attentionCount = 0;
  let failedCount = 0;

  results.forEach((entry, index) => {
    const currentSource = sources[index];
    if (!currentSource) {
      return;
    }

    if (entry.status === "fulfilled") {
      nextSources.set(entry.value.result.source.id, entry.value.result.source);
      if (entry.value.result.ok) {
        healthyCount += 1;
      } else {
        attentionCount += 1;
      }
      return;
    }

    failedCount += 1;
  });

  const summaryParts = [
    `${healthyCount} healthy`,
    `${attentionCount} need attention`,
  ];
  if (failedCount > 0) {
    summaryParts.push(`${failedCount} failed`);
  }

  return {
    sources: sortSources([...nextSources.values()]),
    feedback: {
      tone: attentionCount > 0 || failedCount > 0 ? "warning" : "success",
      message: `Refreshed ${sources.length} source${sources.length === 1 ? "" : "s"}. ${summaryParts.join(", ")}.`,
    } satisfies Feedback,
  };
}
