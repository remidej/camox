#!/usr/bin/env bash
# Sets up the Cloudflare Artifacts namespace and the read-only `template-default` repo that new
# projects fork, then pushes the Template into it once. Safe to re-run: each step checks what exists before
# changing anything. README.md explains each step.
#
# Needs the `cf` CLI signed in to Camox's account (`cf auth whoami`), jq, git, and the workspace's
# dependencies installed (`pnpm install`).
set -euo pipefail

NAMESPACE="projects"
REPO="template-default"
SCRIPTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

step() { printf '\n==> %s\n' "$1"; }
fail() {
  printf 'Error: %s\n' "$1" >&2
  exit 1
}

for tool in cf jq git node pnpm; do
  command -v "$tool" >/dev/null || fail "$tool is not installed."
done

step "Cloudflare Artifacts namespace '$NAMESPACE'"
if cf artifacts namespaces get "$NAMESPACE" >/dev/null 2>&1; then
  echo "Exists."
else
  cf artifacts namespaces create --namespace "$NAMESPACE" >/dev/null
  echo "Created."
fi

step "Read-only repo '$REPO'"
if repo="$(cf artifacts namespaces repos get "$REPO" --namespace "$NAMESPACE" 2>/dev/null)"; then
  echo "Exists."
else
  cf artifacts namespaces repos create "$NAMESPACE" \
    --name "$REPO" \
    --default-branch main \
    --read-only \
    --description "The Template that new projects fork. Refreshed on every SDK publish." >/dev/null
  repo="$(cf artifacts namespaces repos get "$REPO" --namespace "$NAMESPACE")"
  echo "Created."
fi
jq -e '.read_only' <<<"$repo" >/dev/null ||
  fail "$REPO exists but isn't read-only, and Cloudflare Artifacts can't change that. Delete it
  (cf artifacts namespaces repos delete $REPO --namespace $NAMESPACE --force), then re-run."

step "The Template in '$REPO'"
token="$(cf artifacts namespaces tokens create "$NAMESPACE" --repo "$REPO" --scope write --ttl 3600 | jq -r '.plaintext')"
ARTIFACTS_GIT_TOKEN="$token" node "$SCRIPTS_DIR/refresh-template-artifacts.mjs" \
  --remote "$(jq -r '.remote' <<<"$repo")"

printf '\nDone. README.md lists what CI needs to refresh it on every SDK publish.\n'
