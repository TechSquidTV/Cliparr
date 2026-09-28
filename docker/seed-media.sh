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

# Blender's published checksum for Sintel.2010.720p.mkv, checked after any
# unzip so a mirror serving different bytes fails here instead of seeding a
# broken library. SINTEL_URL replaces the default sources with one URL; its
# download is only checked when SINTEL_MD5 is also set.
DEFAULT_SINTEL_MD5="08d1108e0160b847f894acfdbce82305"

if [ -n "${SINTEL_URL:-}" ]; then
  SINTEL_URLS="$SINTEL_URL"
  SINTEL_MD5="${SINTEL_MD5:-}"
else
  SINTEL_URLS="$DEFAULT_SINTEL_URLS"
  SINTEL_MD5="${SINTEL_MD5:-$DEFAULT_SINTEL_MD5}"
fi

if [ "${CI:-}" = "true" ] || [ "${GITHUB_ACTIONS:-}" = "true" ]; then
  echo "Skipping dev media download in CI."
  exit 0
fi

if [ -s "$TARGET_FILE" ]; then
  echo "$MOVIE_TITLE already present at $TARGET_FILE"
  exit 0
fi

mkdir -p "$MOVIE_DIR"

cleanup() {
  rm -f "$TMP_FILE" "$UNZIP_FILE"
}
trap cleanup EXIT

try_source() {
  url="$1"
  cleanup

  echo "Downloading $MOVIE_TITLE from $url"
  if ! curl -fL --retry 5 --retry-delay 2 --retry-connrefused "$url" -o "$TMP_FILE"; then
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

  if [ -n "$SINTEL_MD5" ]; then
    actual_md5="$(md5sum "$TMP_FILE" | cut -d ' ' -f 1)"
    if [ "$actual_md5" != "$SINTEL_MD5" ]; then
      echo "Checksum mismatch from $url: expected $SINTEL_MD5, got $actual_md5" >&2
      return 1
    fi
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
