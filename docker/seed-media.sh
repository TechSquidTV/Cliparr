#!/bin/sh

set -eu

MEDIA_ROOT="${MEDIA_ROOT:-/media}"
MOVIE_TITLE="Sintel"
MOVIE_YEAR="2010"
MOVIE_DIR="$MEDIA_ROOT/movies/$MOVIE_TITLE ($MOVIE_YEAR)"
TARGET_FILE="$MOVIE_DIR/$MOVIE_TITLE ($MOVIE_YEAR).mkv"
TMP_FILE="$TARGET_FILE.part"
UNZIP_FILE="$TARGET_FILE.unzip"

# Tried in order. download.blender.org can answer scripted clients with a
# Cloudflare challenge (HTTP 403), so a Blender mirror follows it. The
# RWTH Aachen mirror serves this path as an uncompressed zip around the mkv,
# which is unpacked below.
DEFAULT_SINTEL_URLS="https://download.blender.org/demo/movies/Sintel.2010.720p.mkv https://ftp.halifax.rwth-aachen.de/blender/demo/movies/Sintel.2010.720p.mkv"

# SHA-256 of the public MKV, verified against Blender's published MD5 once.
# Check the extracted movie bytes; custom sources must supply their own SHA-256.
DEFAULT_SINTEL_SHA256="60cff51761641626e82eeb4e1c248c471375b2536bb1089f49825b7fb58d8723"

if [ -n "${SINTEL_URL:-}" ]; then
  SINTEL_URLS="$SINTEL_URL"
  SINTEL_SHA256="${SINTEL_SHA256:?SINTEL_SHA256 is required with SINTEL_URL}"
else
  SINTEL_URLS="$DEFAULT_SINTEL_URLS"
  SINTEL_SHA256="${SINTEL_SHA256:-$DEFAULT_SINTEL_SHA256}"
fi

# Ensure provider library paths exist even when CI skips the movie download.
mkdir -p "$MOVIE_DIR"

if [ "${CI:-}" = "true" ] || [ "${GITHUB_ACTIONS:-}" = "true" ]; then
  echo "Skipping dev media download in CI."
  exit 0
fi

if ! printf '%s' "$SINTEL_SHA256" | grep -Eq '^[a-f0-9]{64}$'; then
  echo "SINTEL_SHA256 must contain 64 lowercase hexadecimal characters." >&2
  exit 1
fi

verify_media() {
  actual_sha256="$(sha256sum "$1" | cut -d ' ' -f 1)"
  if [ "$actual_sha256" != "$SINTEL_SHA256" ]; then
    echo "Media checksum mismatch; remove the invalid fixture and seed again." >&2
    return 1
  fi
}

if [ -s "$TARGET_FILE" ]; then
  verify_media "$TARGET_FILE"
  echo "$MOVIE_TITLE already present at $TARGET_FILE"
  exit 0
fi

cleanup() {
  rm -f "$TMP_FILE" "$UNZIP_FILE"
}
trap cleanup EXIT

try_source() {
  url="$1"
  cleanup

  echo "Downloading $MOVIE_TITLE from $url"
  if ! curl -fL --proto =https --proto-redir =https --connect-timeout 10 --max-time 600 --retry 2 --retry-max-time 900 --retry-delay 2 --retry-connrefused "$url" -o "$TMP_FILE"; then
    echo "Download failed: $url" >&2
    return 1
  fi

  if [ "$(head -c 2 "$TMP_FILE")" = "PK" ]; then
    echo "Download is a zip archive; extracting the movie."
    if ! unzip -p "$TMP_FILE" > "$UNZIP_FILE"; then
      echo "Could not extract the zip from $url" >&2
      return 1
    fi
    mv "$UNZIP_FILE" "$TMP_FILE"
  fi

  if ! verify_media "$TMP_FILE"; then
    return 1
  fi

  mv "$TMP_FILE" "$TARGET_FILE"
}

for url in $SINTEL_URLS; do
  if try_source "$url"; then
    echo "Seeded shared media library."
    exit 0
  fi
done

echo "Could not download $MOVIE_TITLE from any source: $SINTEL_URLS" >&2
exit 1
