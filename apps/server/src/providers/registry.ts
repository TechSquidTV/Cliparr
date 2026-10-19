import { jellyfinProvider } from "@/providers/jellyfin/provider";
import { localUrlProvider } from "@/providers/localUrl/provider";
import { plexProvider } from "@/providers/plex/provider";
import type { ProviderImplementation } from "@/providers/types";

const providers = new Map<string, ProviderImplementation>();

function registerProvider(provider: ProviderImplementation) {
  providers.set(provider.definition.id, provider);
}

export function getProvider(providerId: string) {
  return providers.get(providerId);
}

export function listProviders() {
  return [...providers.values()].map((provider) => provider.definition);
}

registerProvider(plexProvider);
registerProvider(jellyfinProvider);
registerProvider(localUrlProvider);
