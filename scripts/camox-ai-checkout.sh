#!/bin/bash
# Checks out camox.ai's code, the Artifacts repo of its hosted Camox project,
# into its submodule and installs it on its own. Git reads the repo with
# short-lived tokens from `camox git-credential`, so this needs a Camox login
# (`npx @camox/cli login`). See "camox.ai's checkout" in CONTRIBUTORS.md.
set -eu

cd "$(dirname "$0")/.."

path=sites/camox.ai
url=$(git config -f .gitmodules "submodule.$path.url")
origin=$(printf '%s' "$url" | sed -E 's#^(https://[^/]+).*#\1#')
helper='!npx -y @camox/cli@latest git-credential'

# The empty helper drops any other helper (such as the keychain) for this host.
git -c "credential.$origin.helper=" \
  -c "credential.$origin.helper=$helper" \
  -c "credential.$origin.useHttpPath=true" \
  submodule update --init "$path"

# Later fetches and pulls in the checkout find the helper in its own config.
git -C "$path" config --unset-all "credential.$origin.helper" || true
git -C "$path" config --add "credential.$origin.helper" ""
git -C "$path" config --add "credential.$origin.helper" "$helper"
git -C "$path" config "credential.$origin.useHttpPath" true

# Installs exactly as the platform does: the checkout is its own pnpm workspace,
# with its own lockfile and settings.
(cd "$path" && CI=true pnpm install --frozen-lockfile)
