#!/bin/sh

set -eu

MEDIA_ROOT="${MEDIA_ROOT:-/media}"
MOVIE_DIR="$MEDIA_ROOT/movies/Big Buck Bunny (2008)"
TARGET_FILE="$MOVIE_DIR/Big Buck Bunny (2008).mp4"
TMP_FILE="$TARGET_FILE.part"
BBB_URL="${BBB_URL:-https://download.blender.org/peach/bigbuckbunny_movies/BigBuckBunny_320x180.mp4}"

if [ -s "$TARGET_FILE" ]; then
  echo "Big Buck Bunny already present at $TARGET_FILE"
  exit 0
fi

mkdir -p "$MOVIE_DIR"
rm -f "$TMP_FILE"

echo "Downloading Big Buck Bunny into $TARGET_FILE"
curl -fL --retry 5 --retry-delay 2 --retry-connrefused "$BBB_URL" -o "$TMP_FILE"
mv "$TMP_FILE" "$TARGET_FILE"

echo "Seeded shared media library."
