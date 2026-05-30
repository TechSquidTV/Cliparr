import ProviderConnectFlow from "../provider-connect/ProviderConnectFlow";
import type { ProviderSession } from "../../providers/types";

interface Props {
  onConnected: (session: ProviderSession) => Promise<void> | void;
  onCancel?: () => void;
}

export default function SourceConnectPanel({ onConnected, onCancel }: Props) {
  return (
    <ProviderConnectFlow
      variant="panel"
      onConnected={onConnected}
      onCancel={onCancel}
    />
  );
}
