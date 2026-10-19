export const VIDEO_PICKER_TYPES = [
  {
    description: "Video files",
    accept: {
      "video/*": [
        ".mp4",
        ".m4v",
        ".mov",
        ".mkv",
        ".webm",
        ".ogv",
        ".ts",
        ".m2ts",
        ".mts",
      ],
      "application/x-matroska": [".mkv"],
      "video/mp2t": [".ts", ".m2ts", ".mts"],
    },
  },
] as const;

const videoAccept = VIDEO_PICKER_TYPES[0].accept;
export const LOCAL_VIDEO_FILE_ACCEPT = [
  ...Object.keys(videoAccept),
  "video/x-matroska",
  ...new Set(Object.values(videoAccept).flat()),
].join(",");
