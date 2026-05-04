import { ApiError } from "../http/errors.js";
import type { ProviderConnection, ProviderDefinition, ProviderResource } from "../providers/types.js";
import {
  getMediaSourceByProviderExternalId,
  listMediaSources,
  updateMediaSource,
  upsertMediaSource,
} from "./mediaSourcesRepository.js";
import { upsertProviderAccountByAccessToken } from "./providerAccountsRepository.js";
import {
  plexBaseUrlMode,
  PLEX_BASE_URL_MODE_AUTO,
  PLEX_BASE_URL_MODE_MANUAL,
  withPlexBaseUrlMode,
} from "../providers/plex/connectionState.js";

function connectionRank(connection: ProviderConnection) {
  if (connection.local && !connection.relay) {
    return 0;
  }
  if (!connection.relay) {
    return 1;
  }
  return 2;
}

function preferredConnection(resource: ProviderResource, selectedConnection?: ProviderConnection) {
  if (selectedConnection) {
    return selectedConnection;
  }

  return [...resource.connections].sort((left, right) => connectionRank(left) - connectionRank(right))[0];
}

export function persistProviderAuth(input: {
  provider: ProviderDefinition;
  userToken: string;
  resources: ProviderResource[];
}) {
  const account = upsertProviderAccountByAccessToken({
    providerId: input.provider.id,
    label: `${input.provider.name} Account`,
    accessToken: input.userToken,
    metadata: {
      resourceCount: input.resources.length,
      lastAuthenticatedAt: new Date().toISOString(),
    },
  });

  if (!account) {
    throw new ApiError(500, "provider_account_not_saved", "Provider account could not be saved");
  }

  const activeResourceIds = new Set(input.resources.map((resource) => resource.id));
  const staleSources = listMediaSources({
    providerId: input.provider.id,
    providerAccountId: account.id,
  }).filter((source) =>
    typeof source.externalId === "string"
    && !activeResourceIds.has(source.externalId)
    && source.enabled
  );

  for (const source of staleSources) {
    updateMediaSource(source.id, { enabled: false });
  }

  for (const resource of input.resources) {
    persistProviderResource({
      providerId: input.provider.id,
      providerAccountId: account.id,
      resource,
    });
  }

  return account;
}

function persistProviderResource(input: {
  providerId: string;
  providerAccountId: string;
  resource: ProviderResource;
  selectedConnection?: ProviderConnection;
}) {
  const existingSource = getMediaSourceByProviderExternalId(
    input.providerId,
    input.providerAccountId,
    input.resource.id
  );
  const connection = preferredConnection(input.resource, input.selectedConnection);
  if (!connection) {
    return undefined;
  }

  const baseUrlMode = input.providerId === "plex" && existingSource
    ? plexBaseUrlMode(existingSource.connection)
    : PLEX_BASE_URL_MODE_AUTO;
  const nextBaseUrl = input.providerId === "plex" && baseUrlMode === PLEX_BASE_URL_MODE_MANUAL && existingSource
    ? existingSource.baseUrl
    : connection.uri;
  const nextConnection = input.providerId === "plex"
    ? withPlexBaseUrlMode({
      connections: input.resource.connections,
      selectedConnectionId: connection.id,
    }, baseUrlMode)
    : {
      connections: input.resource.connections,
      selectedConnectionId: connection.id,
    };

  return upsertMediaSource({
    providerId: input.providerId,
    providerAccountId: input.providerAccountId,
    externalId: input.resource.id,
    name: input.resource.name,
    enabled: true,
    baseUrl: nextBaseUrl,
    connection: nextConnection,
    credentials: {
      ...(input.resource.credentials ?? {}),
      accessToken: input.resource.accessToken,
    },
    metadata: {
      ...(input.resource.metadata ?? {}),
      product: input.resource.product,
      platform: input.resource.platform,
      provides: input.resource.provides,
      owned: input.resource.owned,
    },
  });
}
