import { site } from "@/data/product";

export type StructuredData = Record<string, unknown>;
export type StructuredDataInput = StructuredData | StructuredData[];

const organizationId = `${site.url}/#organization`;
const softwareApplicationId = `${site.url}/#software`;
const websiteId = `${site.url}/#website`;
const siteOrigin = new URL(site.url).origin;

export function absoluteSiteUrl(pathOrUrl: string | URL) {
  return new URL(String(pathOrUrl), site.url).toString();
}

export function canonicalSiteUrl(pathOrUrl: string | URL) {
  const url = new URL(String(pathOrUrl), site.url);

  if (
    url.origin === siteOrigin &&
    !url.pathname.endsWith("/") &&
    !/\/[^/]+\.[^/]+$/u.test(url.pathname)
  ) {
    url.pathname = `${url.pathname}/`;
  }

  return url.toString();
}

export function webPageId(pageUrl: string | URL) {
  return `${canonicalSiteUrl(pageUrl)}#webpage`;
}

export function organizationReference() {
  return {
    "@id": organizationId,
  };
}

export function websiteReference() {
  return {
    "@id": websiteId,
  };
}

function organizationStructuredData(): StructuredData {
  return {
    "@type": "Organization",
    "@id": organizationId,
    name: site.name,
    description: site.description,
    url: site.url,
    logo: {
      "@type": "ImageObject",
      "@id": `${site.url}/#logo`,
      url: absoluteSiteUrl(site.schemaLogo),
      width: 512,
      height: 512,
    },
    sameAs: site.sameAs,
  };
}

interface PageStructuredDataOptions {
  canonicalUrl: string;
  description: string;
  imageUrl: string;
  isHomepage: boolean;
  mainEntity?: StructuredData;
  title: string;
}

export function pageStructuredData({
  canonicalUrl,
  description,
  imageUrl,
  isHomepage,
  mainEntity,
  title,
}: PageStructuredDataOptions): StructuredData {
  const currentWebPageId = webPageId(canonicalUrl);
  const webPageMainEntity =
    mainEntity ?? (isHomepage ? { "@id": softwareApplicationId } : undefined);
  const graph: StructuredData[] = [
    organizationStructuredData(),
    {
      "@type": "WebSite",
      "@id": websiteId,
      name: site.name,
      alternateName: site.alternateName,
      url: site.url,
      description: site.description,
      inLanguage: "en",
      publisher: organizationReference(),
    },
    {
      "@type": "WebPage",
      "@id": currentWebPageId,
      url: canonicalUrl,
      name: title,
      description,
      image: imageUrl,
      inLanguage: "en",
      isPartOf: websiteReference(),
      publisher: organizationReference(),
      ...(webPageMainEntity ? { mainEntity: webPageMainEntity } : {}),
    },
  ];

  if (isHomepage) {
    graph.push({
      "@type": "SoftwareApplication",
      "@id": softwareApplicationId,
      name: site.name,
      alternateName: site.alternateName,
      description: site.description,
      url: site.url,
      image: imageUrl,
      applicationCategory: "MultimediaApplication",
      operatingSystem: "Docker, Linux",
      codeRepository: site.githubUrl,
      featureList: [
        "Discover currently playing Plex sessions",
        "Discover currently playing Jellyfin sessions",
        "Open local video files and direct media URLs",
        "Trim clips in a browser timeline editor",
        "Export MP4, WebM, MOV, MKV, and GIF clips",
        "Burn in supported subtitles",
        "Include source metadata in video exports",
      ],
      isAccessibleForFree: true,
      license: `${site.githubUrl}/blob/main/LICENSE`,
      mainEntityOfPage: { "@id": currentWebPageId },
      publisher: organizationReference(),
      sameAs: site.sameAs,
      softwareHelp: canonicalSiteUrl("/docs"),
      offers: {
        "@type": "Offer",
        price: "0",
        priceCurrency: "USD",
      },
    });
  }

  return {
    "@context": "https://schema.org",
    "@graph": graph,
  };
}

export function normalizeStructuredData(
  structuredData: StructuredDataInput | undefined,
): StructuredData[] {
  if (Array.isArray(structuredData)) {
    return structuredData;
  }

  return structuredData ? [structuredData] : [];
}

export function jsonLdScriptContent(item: StructuredData) {
  return JSON.stringify(item).replaceAll("<", String.raw`\u003c`);
}
