import type { ProviderConnection } from "@/providers/types";

export function connectionRank(connection: ProviderConnection) {
  if (connection.local && !connection.relay) {
    return 0;
  }
  if (!connection.relay) {
    return 1;
  }
  return 2;
}
