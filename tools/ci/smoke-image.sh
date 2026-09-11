#!/usr/bin/env bash
set -euo pipefail

image="${1:?image required}"
version="${2:?version required}"
platform="${3:-linux/amd64}"
name="cliparr-smoke"
health_file="$(mktemp)"
index_file="$(mktemp)"
cleanup() {
  result=$?
  if [[ "$result" != 0 ]]; then docker logs "$name" || true; fi
  docker rm -f "$name" >/dev/null 2>&1 || true
  docker volume rm "$name-data" >/dev/null 2>&1 || true
  rm -f "$health_file" "$index_file"
  exit "$result"
}
trap cleanup EXIT

# Pull the platform manifest so Docker's classic image store never has to map
# the same index digest to two different architecture images.
if [[ "$image" == *@sha256:* ]]; then
  platform_digest="$(docker buildx imagetools inspect --raw "$image" | jq --exit-status --raw-output --arg platform "$platform" '
    [.manifests[] | select((.platform.os + "/" + .platform.architecture) == $platform)]
    | if length == 1 then .[0].digest
      else error("Expected exactly one manifest for " + $platform)
      end
  ')"
  image="${image%@*}@$platform_digest"
  docker pull --platform "$platform" "$image"
fi

docker run --detach --name "$name" --platform "$platform" \
  --publish 127.0.0.1:7171:7171 \
  --env APP_KEY="cliparr-smoke-test-key-with-at-least-32-characters" \
  --volume "$name-data:/data" "$image"

for attempt in {1..60}; do
  if curl --fail --silent http://127.0.0.1:7171/api/health > "$health_file"; then break; fi
  sleep 1
done
jq --exit-status --arg version "$version" \
  '.status == "ok" and .database == "ok" and .version == $version' "$health_file"
curl --fail --silent --show-error http://127.0.0.1:7171/ > "$index_file"
grep -q '<div id="root"></div>' "$index_file"
runtime_node="$(docker exec "$name" /nodejs/bin/node --version)"
echo "$platform: app $version, Node $runtime_node"
if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
  echo "runtime_node=$runtime_node" >> "$GITHUB_OUTPUT"
fi
