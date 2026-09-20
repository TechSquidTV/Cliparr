import type { APIRoute } from "astro";
import { getCollection } from "astro:content";
import { docsForSection, docsSections, type DocsSectionId } from "@/data/docs";
import { site } from "@/data/product";
import { canonicalSiteUrl } from "@/lib/structuredData";

interface DocumentationIndexEntry {
  data: {
    description: string;
    order: number;
    section: DocsSectionId;
    title: string;
  };
  id: string;
}

const formatLink = (title: string, description: string, path: string) =>
  `- [${title}](${canonicalSiteUrl(path)}): ${description}`;

const featuredDocumentIds = new Set([
  "getting-started",
  "providers",
  "export-settings",
]);

export const GET: APIRoute = async () => {
  const docs = (await getCollection("docs")) as DocumentationIndexEntry[];
  const docsBySection = docsSections.map((section) => {
    const links = docsForSection(docs, section.id)
      .filter((entry) => !featuredDocumentIds.has(entry.id))
      .map((entry) =>
        formatLink(
          entry.data.title,
          entry.data.description,
          `/docs/${entry.id}`,
        ),
      );

    return `## ${section.title}\n\n${links.join("\n")}\n`;
  });

  const body = [
    `# ${site.name}`,
    "",
    `> ${site.description}`,
    "",
    "Cliparr is an open-source application for making short clips from personal media. Use this file as orientation: the notes below establish the product's boundaries and terminology, while the linked documentation is authoritative for detailed behavior and setup.",
    "",
    "Key facts:",
    "",
    "- Cliparr can discover media currently playing on connected Plex and Jellyfin servers. It can also open a browser-local video file or a direct HTTP, HTTPS, or HLS media URL.",
    "- Editing and export processing happen in the user's browser. Video exports use Mediabunny, and GIF exports use @techsquidtv/gifenc. Cliparr does not invoke FFmpeg for exports.",
    "- The self-hosted server manages provider authentication, encrypted provider records, active-session discovery, and proxy access to remote media. It does not render exported video.",
    "- Local files are read directly by the browser and are not uploaded to the Cliparr server. Provider and URL sources may pass through the server's media proxy for playback and export.",
    "- Supported outputs include MP4, WebM, MOV, MKV, and GIF. Capabilities vary with the browser and the source codecs.",
    "- Text subtitle tracks can be burned into exports. Image-based subtitle formats such as PGS and VobSub are not currently burn-in sources.",
    "- Cliparr requires a stable APP_KEY of at least 32 characters to encrypt stored provider credentials. Changing it requires reconnecting providers.",
    "- Cliparr has no full app-level account, role, or permission system. Keep an instance on a trusted network or place authentication in front of it.",
    "- WebCodecs and related editor features require HTTPS in production; localhost and 127.0.0.1 are valid secure contexts for local use.",
    "- Cliparr Convert is a separate hosted, browser-based whole-file converter. It is not the self-hosted timeline editor and does not connect to Plex or Jellyfin.",
    "",
    "Terminology: a provider is a configured Plex or Jellyfin connection; a source is the selected provider item, local file, or direct URL; export means browser-side processing and download of the selected timeline range.",
    "",
    "## Start here",
    "",
    formatLink(
      "Product overview",
      "Capabilities, architecture summary, answers to common questions, and Docker quick start.",
      "/",
    ),
    formatLink(
      "Getting started",
      "Run the container, persist its data, provide APP_KEY, and connect the first source.",
      "/docs/getting-started",
    ),
    formatLink(
      "Providers",
      "Plex and Jellyfin authentication, session discovery, permissions, and metadata behavior.",
      "/docs/providers",
    ),
    formatLink(
      "Export settings",
      "Formats, quality, resolution, source selection, audio, filenames, estimates, and metadata controls.",
      "/docs/export-settings",
    ),
    "",
    ...docsBySection,
    "",
    "## Optional",
    "",
    formatLink(
      "GitHub repository",
      "Source code, issues, contribution history, and MIT license.",
      site.githubUrl,
    ),
    formatLink(
      "Releases",
      "Versioned release notes generated from published GitHub releases.",
      "/changelog/",
    ),
    formatLink(
      "Blog",
      "Project announcements and longer technical notes.",
      "/blog/",
    ),
    formatLink(
      "Cliparr Convert",
      "Separate hosted tool for browser-based whole-file conversion.",
      "/convert/",
    ),
    "",
    `Last generated from the site's canonical content at ${site.url}.`,
    "",
  ].join("\n");

  return new Response(body, {
    headers: {
      "Cache-Control": "public, max-age=3600",
      "Content-Type": "text/plain; charset=utf-8",
      "X-Robots-Tag": "index, follow",
    },
  });
};
