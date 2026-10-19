# Previewing code changes without a dev server

Exploratory research, 2026-10-19. Nothing here is decided. It belongs to [the pivot to a platform for marketing teams](../product/pivot-to-a-platform-for-marketing-teams.md).

## Question

On the platform, Camox's agent writes code: it creates blocks and changes existing block definitions. Those changes live in a draft until someone publishes it. How can the studio render a draft's code changes, and update them as the agent iterates, without a container running `vite dev`?

## Context

- **No local install.** A website only ever runs on the platform, so development drafts go away. Instead, any draft can carry code changes. Each draft already holds its own definitions ([ADR 0006](../adr/0006-definitions-in-live-and-development-drafts.md)), which makes that possible. The details of the draft model are out of scope here.
- **Priorities, in order:** site performance for visitors, then the feedback loop for editors and the agent, then how fast publishing deploys.
- **Type safety is the agent's feedback loop.** Camox's APIs are designed around types so agents learn from type errors. Skipping type checking is not an option.

## Why coding platforms are slow to preview

Containers themselves start quickly now: Cloudflare Containers and Sandboxes are generally available, and Cloudflare reports a median time to interactive of about 650 ms for 100 simultaneous launches [containers]. The time goes into what runs after the container starts, on every cold preview:

1. `npm install`, or restoring `node_modules`.
2. Starting Vite and pre-bundling dependencies.
3. On the first page load, transforming each source file on demand, in a waterfall of requests as imports are discovered.
4. Server rendering through the same pipeline.

A generic platform has to do all of this because any file might have changed, `package.json` and the Vite config included.

## What Camox knows that generic platforms don't

Camox controls the framework, so it knows the shape of every site. Between two edits, almost nothing changes: React, the Camox SDK, npm dependencies, layouts and shared components stay the same. Only a few block files differ. Most of that unchanging code is even shared across every project on the same SDK version.

Today that advantage is unused: `generateCamoxApp()` in `packages/sdk/src/features/vite/appGeneration.ts` loads every block with an eager `import.meta.glob`, so blocks are compiled into the same module graph as everything else, and changing one block changes the hashes of the chunks up to the entry.

## Proposed shape

### A shell built once

The shell holds React, Camox, npm dependencies, layouts and shared components. It is built once per SDK version and dependency set, with stable chunk names and export names, and served from the CDN. Blocks are not part of it. Nothing is installed or pre-bundled when a draft opens.

The shell never imports a block file. It imports a registry module by a bare name, and each revision of the site has its own registry:

```ts
// camox:registry
export const blocks = {
  hero: () => import("./blocks/hero.a1b2c3.js"),
  pricing: () => import("./blocks/pricing.d4e5f6.js"),
};
```

A revision is an immutable set of modules with an ID. Each draft with code changes points at its latest revision.

### Compile only the file that changed

When the agent saves a file, a Worker compiles that one file: TypeScript and JSX to JavaScript, plus React Refresh registration calls. A compiler built to WebAssembly, such as oxc or esbuild, takes milliseconds per file. The output is stored under its content hash, and a new registry under a new revision ID.

### Server rendering in a Dynamic Worker

Workers can't evaluate code at runtime, so the site's own Worker can't render a block the agent just wrote. Dynamic Workers fill that gap: a Worker starts another Worker from module source at runtime, through the Worker Loader binding. They have been in open beta since March 2026 [dynamic-workers].

- `env.LOADER.get(id, callback)` caches a Dynamic Worker by ID and only calls the callback when it needs the code, so a revision stays warm across requests. The same ID must always return the same code, which a revision ID guarantees. `load(code)` creates a fresh Worker on every call [dynamic-workers].
- `globalOutbound: null` blocks `fetch()` and `connect()`, so agent-written code only reaches what it's given [dynamic-workers].
- The whole site runs in one Dynamic Worker per revision, not one per block, because blocks render inside the same React tree as the page.

A preview request then costs one Worker request on top of a normal page load. Content already comes from the API at request time, so no content needs building either.

### Native modules in the browser

The browser loads the shell's chunks and the revision's block modules as native ES modules. An import map points `camox:registry` at the revision's registry, and `react`, `camox/*` and shared components at shell chunks. The server knows which blocks each page uses, so it emits `<link rel="modulepreload">` for them, and hydration waits for them: no request waterfall and no flash. This matters for the Canvas, which shows many pages at once.

### Hot reload over the realtime room

Vite's hot reload is mostly a protocol around React's Fast Refresh runtime, which is small. Camox already has one realtime room per project. On save, it broadcasts that a module now lives at a new hash; the Canvas imports the new URL and Fast Refresh swaps the component while keeping its state.

### Tailwind

Tailwind v4's compiler is plain JavaScript (Tailwind Play runs it in the browser), so a Worker can generate CSS for the classes a saved file introduces. Per-revision CSS without the native class scanner is unverified, and it's the step most likely to break the milliseconds-per-save budget.

### Type checking in a warm Durable Object

[ts-rust](https://github.com/pingdotgg/ts-rust) is an experimental Rust port of the TypeScript 7 compiler, made to run a checker in WebAssembly. It does full type checking, ships a WebAssembly build in `crates/ts_wasm`, and is MIT licensed [ts-rust].

- Each draft with code changes keeps a checker warm in its own Durable Object and checks incrementally: unchanged types stay loaded, and a save only re-checks the changed file and the files that depend on it.
- The preview renders as soon as the file compiles, and diagnostics arrive just after. The agent waits for them before saying it's done, so the feedback loop stays strict without the preview waiting on the checker.

Open points: a Worker isolate gets 128 MB of memory, and ts-rust's README reports 230 to 320 MB for an editor session after 10,000 edits, so whether one Camox site's check fits is the first thing to measure. The README also calls it an early, unreviewed port pinned to one TypeScript revision. The WebAssembly file has to fit within the Worker script size limit [ts-rust].

## Live is a full build

Visitors come first, so Live keeps the whole-app optimizations: a full Vite build with whole-app chunking, the React Compiler, and minified CSS, deployed as a regular Worker. Visitors never touch Dynamic Workers. The fast path only serves drafts.

The full build needs a container, which is the one place it stays. Publishing still doesn't have to wait for it:

- **Build ahead.** After each agent turn that changes code, the platform builds the draft in the background, keyed by the draft's code hash. Publishing finds the build ready in most cases and only deploys and swaps content. It waits only if the code changed since the last build.
- **A failed build is a blocker** on the draft, visible before anyone tries to publish.
- **Check the build against the preview.** The draft preview skips the React Compiler and chunks and styles differently. Before Live switches, render the built draft's pages and compare them with the preview, for example with screenshots from Cloudflare Browser Rendering.
- **Code and content go live together.** Build the new revision, then switch Live's code and content in one step, so Live never serves new code with old content or the reverse.

## Outside the fast path

Some changes reach beyond block files. They should be rare, and each has a likely answer short of a container:

- **A new npm dependency.** `@cloudflare/worker-bundler` resolves npm dependencies and compiles TypeScript inside a Worker [worker-bundler]. Alternatively, drafts load the package from esm.sh, marked external to React (`?external=react,react-dom`) so it shares the shell's copy; its `X-TypeScript-Types` header gives the checker its types [esm-sh]. For server rendering, the platform fetches the source once and passes it to the Dynamic Worker as modules. Live gets the dependency from its full build either way.
- **A change to `styles.css`.** It's a shadcn theme, so a draft can override the CSS variables in a `<style>` tag.
- **A type checker that doesn't fit in an isolate.** TypeScript's own JavaScript compiler runs in a Durable Object as is, more slowly. Failing that, a small container that only type checks, without Vite, an install or server rendering.

## Prototype first

1. Can ts-rust's WebAssembly build check a real Camox site within 128 MB?
2. Can Tailwind generate a saved block's CSS fast enough for each save?

## Sources

- [containers]: [Containers and Sandboxes are now generally available](https://developers.cloudflare.com/changelog/post/2026-04-13-containers-sandbox-ga/), Cloudflare changelog, 2026-04-13; scheduling figures reported in [InfoQ](https://infoq.com/news/2026/04/cloudflare-sandboxes-ga).
- [dynamic-workers]: [Dynamic Workers, now in open beta](https://developers.cloudflare.com/changelog/post/2026-03-24-dynamic-workers-open-beta/), Cloudflare changelog, 2026-03-24, and the [Dynamic Workers docs](https://developers.cloudflare.com/dynamic-workers/).
- [worker-bundler]: [Dynamic Workers Playground](https://developers.cloudflare.com/dynamic-workers/examples/dynamic-workers-playground/), Cloudflare docs.
- [ts-rust]: [pingdotgg/ts-rust README](https://github.com/pingdotgg/ts-rust).
- [esm-sh]: [esm.sh](https://esm.sh/), not checked against its docs for this note.
