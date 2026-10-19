import type { ProviderImplementation } from "@/providers/types";

export function defineProvider(
  adapter: Omit<ProviderImplementation, "serializeSession">,
): ProviderImplementation {
  return {
    ...adapter,
    serializeSession: (session) => ({
      id: session.id,
      providerId: adapter.definition.id,
      expiresAt: new Date(session.expiresAt).toISOString(),
    }),
  };
}
