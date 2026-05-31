export const site = {
  name: "Cliparr",
  url: "https://cliparr.dev",
  description:
    "Instant media clipper for Plex, Jellyfin, and local video files.",
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
  "Open Plex, Jellyfin, or a local file. Trim the moment and export it.";

export const features = [
  {
    title: "Instant session discovery",
    description:
      "Automatically loads your media player's currently playing file.",
  },
  {
    title: "Open local videos",
    description:
      "Open a local file or direct media URL before or after connecting a provider.",
  },
  {
    title: "Intuitive timeline editor",
    description: "Familiar editing controls for choosing the exact clip range.",
  },
  {
    title: "Browser transcoding",
    description:
      'Powered by <a href="https://mediabunny.dev/" target="_blank" rel="noreferrer">Mediabunny</a>, video is transcoded in your browser.',
  },
  {
    title: "Metadata included",
    description:
      "Exports can include season, episode, and timing metadata from your source.",
  },
  {
    title: "Subtitle burn-in",
    description:
      "Burn in supported subtitles with customizable styling and local font support in Chromium.",
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

export const dockerRunCommand = `docker run -d \\
  --name cliparr \\
  -p 7171:7171 \\
  -e APP_KEY="your-32-char-stable-random-secret" \\
  -v cliparr-data:/data \\
  ghcr.io/techsquidtv/cliparr:latest`;

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

export const structuredConsoleLoggingCommand = `docker run -d \\
  --name cliparr \\
  -p 7171:7171 \\
  -e APP_KEY="your-32-char-stable-random-secret" \\
  -e CLIPARR_LOG_FORMAT=json \\
  -v cliparr-data:/data \\
  ghcr.io/techsquidtv/cliparr:latest`;

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

export const developmentSetupCommands = `git clone https://github.com/techsquidtv/cliparr.git
cd cliparr
cp .env.example .env
pnpm install
pnpm dev`;

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

export const envVars = [
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
