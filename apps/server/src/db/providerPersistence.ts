import { ApiError } from "../http/errors.js";
import type { ProviderConnection, ProviderDefinition, ProviderResource } from "../providers/types.js";
import { upsertMediaSource } from "./mediaSourcesRepository.js";
import { upsertProviderAccountByAccessToken } from "./providerAccountsRepository.js";

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

  for (const resource of input.resources) {
    persistProviderResource({
      providerId: input.provider.id,
      providerAccountId: account.id,
      resource,
    });
  }

  return account;
}

export function persistProviderResource(input: {
  providerId: string;
  providerAccountId: string;
  resource: ProviderResource;
  selectedConnection?: ProviderConnection;
}) {
  const connection = preferredConnection(input.resource, input.selectedConnection);
  if (!connection) {
    return undefined;
  }

  return upsertMediaSource({
    providerId: input.providerId,
    providerAccountId: input.providerAccountId,
    externalId: input.resource.id,
    name: input.resource.name,
    enabled: true,
    baseUrl: connection.uri,
    connection: {
      connections: input.resource.connections,
      selectedConnectionId: connection.id,
    },
    credentials: {
      accessToken: input.resource.accessToken,
    },
    metadata: {
      product: input.resource.product,
      platform: input.resource.platform,
      owned: input.resource.owned,
    },
  });
}
