import { Film, Server } from "lucide-react";
import { cn } from "@/lib/utilities";

const plexLogoUrl = new URL("../../assets/providers/plex.svg", import.meta.url)
  .href;
const jellyfinLogoUrl = new URL(
  "../../assets/providers/jellyfin.svg",
  import.meta.url,
).href;

export function formatProviderName(providerId: string) {
  return providerId
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");
}

function providerBranding(providerId: string) {
  switch (providerId) {
    case "plex": {
      return {
        Icon: Film,
        logoUrl: plexLogoUrl,
      };
    }
    case "jellyfin": {
      return {
        Icon: Server,
        logoUrl: jellyfinLogoUrl,
      };
    }
    default: {
      return {
        Icon: Server,
        logoUrl: "",
      };
    }
  }
}

interface ProviderGlyphProperties {
  providerId: string;
  providerName?: string;
  className?: string;
  fallbackClassName?: string;
}

export function ProviderGlyph({
  providerId,
  providerName,
  className,
  fallbackClassName,
}: ProviderGlyphProperties) {
  const { Icon, logoUrl } = providerBranding(providerId);
  const label = providerName ?? formatProviderName(providerId);

  if (logoUrl) {
    return (
      <img
        src={logoUrl}
        alt={`${label} logo`}
        className={cn("h-5 w-5 object-contain", className)}
        width="20"
        height="20"
        decoding="async"
      />
    );
  }

  return (
    <Icon
      className={cn(
        "h-5 w-5 text-muted-foreground",
        fallbackClassName,
        className,
      )}
    />
  );
}
