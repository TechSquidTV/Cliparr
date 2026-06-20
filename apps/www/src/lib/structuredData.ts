import { site } from "@/data/product";

export type StructuredData = Record<string, unknown>;
export type StructuredDataInput = StructuredData | StructuredData[];

const organizationId = `${site.url}/#organization`;
const webApplicationId = `${site.url}/#web-application`;
const websiteId = `${site.url}/#website`;

export function absoluteSiteUrl(pathOrUrl: string | URL) {
  return new URL(String(pathOrUrl), site.url).toString();
}

export function webPageId(pageUrl: string | URL) {
  return `${absoluteSiteUrl(pageUrl)}#webpage`;
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
  title: string;
}

export function pageStructuredData({
  canonicalUrl,
  description,
  imageUrl,
  isHomepage,
  title,
}: PageStructuredDataOptions): StructuredData {
  const currentWebPageId = webPageId(canonicalUrl);
  const graph: StructuredData[] = [
    organizationStructuredData(),
    {
      "@type": "WebSite",
      "@id": websiteId,
      name: site.name,
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
      ...(isHomepage ? { mainEntity: { "@id": webApplicationId } } : {}),
    },
  ];

  if (isHomepage) {
    graph.push({
      "@type": "WebApplication",
      "@id": webApplicationId,
      name: site.name,
      description: site.description,
      url: site.url,
      image: imageUrl,
      applicationCategory: "MultimediaApplication",
      operatingSystem: "Web",
      browserRequirements:
        "Requires a modern browser with WebCodecs support for editing and export.",
      isAccessibleForFree: true,
      license: `${site.githubUrl}/blob/main/LICENSE`,
      mainEntityOfPage: { "@id": currentWebPageId },
      publisher: organizationReference(),
      sameAs: site.sameAs,
      softwareHelp: absoluteSiteUrl("/docs"),
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
