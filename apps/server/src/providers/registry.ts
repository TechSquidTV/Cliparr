import type { ProviderImplementation } from "#/providers/types.js";
import { jellyfinProvider } from "#/providers/jellyfin/provider.js";
import { plexProvider } from "#/providers/plex/provider.js";

const providers = new Map<string, ProviderImplementation>();

function registerProvider(provider: ProviderImplementation) {
  providers.set(provider.definition.id, provider);
}

export function getProvider(providerId: string) {
  return providers.get(providerId);
}

export function listProviders() {
  return Array.from(providers.values()).map((provider) => provider.definition);
}

registerProvider(plexProvider);
registerProvider(jellyfinProvider);
