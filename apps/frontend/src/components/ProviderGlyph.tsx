import { Film, Server } from "lucide-react";
import plexLogoUrl from "../assets/providers/plex.svg";
import jellyfinLogoUrl from "../assets/providers/jellyfin.svg";
import { cn } from "../lib/utils";

export function formatProviderName(providerId: string) {
  return providerId
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");
}

function providerBranding(providerId: string) {
  switch (providerId) {
    case "plex":
      return {
        Icon: Film,
        logoUrl: plexLogoUrl,
      };
    case "jellyfin":
      return {
        Icon: Server,
        logoUrl: jellyfinLogoUrl,
      };
    default:
      return {
        Icon: Server,
        logoUrl: "",
      };
  }
}

interface ProviderGlyphProps {
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
}: ProviderGlyphProps) {
  const { Icon, logoUrl } = providerBranding(providerId);
  const label = providerName ?? formatProviderName(providerId);

  if (logoUrl) {
    return (
      <img
        src={logoUrl}
        alt={`${label} logo`}
        className={cn("h-5 w-5 object-contain", className)}
      />
    );
  }

  return <Icon className={cn("h-5 w-5 text-muted-foreground", fallbackClassName, className)} />;
}
