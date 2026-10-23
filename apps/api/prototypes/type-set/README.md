# PROTOTYPE, throwaway: the type set for a revision's check

For "The type set for a revision's check" (remidej/camox#556), on the map "The agent changing a site's code" (#512). Builds on "Type checking in an isolate" (#519): tsrs in a Durable Object, one cold check per agent turn of the changed files plus their importers. Measured on 2026-10-23 with `@tsrs/wasm` 0.18.0-ts7.1.0-dev.20260929 in Node 24.16 on an Apple M1 Pro, never deployed.

Three questions: which declaration files the check gets and where they come from, what slim `camox` types look like, and how to find a changed file's importers (and whether a type change reaches past them).

## Setup

- `/tmp/p556/site`: a copy of `apps/template-default` with `camox@0.48.0` from npm and the catalog versions filled in, installed with pnpm (`--ignore-workspace`). It must live **outside this repo**: inside it, module resolution walks up into the monorepo's `node_modules` and resolves things a hosted site can't (see "Published types reach unpublished packages").
- `/tmp/p556/site-slim`: the same, with this branch's `camox` and `@camox/api-contract` builds swapped in (`node swap-sdk.mjs /tmp/p556/site /tmp/p556/site-slim`, after `pnpm build` in both packages).

## Slim `camox` types (the code change on this branch)

`@camox/api-contract`'s root re-exported `Router`, `PublishPreview` and `EntityKind` from `apps/api`. They now live in a new `@camox/api-contract/router` subpath, and the 7 importers (SDK studio/runtime code, the CLI, the dashboard) import from there. Nothing else changed.

- The contract's root `index.d.ts`: 478 KB to **6.4 KB**. `router.d.ts` takes the 472 KB.
- What each site-facing `camox` entry adds on top of React (`node build-type-set.mjs <site> entries`):

| entry | today (0.48.0 on npm) | slim |
| --- | ---: | ---: |
| `camox/createBlock` | 1,135 files, 4.8 MiB | 354 files, 1.5 MiB |
| `camox/createLayout`, `createCollection` | 1,096 files, 4.1 MiB | 315 files, 0.8 MiB |
| `camox/navigation` | 84 files, 0.3 MiB | same |
| `camox/document` | 9 files, 0.2 MiB | same |

- Entries a site's `src/` has no business importing still reach the router type with slim types: `camox/vite`, `CamoxPreview`, `_internal/runtime`, `_internal/pageServer`, `_internal/studioServer` (~1,000–1,230 files, ~5 MiB each). The type set leaves them out, so importing them from `src/` fails the check with TS2307, which matches "What code the agent may change".
- The remaining weight in slim `createBlock` is TypeBox (192 small files), TanStack Query and Router, unhead and zod (95 files, only through `@camox/api-contract/ids`, for one UUID schema). Not worth more work now: the check fits.

## The type set

`node build-type-set.mjs <site> <reach|all> out/<name>.json`: a `{ "/project/node_modules/<pkg>/…": text }` map, flattened out of pnpm's store, each package's `package.json` included. TypeScript's `lib.*.d.ts` are left out (tsrs bundles them).

- **reach**: what the Template's current `src/` reads (`tsgo --listFiles`).
- **all**: the closure of every types entry of every runtime dependency (`react`, `react-dom/*`, `@tanstack/react-query`, `class-variance-authority`, `clsx`, `lucide-react`, `tailwind-merge`, their subpaths), the site-facing `camox` entries above, `@types/react(-dom)` and the tsconfig's `types` (`vite-plus/client`). Build tooling and CSS-only packages (`tailwindcss`, `@tailwindcss/vite`, fonts) are left out.

| set | packages | files | JSON | gzip | brotli | `JSON.parse` |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| today, reach | 41 | 1,276 | 8.9 MiB | 1.17 MiB | 0.84 MiB | 14 ms |
| slim, reach | 21 | 475 | 5.4 MiB | 0.66 MiB | 0.49 MiB | 7 ms |
| slim, all | 22 | 492 | 5.4 MiB | 0.67 MiB | 0.49 MiB | 7 ms |

- "all" costs 17 files more than "reach", so the set can simply be everything installed: no surprise TS2307 when the agent first imports `@tanstack/react-query` or `clsx/lite`.
- `lucide-react` is one 2.2 MiB `.d.ts`, 41% of the slim set. `csstype` is 0.9 MiB more.
- One duplicate-version check runs on the flattening; the Template has none.

Checking the Template's whole `src/` with tsrs (`node measure-sets.mjs /tmp/p556/site-slim out/*.json`), 3 warm runs:

| set | ms | linear memory | files read | diagnostics |
| --- | ---: | ---: | ---: | ---: |
| today, reach | 589, 579, 571 | 171.9 MiB | 1,287 | 0 |
| slim, reach | 335, 326, 308 | 135.3 MiB | 486 | 0 |
| slim, all | 303, 313, 336 | 135.3 MiB | 486 | 0 |

The same numbers as #519's stubbed contract, now from real slim types. tsrs reads lazily, so the unused part of "all" costs nothing at check time; it only costs holding it in the isolate (about its JSON size as strings).

## Importers

`importers.mjs` builds the working copy's import graph from source text alone, with one regex: `import … from`, `export … from`, side-effect `import "x"` and `import("x")`, relative or `@/`-aliased. Package imports aren't edges. Cross-check: for `layouts/default.tsx`, tsrs read 12 `src/` files and the graph predicts 12.

The Template's graph (`node reach.mjs /tmp/p556/site-slim out/slim-all.json`): `lib/utils.ts` has 11 direct and 14 transitive importers (every `.tsx` file); `section.tsx` and `container.tsx` 5 direct, 6 transitive; a block has 0 or 1 (the layout, which imports `navbar` and `footer` statically and `hero` and `faq` through `import()`). Building the graph takes 0.6 ms for the Template and 3–4 ms at 41× its size.

### Can a type change reach past the direct importers? Yes.

Agent-like edits, each checked three ways. "Errors in" lists the files with diagnostics.

| edit | whole `src/` | changed + direct importers | changed + transitive importers |
| --- | --- | --- | --- |
| remove the button's `outline` variant | navbar | same | same |
| rename the button's `plain` variant | mobile-menu | same | same |
| rename the `dark` color scheme | footer, hero, navbar | same | same |
| `cn()` takes strings only | 11 files | same | same |
| footer exports `footer`, not `block` | layout | same | same |
| agent wrote `CtaButton` (props = `ComponentProps<typeof Button>`) and a `cta` block using `variant="outline"`; then removes `outline` | cta, navbar | **misses cta** | cta, navbar |
| delete `components/ui/container.tsx` | 5 blocks | **misses all** (no node left) | **misses all**, unless importers come from the graph before the turn too |
| `icons.gen.d.ts` (a global) changes | hero | **misses** | **misses** (no import edge) |

- **Through an intermediate's exported types.** `cta-button.tsx` has no error (it spreads its props), but its props type changed, so `cta.tsx` breaks two hops away. Direct importers aren't enough; transitive importers were enough in every import-shaped case.
- **Deleted or renamed files** only have importers in the graph from before the turn. Take importers from the old and the new graph.
- **Ambient files** (any `.d.ts` in `src/`, anything with `declare global` or `declare module`, the tsconfig) reach files without an import. `src/camox/icons.gen.d.ts` is one: Camox writes it from the project's icon collection. Every check includes the ambient files as roots, and a change to one means a whole-`src/` check.
- Checking roots also checks everything they import (TypeScript reports diagnostics for every source file in the program), so nothing below the cone needs adding.

### Cone sizes as a site grows

`node scale.mjs /tmp/p556/site-slim out/slim-all.json 0,5,10,20,40 <batch>`: N extra copies of every block and component, all importing the shared `lib/utils` and `components/ui/*` (as #519 grew it).

| size | `src/` files | `lib/utils` cone | `ui/section` cone | a block's cone | `utils` cone, one check | `utils` cone in batches of 20 roots |
| --- | ---: | ---: | ---: | ---: | --- | --- |
| 1× | 17 | 15 | 7 | 2 | 410 ms, 135 MiB | — |
| 6× | 82 | 80 | 32 | 2 | 644 ms, 174 MiB | — |
| 11× | 147 | 145 | 57 | 2 | 731 ms, **246 MiB** | — |
| 21× | 277 | 275 | 107 | 2 | 1,289 ms, **258 MiB** | — |
| 41× | 537 | 535 | 207 | 2 | 2,161 ms, **347 MiB** | 27 checks, 8.6 s total, peak 171 MiB |

(10-root batches: 54 checks, 15.4 s, peak 168 MiB.) #519 saw the isolate killed at 246 MiB and fine at 174 MiB, so a change to a shared component on a site past ~6× the Template can't be checked in one isolate. Batches fit, but each is cold (~0.3 s floor), so they'd need several isolates in parallel to stay near a second. A changed block's cone stays at 2 files at any size.

## The Container alternative

Since "Building a revision in a Container" (#550) builds every revision in full in the release Container, inside the turn, with `node_modules` installed, I timed native `tsgo` on the same sites:

| site | wall | max RSS |
| --- | ---: | ---: |
| Template, today's types | 0.41–0.48 s | 410 MB |
| Template, slim types | 0.38–0.42 s | 328 MB |
| 41×, today's types | 1.35 s (3.2–4.1 s `--singleThreaded`) | 1.0–1.3 GB |

That's whole `src/`, no type set, no importer graph, no slim types needed, and under 10% of the 7–15 s warm build it would run next to.

## Not measured

- Deployed numbers. Everything here ran in Node; #519's deployed numbers apply to the same file counts.
- Storing the type set in the check's Durable Object SQLite and reading files lazily (tsrs's file bridge is synchronous, and so is `ctx.storage.sql.exec`), against holding the JSON in the isolate.
- Where the type set is built (the release pipeline per SDK version, or the build Container per lockfile).

## Published types reach unpublished packages

`@camox/api-contract@0.48.0`'s published `index.d.ts` imports `@camox/ai-tools`, a private workspace package, plus `agents/*`, `cloudflare:workers` and `@cloudflare/ci`. A hosted site can't resolve them and `skipLibCheck` hides it. With slim types they're only in `router.d.ts`, which a site never loads.
