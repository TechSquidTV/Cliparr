#!/usr/bin/env bash
set -euo pipefail

image="${1:?image required}"
version="${2:?version required}"
platform="${3:-linux/amd64}"
name="cliparr-smoke-${RANDOM}"
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
  --publish 127.0.0.1::7171 \
  --read-only --cap-drop ALL --security-opt no-new-privileges \
  --tmpfs /tmp:rw,noexec,nosuid,size=64m \
  --env APP_KEY="cliparr-smoke-test-key-with-at-least-32-characters" \
  --volume "$name-data:/data" "$image"

wait_for_health() {
  port="$(docker port "$name" 7171/tcp | head -1 | cut -d: -f2)"
  base_url="http://127.0.0.1:$port"
  for attempt in {1..60}; do
    if curl --fail --silent --max-time 3 "$base_url/api/health" > "$health_file"; then return 0; fi
    sleep 1
  done
  echo "Image did not become healthy." >&2
  return 1
}
# Application files must stay immutable; only /data and temporary storage are writable.
docker exec "$name" /nodejs/bin/node -e '
  const fs = require("node:fs");
  if (process.getuid() === 0) process.exit(1);
  try { fs.writeFileSync("/app/write-probe", "unexpected"); process.exit(1); }
  catch (error) { if (error.code !== "EROFS" && error.code !== "EACCES") throw error; }
'
wait_for_health
jq --exit-status --arg version "$version" \
  '.status == "ok" and .database == "ok" and .version == $version' "$health_file"
curl --fail --silent --show-error --max-time 10 "$base_url/" > "$index_file"
grep -q '<div id="root"></div>' "$index_file"
docker restart "$name" >/dev/null
wait_for_health
jq --exit-status '.database == "ok"' "$health_file"
runtime_node="$(docker exec "$name" /nodejs/bin/node --version)"
echo "$platform: app $version, Node $runtime_node"
if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
  echo "runtime_node=$runtime_node" >> "$GITHUB_OUTPUT"
fi
