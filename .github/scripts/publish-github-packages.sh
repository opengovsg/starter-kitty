#!/usr/bin/env bash
# Mirrors an already-done (or in-progress) npm publish over to GitHub
# Packages, for every publishable workspace package at its current on-disk
# version. Run this AFTER the npm publish step, with the registry already
# pointed at https://npm.pkg.github.com (e.g. via actions/setup-node's
# registry-url) and NODE_AUTH_TOKEN set to a token with `packages: write`.
#
# Usage: publish-github-packages.sh [dist-tag]
set -euo pipefail

tag_flag=()
if [ -n "${1:-}" ]; then
  tag_flag=(--tag "$1")
fi

for manifest in packages/*/package.json; do
  if [ "$(jq -r '.private // false' "$manifest")" = "true" ]; then
    continue
  fi

  name=$(jq -r '.name // empty' "$manifest")
  [ -z "$name" ] && continue
  version=$(jq -r '.version' "$manifest")

  # In snapshot mode (tag given), a run with no pending changesets leaves
  # package.json at its last real, already-released version instead of a
  # fresh `-<tag>-<timestamp>` bump. npm correctly no-ops on that; mirror
  # the no-op here instead of republishing the release version under the
  # snapshot tag.
  if [ -n "${1:-}" ] && npm view "$name@$version" --registry=https://registry.npmjs.org/ >/dev/null 2>&1; then
    echo "$name@$version is already released on npm (no new snapshot), skipping"
    continue
  fi

  if view_output=$(npm view "$name@$version" --registry=https://npm.pkg.github.com 2>&1); then
    echo "$name@$version already published to GitHub Packages, skipping"
  elif echo "$view_output" | grep -q 'E404'; then
    echo "Publishing $name@$version to GitHub Packages"
    pnpm --filter "$name" publish --no-git-checks "${tag_flag[@]}"
  else
    echo "$view_output" >&2
    exit 1
  fi
done
