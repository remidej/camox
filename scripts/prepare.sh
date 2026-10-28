#!/bin/sh
set -eu

# T3 runs this in a hidden terminal, so any prompt would hang worktree creation.
export CI=true

pnpm install --frozen-lockfile

# Dev servers compile apps on demand; only shared packages need built output.
# Keep this one-shot build in-process: nested worktree paths can exceed Nx's
# Unix socket limit for the daemon and isolated plugin workers.
NX_DAEMON=false NX_ISOLATE_PLUGINS=false pnpm exec nx run-many -t build --projects=tag:type:pkg

# The banner starts an npm update check that can delay exit after migrations finish.
WRANGLER_HIDE_BANNER=true pnpm --filter @camox/api db:migrate:local
pnpm --filter @camox/api seed --if-empty

# camox.ai's checkout needs a Camox login; a worktree without it still works.
bash scripts/camox-ai-checkout.sh ||
  printf 'Skipped camox.ai checkout: see "camox.ai'"'"'s checkout" in CONTRIBUTORS.md\n' >&2
