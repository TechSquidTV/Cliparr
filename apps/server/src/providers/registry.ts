import type { ProviderImplementation } from "./types.js";
import { plexProvider } from "./plex/provider.js";

const providers = new Map<string, ProviderImplementation>();

export function registerProvider(provider: ProviderImplementation) {
  providers.set(provider.definition.id, provider);
}

export function getProvider(providerId: string) {
  return providers.get(providerId);
}

export function listProviders() {
  return Array.from(providers.values()).map((provider) => provider.definition);
}

registerProvider(plexProvider);
