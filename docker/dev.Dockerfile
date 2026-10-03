FROM node:24-slim

COPY package.json /tmp/cliparr-package.json

RUN apt-get update \
  && apt-get install -y --no-install-recommends procps \
  && rm -rf /var/lib/apt/lists/* \
  && npm install --global "$(node -p 'require("/tmp/cliparr-package.json").packageManager')" \
  && rm /tmp/cliparr-package.json
