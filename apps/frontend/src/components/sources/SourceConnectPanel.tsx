import type { ProviderSession } from "@cliparr/shared/providers";

import ProviderConnectFlow from "@/components/provider-connect/ProviderConnectFlow";

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
