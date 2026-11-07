#!/bin/sh
set -eu

# Debian's released update fixes CVE-2026-76844 and CVE-2026-85091.
# Use the package manager and fail if a mirror does not have the fix yet.
apt-get update
apt-get install -y --no-install-recommends --only-upgrade zlib1g
dpkg --compare-versions "$(dpkg-query -W -f='${Version}' zlib1g)" ge '1:1.3.dfsg+really1.3.1-1+deb13u1'
rm -rf /var/lib/apt/lists/*
