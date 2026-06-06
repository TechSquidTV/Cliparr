export const site = {
  name: "Cliparr",
  url: "https://cliparr.dev",
  description: "Self-hosted video clipper for Plex, Jellyfin, and local files.",
  githubUrl: "https://github.com/TechSquidTV/Cliparr",
  ogImage: "/og.jpg",
  ogImageAlt:
    "Cliparr editor showing a video preview, playback controls, and timeline clip selection.",
  ogImageHeight: 630,
  ogImageType: "image/jpeg",
  ogImageWidth: 1200,
  logo: "/logo-light.svg",
};

export const productIntro =
  "Self-hosted video clipping for Plex, Jellyfin, and local files. Trim the moment and export it in your browser.";

export const features = [
  {
    title: "Instant session discovery",
    description:
      'Automatically loads currently playing media from connected <a href="/docs/providers">Plex and Jellyfin providers</a>.',
  },
  {
    title: "Open local videos",
    description:
      'Open a <a href="/docs/local-videos">local file or direct media URL</a> before or after connecting a provider.',
  },
  {
    title: "Intuitive timeline editor",
    description: "Familiar editing controls for choosing the exact clip range.",
  },
  {
    title: "Browser transcoding",
    description:
      'Video <a href="/docs/export-settings">export settings</a> are powered by <a href="https://mediabunny.dev/" target="_blank" rel="noreferrer">Mediabunny</a>. GIFs are encoded with <a href="https://github.com/KyleTryon/gifenc" target="_blank" rel="noreferrer">gifenc</a>.',
  },
  {
    title: "Metadata included",
    description:
      "Video exports can include season, episode, and timing metadata from your source.",
  },
  {
    title: "Subtitle burn-in",
    description:
      'Burn in <a href="/docs/subtitle-burn-in">supported subtitles</a> with customizable styling and local font support in Chromium.',
  },
] as const;

export const providers = [
  {
    name: "Plex",
    iconPath: "/providers/plex.svg",
    setup:
      "Connect your Plex account, choose a server, and clip from active playback sessions.",
  },
  {
    name: "Jellyfin",
    iconPath: "/providers/jellyfin.svg",
    setup:
      "Connect your Jellyfin server with an administrator account and clip from active sessions across your library.",
  },
] as const;

export type CommandExampleLanguage = "bash" | "powershell" | "yaml";

export interface CommandExampleVariant {
  label: string;
  code: string;
  lang: CommandExampleLanguage;
}

export const dockerRunCommand = String.raw`docker run -d \
  --name cliparr \
  -p 7171:7171 \
  -e APP_KEY="your-32-char-stable-random-secret" \
  -v cliparr-data:/data \
  ghcr.io/techsquidtv/cliparr:latest`;

export const dockerRunPowerShellCommand = `docker run -d \`
  --name cliparr \`
  -p 7171:7171 \`
  -e APP_KEY="your-32-char-stable-random-secret" \`
  -v cliparr-data:/data \`
  ghcr.io/techsquidtv/cliparr:latest`;

export const dockerRunCommandVariants = [
  { label: "macOS / Linux", code: dockerRunCommand, lang: "bash" },
  { label: "PowerShell", code: dockerRunPowerShellCommand, lang: "powershell" },
] satisfies readonly CommandExampleVariant[];

export const dockerLinuxContainerNote =
  "On Windows, run this from Docker Desktop or another Docker engine using Linux containers. Cliparr publishes Linux container images for linux/amd64 and linux/arm64.";

export const dockerComposeExample = `services:
  cliparr:
    image: ghcr.io/techsquidtv/cliparr:latest
    container_name: cliparr
    ports:
      - "7171:7171"
    environment:
      - APP_KEY=replace-this-with-a-32-character-secure-random-string
    volumes:
      - cliparr-data:/data
    restart: unless-stopped

volumes:
  cliparr-data:`;

const structuredConsoleLoggingCommand = String.raw`docker run -d \
  --name cliparr \
  -p 7171:7171 \
  -e APP_KEY="your-32-char-stable-random-secret" \
  -e CLIPARR_LOG_FORMAT=json \
  -v cliparr-data:/data \
  ghcr.io/techsquidtv/cliparr:latest`;

const structuredConsoleLoggingPowerShellCommand = `docker run -d \`
  --name cliparr \`
  -p 7171:7171 \`
  -e APP_KEY="your-32-char-stable-random-secret" \`
  -e CLIPARR_LOG_FORMAT=json \`
  -v cliparr-data:/data \`
  ghcr.io/techsquidtv/cliparr:latest`;

export const structuredConsoleLoggingCommandVariants = [
  {
    label: "macOS / Linux",
    code: structuredConsoleLoggingCommand,
    lang: "bash",
  },
  {
    label: "PowerShell",
    code: structuredConsoleLoggingPowerShellCommand,
    lang: "powershell",
  },
] satisfies readonly CommandExampleVariant[];

const tailscaleDockerRunCommand = String.raw`docker run -d \
  --name cliparr \
  -p 127.0.0.1:7171:7171 \
  -e APP_KEY="your-32-char-stable-random-secret" \
  -v cliparr-data:/data \
  ghcr.io/techsquidtv/cliparr:latest`;

const tailscaleDockerRunPowerShellCommand = `docker run -d \`
  --name cliparr \`
  -p 127.0.0.1:7171:7171 \`
  -e APP_KEY="your-32-char-stable-random-secret" \`
  -v cliparr-data:/data \`
  ghcr.io/techsquidtv/cliparr:latest`;

export const tailscaleDockerRunCommandVariants = [
  { label: "macOS / Linux", code: tailscaleDockerRunCommand, lang: "bash" },
  {
    label: "PowerShell",
    code: tailscaleDockerRunPowerShellCommand,
    lang: "powershell",
  },
] satisfies readonly CommandExampleVariant[];

const wireguardDockerRunCommand = String.raw`docker run -d \
  --name cliparr \
  -p 10.8.0.1:7171:7171 \
  -e APP_KEY="your-32-char-stable-random-secret" \
  -v cliparr-data:/data \
  ghcr.io/techsquidtv/cliparr:latest`;

const wireguardDockerRunPowerShellCommand = `docker run -d \`
  --name cliparr \`
  -p 10.8.0.1:7171:7171 \`
  -e APP_KEY="your-32-char-stable-random-secret" \`
  -v cliparr-data:/data \`
  ghcr.io/techsquidtv/cliparr:latest`;

export const wireguardDockerRunCommandVariants = [
  { label: "macOS / Linux", code: wireguardDockerRunCommand, lang: "bash" },
  {
    label: "PowerShell",
    code: wireguardDockerRunPowerShellCommand,
    lang: "powershell",
  },
] satisfies readonly CommandExampleVariant[];

export const rotatingFileLoggingCompose = `services:
  cliparr:
    image: ghcr.io/techsquidtv/cliparr:latest
    environment:
      - APP_KEY=replace-this-with-a-32-character-secure-random-string
      - CLIPARR_LOG_FORMAT=pretty
      - CLIPARR_LOG_FILE=/data/logs/cliparr.log
      - CLIPARR_LOG_FILE_FORMAT=json
      - CLIPARR_LOG_FILE_MAX_SIZE=10mb
      - CLIPARR_LOG_FILE_MAX_FILES=5
    volumes:
      - cliparr-data:/data`;

const developmentSetupCommands = `git clone https://github.com/techsquidtv/cliparr.git
cd cliparr
cp .env.example .env
pnpm install
pnpm dev`;

const developmentSetupPowerShellCommands = `git clone https://github.com/techsquidtv/cliparr.git
Set-Location cliparr
Copy-Item .env.example .env
pnpm install
pnpm dev`;

export const developmentSetupCommandVariants = [
  { label: "macOS / Linux", code: developmentSetupCommands, lang: "bash" },
  {
    label: "PowerShell",
    code: developmentSetupPowerShellCommands,
    lang: "powershell",
  },
] satisfies readonly CommandExampleVariant[];

export const preflightCommands = `pnpm preflight`;

export const warnings = [
  {
    title: "Stable APP_KEY required",
    body: "Cliparr uses APP_KEY to encrypt provider credentials at rest. Use a stable random secret at least 32 characters long. If you change it later, you will need to re-authenticate your media servers.",
  },
  {
    title: "Use HTTPS for editing",
    body: "Cliparr's editor uses browser WebCodecs. Supporting browsers require a secure context, so use HTTPS through a reverse proxy or open Cliparr on localhost or 127.0.0.1.",
  },
] as const;

export const envVariables = [
  {
    name: "APP_KEY",
    description:
      "Required secret for credential encryption. Must be at least 32 characters long.",
    defaultValue: "-",
    required: true,
  },
  {
    name: "PORT",
    description: "Internal port for the Express server.",
    defaultValue: "7171 prod / 3000 dev",
    required: false,
  },
  {
    name: "CLIPARR_DATA_DIR",
    description: "Directory for SQLite storage.",
    defaultValue: "/data",
    required: false,
  },
  {
    name: "CLIPARR_LOG_LEVEL",
    description:
      "Server log level. Supports trace, debug, info, warning, error, and fatal. Defaults to debug in development and info in production.",
    defaultValue: "debug/info",
    required: false,
  },
  {
    name: "CLIPARR_LOG_FORMAT",
    description:
      "Production server console log format. Development console logs are always JSON.",
    defaultValue: "json dev / pretty prod",
    required: false,
  },
  {
    name: "CLIPARR_LOG_FILE",
    description:
      "Optional path for a rotating server log file. Relative paths resolve from the server working directory.",
    defaultValue: "-",
    required: false,
  },
  {
    name: "CLIPARR_LOG_FILE_FORMAT",
    description:
      "Optional log file format. Defaults to CLIPARR_LOG_FORMAT when set, otherwise json.",
    defaultValue: "json",
    required: false,
  },
  {
    name: "CLIPARR_LOG_FILE_MAX_SIZE",
    description:
      "Maximum size for each rotating server log file. Supports kb, mb, and gb suffixes.",
    defaultValue: "10mb",
    required: false,
  },
  {
    name: "CLIPARR_LOG_FILE_MAX_FILES",
    description:
      "Total number of rotating server log files to keep, including the active file.",
    defaultValue: "5",
    required: false,
  },
  {
    name: "CLIPARR_ALLOW_LOOPBACK_JELLYFIN_URLS",
    description:
      "Allow Jellyfin URLs that resolve to localhost or loopback. Use only for trusted self-hosted setups.",
    defaultValue: "false",
    required: false,
  },
] as const;
