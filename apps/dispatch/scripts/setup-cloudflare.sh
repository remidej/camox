#!/usr/bin/env bash
# Sets up what the dispatch Worker needs on Cloudflare, then deploys it. Safe to re-run: each step
# checks what exists before changing anything. README.md explains each step.
#
# Needs the `cf` CLI signed in to Camox's account (`cf auth whoami`), jq, and the workspace's
# dependencies installed (`pnpm install`).
set -euo pipefail

ZONE_ID="f6e109722a0b5bddbf3b01fa79bde309" # camox.site
NAMESPACE="production"
KV_TITLE="camox-site-slugs"
WILDCARD="*.camox.site"
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

step() { printf '\n==> %s\n' "$1"; }
fail() {
  printf 'Error: %s\n' "$1" >&2
  exit 1
}

for tool in cf jq pnpm; do
  command -v "$tool" >/dev/null || fail "$tool is not installed."
done

step "Workers for Platforms subscription"
if ! namespaces="$(cf workers-for-platforms dispatch-namespaces list 2>&1)"; then
  if grep -q 10121 <<<"$namespaces"; then
    fail "Workers for Platforms isn't subscribed. Subscribe in the dashboard, then re-run:
  https://dash.cloudflare.com/?to=/:account/workers-for-platforms"
  fi
  fail "$namespaces"
fi
echo "Subscribed."

step "Dispatch namespace '$NAMESPACE'"
if jq -e --arg name "$NAMESPACE" 'any(.[]; .namespace_name == $name)' <<<"$namespaces" >/dev/null; then
  echo "Exists."
else
  cf workers-for-platforms dispatch-namespaces create --name "$NAMESPACE" >/dev/null
  echo "Created."
fi

step "KV namespace '$KV_TITLE'"
kv_id="$(cf kv namespaces list | jq -r --arg title "$KV_TITLE" 'first(.[] | select(.title == $title) | .id) // empty')"
if [ -n "$kv_id" ]; then
  echo "Exists: $kv_id"
else
  kv_id="$(cf kv namespaces create --title "$KV_TITLE" | jq -r '.id')"
  echo "Created: $kv_id"
fi
grep -q "\"$kv_id\"" "$APP_DIR/wrangler.jsonc" ||
  fail "wrangler.jsonc doesn't bind KV namespace $kv_id. Set the SITE_SLUGS binding's id to it, then re-run."

step "Proxied DNS record '$WILDCARD'"
records="$(cf dns records list -z "$ZONE_ID" --name "$WILDCARD")"
if [ "$(jq 'length' <<<"$records")" -eq 0 ]; then
  cf dns records create -z "$ZONE_ID" --body "$(
    jq -n --arg name "$WILDCARD" '{
      type: "AAAA",
      name: $name,
      content: "100::",
      proxied: true,
      comment: "Sends every site to the camox-dispatch Worker"
    }'
  )" >/dev/null
  echo "Created AAAA 100:: (proxied)."
elif jq -e 'all(.[]; .proxied)' <<<"$records" >/dev/null; then
  echo "Exists."
else
  fail "A $WILDCARD record exists but isn't proxied, so requests would skip the Worker. Proxy it, then re-run."
fi

step "Dispatch Worker and its '$WILDCARD/*' route"
pnpm --dir "$APP_DIR" run deploy

printf '\nDone. README.md explains how to smoke-test a site.\n'
