#!/usr/bin/env bash
# PROTOTYPE #552, throwaway: serve one landing build under /_camox/r/abc/ next to the usual /.
# Run from apps/landing after `pnpm --filter camox build`.
set -euo pipefail
CAMOX_INTERNAL_RELEASE=dry-run pnpm exec vp build
rm -rf /tmp/p552-prefixed && mkdir -p /tmp/p552-prefixed/client/_camox/r/abc
cp -R dist/camox_landing /tmp/p552-prefixed/worker
cp -R dist/client/. /tmp/p552-prefixed/client/_camox/r/abc/
cp prototype-552/setAssetBase.js prototype-552/entry.js /tmp/p552-prefixed/worker/
jq '.main="entry.js" | .vars={CAMOX_ASSET_BASE:"/_camox/r/abc/"}' dist/camox_landing/wrangler.json > /tmp/p552-prefixed/worker/wrangler.json
echo "Root:     (cd dist/camox_landing && wrangler dev -c wrangler.json --port 8901)"
echo "Prefixed: (cd /tmp/p552-prefixed/worker && wrangler dev -c wrangler.json --port 8902)"
