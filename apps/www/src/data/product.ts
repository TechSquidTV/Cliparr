export const site = {
  name: "Cliparr",
  alternateName: [
    "Cliparr video clipper",
    "Cliparr Plex clipper",
    "Cliparr Jellyfin clipper",
  ],
  url: "https://cliparr.dev",
  description: "Self-hosted video clipper for Plex, Jellyfin, and local files.",
  githubUrl: "https://github.com/TechSquidTV/Cliparr",
  ogImage: "/og.jpg",
  ogImageAlt:
    "Cliparr editor showing a video preview with subtitles, timeline clip selection, and subtitle controls.",
  ogImageHeight: 886,
  ogImageType: "image/jpeg",
  ogImageWidth: 1600,
  logo: "/logo-light.svg",
  schemaLogo: "/pwa-icon-512.png",
  sameAs: ["https://github.com/TechSquidTV/Cliparr"],
};

export const productIntro =
  "Self-hosted video clipping for Plex, Jellyfin, and local files. Trim the moment and export it in your browser.";

export const features = [
  {
    title: "Live session discovery",
    description:
      'Follow playback automatically from connected <a href="/docs/providers">Plex and Jellyfin servers</a>.',
  },
  {
    title: "Open local videos",
    description:
      'Clip <a href="/docs/local-videos">local files</a> without uploading them. Direct media URLs require provider sign-in.',
  },
  {
    title: "Timeline editing",
    description:
      "Trim, zoom, and fine-tune your clip range with a familiar non-linear editor.",
  },
  {
    title: "Video, audio, and GIF export",
    description:
      'Choose video or audio-only formats, or make a GIF. <a href="/docs/export-settings">Exports run in your browser</a>.',
  },
  {
    title: "Metadata included",
    description:
      'Keep source details, artwork, and clip timing in supported <a href="/docs/export-metadata">video and audio containers</a>.',
  },
  {
    title: "Subtitle authoring",
    description:
      'Create your own captions or import subtitles, then <a href="/docs/subtitle-burn-in">style and burn subtitles</a> into your clip.',
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
      "Connect your Jellyfin server with your account and clip from your active sessions. Administrator accounts can access sessions across the server.",
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

const wireguardDockerRunCommand = `: "\${WIREGUARD_BIND_ADDRESS:?Set WIREGUARD_BIND_ADDRESS to your VPN address}"
docker run -d \\
  --name cliparr \\
  -p "$WIREGUARD_BIND_ADDRESS:7171:7171" \\
  -e APP_KEY="your-32-char-stable-random-secret" \\
  -v cliparr-data:/data \\
  ghcr.io/techsquidtv/cliparr:latest`;

const wireguardDockerRunPowerShellCommand = `if (-not $env:WIREGUARD_BIND_ADDRESS) { throw "Set WIREGUARD_BIND_ADDRESS to your VPN address" }
docker run -d \`
  --name cliparr \`
  -p "$($env:WIREGUARD_BIND_ADDRESS):7171:7171" \`
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
npm install --global "$(node -p 'require("./package.json").packageManager')"
pnpm install
pnpm dev`;

const developmentSetupPowerShellCommands = `git clone https://github.com/techsquidtv/cliparr.git
Set-Location cliparr
Copy-Item .env.example .env
npm install --global (node -p 'require("./package.json").packageManager')
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
    name: "CLIPARR_ALLOW_LOOPBACK_PLEX_URLS",
    description:
      "Allow Plex URLs that resolve to loopback only for the initial configured origin, including redirects returning to it. Enable only if you trust every authenticated user: they can configure arbitrary loopback hosts and ports. Other origins remain blocked from reaching loopback.",
    defaultValue: "false",
    required: false,
  },
  {
    name: "CLIPARR_ALLOW_LOOPBACK_JELLYFIN_URLS",
    description:
      "Allow Jellyfin URLs that resolve to loopback only for the initial configured origin, including redirects returning to it. Enable only if you trust every authenticated user: they can configure arbitrary loopback hosts and ports. Other origins remain blocked from reaching loopback.",
    defaultValue: "false",
    required: false,
  },
] as const;
