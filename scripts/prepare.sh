#!/bin/sh
set -eu

pnpm install --frozen-lockfile

# Dev servers compile apps on demand; only shared packages need built output.
# Keep this one-shot build in-process: nested worktree paths can exceed Nx's
# Unix socket limit for the daemon and isolated plugin workers.
NX_DAEMON=false NX_ISOLATE_PLUGINS=false pnpm exec nx run-many -t build --projects=tag:type:pkg

# The banner starts an npm update check that can delay exit after migrations finish.
WRANGLER_HIDE_BANNER=true pnpm --filter @camox/api db:migrate:local
pnpm --filter @camox/api seed --if-empty
