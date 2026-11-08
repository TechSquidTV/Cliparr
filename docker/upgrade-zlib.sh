#!/bin/sh

set -eu

# Temporary release exception for CVE-2026-76844 and CVE-2026-85091.
# Remove once the pinned upstream Node image includes this Debian security fix.
apt-get update
apt-get install -y --no-install-recommends --only-upgrade zlib1g
dpkg --compare-versions "$(dpkg-query -W -f='${Version}' zlib1g)" ge '1:1.3.dfsg+really1.3.1-1+deb13u1'
rm -rf /var/lib/apt/lists/*
