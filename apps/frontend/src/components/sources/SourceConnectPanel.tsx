import ProviderConnectFlow from "@/components/provider-connect/ProviderConnectFlow";
import type { ProviderSession } from "@/providers/types";

interface Properties {
  onConnected: (session: ProviderSession) => Promise<void> | void;
  onCancel?: () => void;
}

export default function SourceConnectPanel({
  onConnected,
  onCancel,
}: Properties) {
  return (
    <ProviderConnectFlow
      variant="panel"
      onConnected={onConnected}
      onCancel={onCancel}
    />
  );
}
