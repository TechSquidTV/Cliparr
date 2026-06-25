import { eq } from "drizzle-orm";
import {
  compactLogFields,
  logDurationFields,
  logEventFields,
} from "@cliparr/shared/logging";
import { getDatabase } from "@/db/database";
import {
  deleteMediaSource,
  listMediaSources,
  type MediaSource,
  updateMediaSource,
} from "@/db/mediaSourcesRepository";
import {
  deleteProviderAccount,
  getProviderAccount,
  type ProviderAccount,
  updateProviderAccount,
} from "@/db/providerAccountsRepository";
import { currentTimestampSql } from "@/db/timestamps";
import {
  mediaSources,
  rememberedProviderSessions,
  providerSessions,
} from "@/db/schema";
import {
  plexBaseUrlMode,
  PLEX_BASE_URL_MODE_MANUAL,
  withPlexBaseUrlMode,
} from "@/providers/plex/connectionState";
import {
  plexSourceIdentity,
  type PlexSourceIdentity,
} from "@/providers/plex/sourceIdentity";
import { getServerLogger } from "@/logging";

const PLEX_PROVIDER_ID = "plex";
const logger = getServerLogger(["db"]);

interface SourceIdentity {
  source: MediaSource;
  identity: PlexSourceIdentity;
}

interface DuplicateGroupPlan {
  group: MediaSource[];
  canonical: MediaSource;
}

interface CleanupResult {
  providerAccountId?: string;
  duplicateSourceCount: number;
  reassignedSourceCount: number;
  deletedAccountCount: number;
  reassignedProviderSessionCount: number;
  reassignedRememberedSessionCount: number;
}

function timestampMs(value: string | undefined, fallback: number) {
  if (!value) {
    return fallback;
  }

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function sourceUsesManualPlexUrl(source: MediaSource) {
  return plexBaseUrlMode(source.connection) === PLEX_BASE_URL_MODE_MANUAL;
}

function hasHealthHistory(source: MediaSource) {
  return Boolean(source.lastCheckedAt);
}

function compareCanonicalSources(
  left: MediaSource,
  right: MediaSource,
  newlyAuthenticatedAccountId?: string,
) {
  const leftManual = sourceUsesManualPlexUrl(left);
  const rightManual = sourceUsesManualPlexUrl(right);
  if (leftManual !== rightManual) {
    return leftManual ? -1 : 1;
  }

  if (left.enabled !== right.enabled) {
    return left.enabled ? -1 : 1;
  }

  const leftChecked = hasHealthHistory(left);
  const rightChecked = hasHealthHistory(right);
  if (leftChecked !== rightChecked) {
    return leftChecked ? -1 : 1;
  }

  // Fresh auth rows carry newer tokens, but existing rows are safer canonicals.
  if (
    newlyAuthenticatedAccountId &&
    left.providerAccountId !== right.providerAccountId
  ) {
    const leftNewlyAuthenticated =
      left.providerAccountId === newlyAuthenticatedAccountId;
    const rightNewlyAuthenticated =
      right.providerAccountId === newlyAuthenticatedAccountId;
    if (leftNewlyAuthenticated !== rightNewlyAuthenticated) {
      return leftNewlyAuthenticated ? 1 : -1;
    }
  }

  const createdDifference =
    timestampMs(left.createdAt, Number.POSITIVE_INFINITY) -
    timestampMs(right.createdAt, Number.POSITIVE_INFINITY);
  if (createdDifference !== 0) {
    return createdDifference;
  }

  const updatedDifference =
    timestampMs(right.updatedAt, Number.NEGATIVE_INFINITY) -
    timestampMs(left.updatedAt, Number.NEGATIVE_INFINITY);
  if (updatedDifference !== 0) {
    return updatedDifference;
  }

  return left.id.localeCompare(right.id);
}

function compareCanonicalAccounts(
  left: ProviderAccount,
  right: ProviderAccount,
) {
  const createdDifference =
    timestampMs(left.createdAt, Number.POSITIVE_INFINITY) -
    timestampMs(right.createdAt, Number.POSITIVE_INFINITY);
  if (createdDifference !== 0) {
    return createdDifference;
  }

  const updatedDifference =
    timestampMs(right.updatedAt, Number.NEGATIVE_INFINITY) -
    timestampMs(left.updatedAt, Number.NEGATIVE_INFINITY);
  if (updatedDifference !== 0) {
    return updatedDifference;
  }

  return left.id.localeCompare(right.id);
}

function latestUpdatedSource(sources: MediaSource[]) {
  return sources.toSorted(
    (left, right) =>
      timestampMs(right.updatedAt, Number.NEGATIVE_INFINITY) -
      timestampMs(left.updatedAt, Number.NEGATIVE_INFINITY),
  )[0];
}

function latestUpdatedAccount(accounts: ProviderAccount[]) {
  return accounts.toSorted(
    (left, right) =>
      timestampMs(right.updatedAt, Number.NEGATIVE_INFINITY) -
      timestampMs(left.updatedAt, Number.NEGATIVE_INFINITY),
  )[0];
}

function latestCheckedSource(sources: MediaSource[]) {
  return sources
    .filter((source) => source.lastCheckedAt)
    .toSorted(
      (left, right) =>
        timestampMs(right.lastCheckedAt, Number.NEGATIVE_INFINITY) -
        timestampMs(left.lastCheckedAt, Number.NEGATIVE_INFINITY),
    )[0];
}

function mergeDataSource(
  canonical: MediaSource,
  sources: MediaSource[],
  newlyAuthenticatedAccountId?: string,
) {
  return (
    latestUpdatedSource(
      sources.filter(
        (source) => source.providerAccountId === newlyAuthenticatedAccountId,
      ),
    ) ??
    latestUpdatedSource(
      sources.filter(
        (source) => source.providerAccountId !== canonical.providerAccountId,
      ),
    ) ??
    latestUpdatedSource(sources) ??
    canonical
  );
}

function uniqueSorted(values: Iterable<string | undefined>) {
  return [
    ...new Set(
      [...values].filter((value): value is string => value !== undefined),
    ),
  ].toSorted();
}

function groupDuplicateSources(sources: MediaSource[]) {
  const identities = sources
    .map(
      (source): SourceIdentity => ({
        source,
        identity: plexSourceIdentity(source),
      }),
    )
    .filter(
      ({ identity }) =>
        identity.resourceKey !== undefined || identity.urlKeys.length > 0,
    );
  const parents = new Map<string, string>();

  for (const { source } of identities) {
    parents.set(source.id, source.id);
  }

  function find(sourceId: string): string {
    const parent = parents.get(sourceId) ?? sourceId;
    if (parent === sourceId) {
      return parent;
    }

    const root = find(parent);
    parents.set(sourceId, root);
    return root;
  }

  function union(left: string, right: string) {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot !== rightRoot) {
      parents.set(rightRoot, leftRoot);
    }
  }

  const sourceIdByResourceKey = new Map<string, string>();
  const identitiesByUrlKey = new Map<string, SourceIdentity[]>();
  for (const identity of identities) {
    const { source } = identity;
    if (identity.identity.resourceKey) {
      const existingSourceId = sourceIdByResourceKey.get(
        identity.identity.resourceKey,
      );
      if (existingSourceId) {
        union(existingSourceId, source.id);
      } else {
        sourceIdByResourceKey.set(identity.identity.resourceKey, source.id);
      }
    }

    for (const urlKey of identity.identity.urlKeys) {
      const urlGroup = identitiesByUrlKey.get(urlKey) ?? [];
      urlGroup.push(identity);
      identitiesByUrlKey.set(urlKey, urlGroup);
    }
  }

  for (const urlGroup of identitiesByUrlKey.values()) {
    const resourceKeys = uniqueSorted(
      urlGroup.map(({ identity }) => identity.resourceKey),
    );
    if (resourceKeys.length > 1) {
      continue;
    }

    const first = urlGroup[0];
    if (!first) {
      continue;
    }

    for (const { source } of urlGroup.slice(1)) {
      union(first.source.id, source.id);
    }
  }

  const groups = new Map<string, MediaSource[]>();
  for (const { source } of identities) {
    const root = find(source.id);
    const group = groups.get(root) ?? [];
    group.push(source);
    groups.set(root, group);
  }

  return [...groups.values()].filter((group) => group.length > 1);
}

function mergeCanonicalSource(
  canonical: MediaSource,
  sources: MediaSource[],
  newlyAuthenticatedAccountId?: string,
) {
  const latest = mergeDataSource(
    canonical,
    sources,
    newlyAuthenticatedAccountId,
  );
  const checked = latestCheckedSource(sources);
  const manual = sourceUsesManualPlexUrl(canonical);

  return updateMediaSource(canonical.id, {
    enabled: sources.some((source) => source.enabled),
    baseUrl: manual ? canonical.baseUrl : latest.baseUrl,
    connection: manual
      ? withPlexBaseUrlMode(latest.connection, PLEX_BASE_URL_MODE_MANUAL)
      : latest.connection,
    credentials: latest.credentials,
    metadata: {
      ...canonical.metadata,
      ...latest.metadata,
    },
    ...(checked
      ? {
          lastCheckedAt: checked.lastCheckedAt ?? null,
          lastError: checked.lastError ?? null,
        }
      : {}),
  });
}

function providerAccountSourceMetadata(providerAccountId: string) {
  const sources = listMediaSources({
    providerId: PLEX_PROVIDER_ID,
    providerAccountId,
  });

  return {
    resourceCount: sources.length,
    resourceIds: uniqueSorted(sources.map((source) => source.externalId)),
  };
}

function buildAccountMergePlan(duplicateGroups: DuplicateGroupPlan[]) {
  const accountIds = uniqueSorted(
    duplicateGroups.flatMap(({ group }) =>
      group.map((source) => source.providerAccountId),
    ),
  );
  const canonicalAccountRank = new Map<string, number>();
  const parents = new Map<string, string>();

  for (const accountId of accountIds) {
    parents.set(accountId, accountId);
  }

  function find(accountId: string): string {
    const parent = parents.get(accountId) ?? accountId;
    if (parent === accountId) {
      return parent;
    }

    const root = find(parent);
    parents.set(accountId, root);
    return root;
  }

  function union(left: string, right: string) {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot !== rightRoot) {
      parents.set(rightRoot, leftRoot);
    }
  }

  for (const [index, { canonical, group }] of duplicateGroups.entries()) {
    if (!canonicalAccountRank.has(canonical.providerAccountId)) {
      canonicalAccountRank.set(canonical.providerAccountId, index);
    }

    const [first, ...rest] = group;
    if (!first) {
      continue;
    }

    for (const source of rest) {
      union(first.providerAccountId, source.providerAccountId);
    }
  }

  const accountsByRoot = new Map<string, ProviderAccount[]>();
  for (const accountId of accountIds) {
    const account = getProviderAccount(accountId);
    if (!account) {
      continue;
    }

    const root = find(accountId);
    const accounts = accountsByRoot.get(root) ?? [];
    accounts.push(account);
    accountsByRoot.set(root, accounts);
  }

  const canonicalAccountIdByAccountId = new Map<string, string>();
  const componentAccountsByCanonicalId = new Map<string, ProviderAccount[]>();
  for (const accounts of accountsByRoot.values()) {
    const canonicalAccount = accounts.toSorted((left, right) => {
      const leftRank =
        canonicalAccountRank.get(left.id) ?? Number.POSITIVE_INFINITY;
      const rightRank =
        canonicalAccountRank.get(right.id) ?? Number.POSITIVE_INFINITY;
      if (leftRank !== rightRank) {
        return leftRank - rightRank;
      }

      return compareCanonicalAccounts(left, right);
    })[0];
    if (!canonicalAccount) {
      continue;
    }

    for (const account of accounts) {
      canonicalAccountIdByAccountId.set(account.id, canonicalAccount.id);
    }
    componentAccountsByCanonicalId.set(canonicalAccount.id, accounts);
  }

  return {
    canonicalAccountIdByAccountId,
    componentAccountsByCanonicalId,
  };
}

function reassignProviderAccountReferences(
  fromAccountId: string,
  toAccountId: string,
) {
  const db = getDatabase();
  const sessionResult = db
    .update(providerSessions)
    .set({
      providerAccountId: toAccountId,
      updatedAt: currentTimestampSql(),
    })
    .where(eq(providerSessions.providerAccountId, fromAccountId))
    .run();
  const rememberedResult = db
    .update(rememberedProviderSessions)
    .set({
      providerAccountId: toAccountId,
      updatedAt: currentTimestampSql(),
    })
    .where(eq(rememberedProviderSessions.providerAccountId, fromAccountId))
    .run();

  return {
    providerSessionCount: Number(sessionResult.changes),
    rememberedSessionCount: Number(rememberedResult.changes),
  };
}

function reassignMediaSourcesForProviderAccount(
  fromAccountId: string,
  toAccountId: string,
) {
  const result = getDatabase()
    .update(mediaSources)
    .set({
      providerAccountId: toAccountId,
      updatedAt: currentTimestampSql(),
    })
    .where(eq(mediaSources.providerAccountId, fromAccountId))
    .run();

  return Number(result.changes);
}

function updateMergedProviderAccount(
  canonicalAccountId: string,
  accounts: ProviderAccount[],
  newlyAuthenticatedAccountId?: string,
) {
  const canonicalAccount = getProviderAccount(canonicalAccountId);
  if (!canonicalAccount) {
    return;
  }

  const latestAccount =
    accounts.find((account) => account.id === newlyAuthenticatedAccountId) ??
    latestUpdatedAccount(accounts) ??
    canonicalAccount;
  updateProviderAccount(canonicalAccountId, {
    label: canonicalAccount.label,
    accessToken: latestAccount.accessToken,
    metadata: {
      ...canonicalAccount.metadata,
      ...latestAccount.metadata,
      ...providerAccountSourceMetadata(canonicalAccountId),
    },
  });
}

function resolveCanonicalAccountId(
  accountId: string | undefined,
  canonicalAccountIdByAccountId: Map<string, string>,
) {
  if (!accountId) {
    return;
  }

  return canonicalAccountIdByAccountId.get(accountId) ?? accountId;
}

function cleanupDuplicatePlexSourcesInTransaction(
  options: {
    newlyAuthenticatedAccountId?: string;
  } = {},
): CleanupResult {
  const startedAt = Date.now();
  const sources = listMediaSources({ providerId: PLEX_PROVIDER_ID });
  const duplicateGroups = groupDuplicateSources(sources);
  const duplicateGroupPlans = duplicateGroups
    .map((group): DuplicateGroupPlan | undefined => {
      const canonical = group.toSorted((left, right) =>
        compareCanonicalSources(
          left,
          right,
          options.newlyAuthenticatedAccountId,
        ),
      )[0];
      return canonical ? { group, canonical } : undefined;
    })
    .filter((plan): plan is DuplicateGroupPlan => plan !== undefined);
  const { canonicalAccountIdByAccountId, componentAccountsByCanonicalId } =
    buildAccountMergePlan(duplicateGroupPlans);
  let duplicateSourceCount = 0;
  let reassignedSourceCount = 0;
  let deletedAccountCount = 0;
  let reassignedProviderSessionCount = 0;
  let reassignedRememberedSessionCount = 0;

  for (const { canonical, group } of duplicateGroupPlans) {
    mergeCanonicalSource(canonical, group, options.newlyAuthenticatedAccountId);

    for (const source of group) {
      if (source.id === canonical.id) {
        continue;
      }

      deleteMediaSource(source.id);
      duplicateSourceCount += 1;
    }
  }

  const nonCanonicalAccountIds = uniqueSorted(
    [...canonicalAccountIdByAccountId.entries()]
      .filter(
        ([accountId, canonicalAccountId]) => accountId !== canonicalAccountId,
      )
      .map(([accountId]) => accountId),
  );
  for (const accountId of nonCanonicalAccountIds) {
    const redirectedAccountId = canonicalAccountIdByAccountId.get(accountId);
    if (!redirectedAccountId) {
      continue;
    }

    reassignedSourceCount += reassignMediaSourcesForProviderAccount(
      accountId,
      redirectedAccountId,
    );
    const reassigned = reassignProviderAccountReferences(
      accountId,
      redirectedAccountId,
    );
    reassignedProviderSessionCount += reassigned.providerSessionCount;
    reassignedRememberedSessionCount += reassigned.rememberedSessionCount;
    if (deleteProviderAccount(accountId)) {
      deletedAccountCount += 1;
    }
  }

  for (const [canonicalAccountId, accounts] of componentAccountsByCanonicalId) {
    updateMergedProviderAccount(
      canonicalAccountId,
      accounts,
      options.newlyAuthenticatedAccountId,
    );
  }

  const providerAccountId = resolveCanonicalAccountId(
    options.newlyAuthenticatedAccountId,
    canonicalAccountIdByAccountId,
  );

  if (duplicateSourceCount > 0) {
    logger.info("Cleaned up duplicate Plex sources.", {
      ...logEventFields("db.plex_source_dedupe", "success"),
      ...logDurationFields(startedAt),
      ...compactLogFields({
        "provider.id": PLEX_PROVIDER_ID,
        "source.duplicate_group.count": duplicateGroups.length,
        "source.deleted_count": duplicateSourceCount,
        "source.reassigned_count": reassignedSourceCount,
        "provider.account.deleted_count": deletedAccountCount,
        "provider.session.reassigned_count": reassignedProviderSessionCount,
        "session.remembered.reassigned_count": reassignedRememberedSessionCount,
      }),
    });
  }

  return {
    providerAccountId:
      providerAccountId && getProviderAccount(providerAccountId)
        ? providerAccountId
        : undefined,
    duplicateSourceCount,
    reassignedSourceCount,
    deletedAccountCount,
    reassignedProviderSessionCount,
    reassignedRememberedSessionCount,
  };
}

export function cleanupDuplicatePlexSources(
  options: {
    newlyAuthenticatedAccountId?: string;
  } = {},
): CleanupResult {
  return getDatabase().transaction(() =>
    cleanupDuplicatePlexSourcesInTransaction(options),
  );
}
