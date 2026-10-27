# Camox CLI

The CLI does what the hosted platform needs from a terminal. Projects are created
from the dashboard at [camox.ai](https://camox.ai), and their content is edited
in the studio.

```sh
camox login              # sign in to Camox in the browser
camox logout             # sign out
camox release            # build the website and sync its definitions to Live
camox release --dry-run  # build it as a release would, without syncing anything
camox clone PROJECT      # clone a project's code, where its project allows it
camox push               # push the current branch's commits to a new draft
```

## Signing in

`camox login` opens the browser and stores the session in `~/.camox/auth.json`,
keyed by the Camox URL. A repository can override it for a given URL with its
own `.camox/auth.json`, next to its `.git`.

`camox logout` signs out of the authentication URL of the app it finds:
it looks for `node_modules/.camox/runtime.json` from the current directory, or
from `--cwd PATH`, walking upward. Without one, it signs out of camox.ai.

## Releasing

`camox release` runs `vp build` in release mode. It needs `CAMOX_DEPLOY_TOKEN`
and is what the release and Upgrade sandboxes run, not something members run
by hand. `--dry-run` builds the same way without a token and without syncing
definitions to Live, to check that a website builds.

## Cloning a project's code

On a project whose code can be worked on outside Camox (a flag set by hand on
the project), a member of its organization can clone its code
(ADR 0026). `camox clone PROJECT [DIRECTORY]` takes its Project Slug or Project
ID, clones its repo into `DIRECTORY` (its Project Slug by default), then runs
`pnpm install`.

The clone authenticates with short-lived read tokens. `camox clone` sets
`camox git-credential` as the credential helper for the repo's host in the
clone's own `.git/config`, never in the global one, so `git fetch` and
`git pull` get a fresh token from the API with your Camox login when they need
one. `git-credential` is the helper Git runs, not a command to run by hand.

## Pushing to a draft

From a clone, `camox push` sends the current branch's commits to Camox, which
opens a draft named after the branch with them (ADR 0026). It reads the Project
ID from the checkout's `vite.config.ts`, fetches `main`, and sends the commits
since the branch's merge base with `main` as a Git bundle to the API, never to
the repo. The API checks them first and refuses, writing nothing, a branch that
changes a platform-owned file or anything under `src/` other than TypeScript or
CSS, that starts from a commit never on `main`, that is missing an Upgrade on
`main` (merge `main` first), that conflicts with `main`, or whose head doesn't
build. An accepted push lands the commits as they are on the draft's branch and
builds the head as one revision. `camox push` waits for that build, sets the
branch's upstream to the draft's branch, and prints the draft's studio URL. A
refusal prints its message, with the build's errors when it doesn't build, and
exits non-zero.

## The SDK's auth module

`@camox/cli/auth` exports the token storage and sign-in helpers the SDK's Vite
plugin imports.

## The Template's copy

`scripts/` refreshes `template-default` on Cloudflare Artifacts, which new
projects fork. See [scripts/README.md](scripts/README.md).
