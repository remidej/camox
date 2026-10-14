# Sandbox-free block changes on Cloudflare

Exploratory research, 2026-10-14. Nothing here is decided. It belongs to a later rethink of Camox as an all-in-one product hosted on Cloudflare.

## Question

Once an agent has written a new or changed block definition, how fast can that block be live on the hosted platform, without a sandbox running `vite dev` and without a full Vite build?

## Findings

### ISR is not the pattern

Next.js ISR regenerates a page's HTML when its _data_ changes. Any code change on Vercel still runs a full `next build`; Vercel only makes it faster with build caches and warm builders. Camox already keeps content out of the build: pages render on the server per request and read content from the API at runtime, so content edits never need a release. Only definition changes do. The ISR-like part that does apply is the two-speed shape described below: serve something quickly now, and replace it with a canonical build later.

### Blocks today are compiled into one module

`generateCamoxApp()` in `packages/sdk/src/features/vite/appGeneration.ts` writes `src/camox/app.ts`. That file loads every block with `import.meta.glob('../blocks/*.{ts,tsx}', { eager: true })`, which compiles to one static import per block. `hydratePageWithApp(camoxApp)` in `packages/sdk/src/features/runtime/pageClient.tsx` then hydrates the whole page with that app.

Consequences:

- Changing one block changes the hash of the chunk that contains it, and of every chunk importing it, up to the entry. Rolldown also decides chunk boundaries across the whole app, so adding a block can move shared code between chunks. A build can't be patched one block at a time.
- Every visitor downloads every block's code on every page, including blocks the page doesn't use. The editing UI is already split out (`React.lazy` in `packages/sdk/src/features/runtime/pageApp.tsx`), so the cost is block components and their imports only. It grows with the number of block definitions, not with what a page shows. Not measured yet.
- The server cost is negligible: a Worker loads its whole bundle anyway.

### Proposed shape: shell, registry, revisions

- **Shell (full build, rare).** React, camox, layouts, `src/components` and npm dependencies, built with stable chunk names and preserved export names. Blocks are not part of it.
- **Registry module (generated for each revision).** Maps each block to a loader:

  ```ts
  // camox:registry
  export const blocks = {
    hero: () => import("./blocks/hero.a1b2c3.js"),
    pricing: () => import("./blocks/pricing.d4e5f6.js"),
  };
  ```

  The shell imports the bare name `camox:registry`, never a block file. On the server, each revision's module set contains its own `registry.js`. In the browser, the page's import map points `camox:registry` at the current revision's registry, and points `react`, `camox/*` and `@/components/*` at shell chunks. The shell never changes, so its hashes and cached copies stay valid. A new block costs one block file plus one registry file.

- **Preloading.** The server knows which blocks a page uses. It loads them before rendering, emits `<link rel="modulepreload">` for just those, and hydration waits for them, so there is no request waterfall or flash.
- **Revisions.** A revision is an immutable module set with an ID. Going live means moving the site's "current revision" pointer, and rollback means moving it back.

### Serving revisions with Dynamic Workers

Cloudflare Workers can't evaluate code at runtime (no `eval`, no importing modules that weren't uploaded), so a new block can't simply be fetched by the site's Worker. Dynamic Workers (the Worker Loader binding) fill that gap: a parent Worker starts another Worker from module source at runtime.

- Open beta for all paid Workers plans since March 2026. [changelog]
- `env.LOADER.get(id, callback)` caches isolates by ID and only calls `callback` when it needs the code. The same ID must always return identical code; new code needs a new ID, such as a revision hash. Caching is not guaranteed and the callback may run more than once. `load(code)` creates a fresh Worker on every call. [api]
- `WorkerCode` takes `mainModule`, a `modules` map (ES module, CommonJS, text, data, Wasm, JSON) and `compatibilityDate`. `env` can carry structured-cloneable values and service bindings. `globalOutbound: null` blocks `fetch()` and `connect()`. [api]
- `@cloudflare/worker-bundler` compiles TypeScript and resolves npm dependencies inside a Worker, producing modules the loader accepts. [playground]

The serving Worker would call `env.LOADER.get(revisionId, () => ({ mainModule, modules: { ...shellModules, ...blockModules, "registry.js": registry } }))`. The **whole site** runs in one Dynamic Worker, not one per block, because blocks must render inside the same React tree as the page. Isolation also comes for free: agent-written code only gets the bindings and network access it's given.

### Fast path for adding a block

1. Compile the single block file, treating the shell as external.
2. Generate CSS for the block's new Tailwind classes.
3. Write the block module and a new registry under a new revision ID.
4. Load the revision in a Dynamic Worker and have it return `camoxApp`'s definitions, then run `syncDefinitionsToApi`. Today that step uses a temporary Vite server's `ssrLoadModule` in the plugin's `closeBundle` (`packages/sdk/src/features/vite/vite.ts`).
5. Render the block once as a smoke test, which also serves as the "renderer is ready" signal.

Expected to take seconds rather than a build's tens of seconds to minutes. This is an estimate, not a measurement.

### What the fast path can't do

- **Imports outside the shell.** A new npm dependency, an edited shared component or layout, or a change to global CSS needs a full build, for example in a Cloudflare Container, finishing with the same revision swap.
- **Tailwind.** v4 builds one global stylesheet by scanning all sources. Its compiler is plain JS (Tailwind Play runs it in the browser), so per-revision CSS seems feasible. Unverified, especially class scanning without the native scanner.
- **React Compiler.** It's a Babel plugin, heavy to run in a Worker. Blocks work without it.
- **Type checking.** Running `tsc` inside a Worker isn't realistic. Either the agent checks against the shell's type definitions, or checking runs asynchronously.

That suggests two speeds: the fast path serves drafts, where speed matters while the agent iterates, and publishing triggers a full build that replaces the fast-path output. This keeps code that skipped type checking and the compiler out of production.

### Approval before going live

Since a revision only goes live when the pointer moves, approval is built in:

- **Live preview.** Open the candidate revision in the Studio's page renderer or a Canvas frame, on the real page with real content. Approve moves the pointer; reject discards the revision.
- **Screenshots.** Cloudflare Browser Rendering could capture the candidate's URL, both as a chat thumbnail and so the agent can see its own output and fix visual bugs before asking for approval. Not checked for cost or speed.
- **Where to render a new block.** A brand-new block has no placement yet. Render it on the draft page where the agent placed it, or on a scratch page filled with the block's default content.

### Going all-in on Cloudflare

Nitro exists to keep Camox framework-agnostic. Committing to Cloudflare would replace it with `@cloudflare/vite-plugin`, so dev runs in workerd like production and the fast path can be built and tested locally. Nitro is touched in:

- `packages/sdk/src/features/vite/vite.ts`: the `nitro.setup` block (route installation, `noExternals`, copying server assets to public).
- `packages/sdk/src/features/vite/runtimeDev.ts`: the `#camox/nitro-handler` virtual module and `installRuntimeNitroRoutes`.
- `packages/sdk/src/features/vite/devAuthentication.ts`: inserting authentication ahead of Nitro's dev middleware.
- `packages/sdk/src/features/og/imageResponse.node.ts`: OG images, which would need a Workers-compatible renderer, for example satori with resvg-wasm.
- Comments in `packages/sdk/src/core/createLayout.tsx` and `packages/sdk/src/features/vite/definitionsSync.ts`.

Nitro's Cloudflare output also bundles everything into one Worker, which is incompatible with a separate shell and per-block modules. That decision is hard to reverse and changes Camox's positioning from a devtool to a product, so it should get an ADR when it's made.

## Independent near-term step

Per-block lazy loading with SSR preloads (the registry and preload parts above, without revisions) would stop visitors from downloading every block on every page. It is worth doing on its own, and it is the first building block of the fast path.

## Open questions

- Does Tailwind v4's compiler, including class scanning, run inside a Worker?
- What are Dynamic Workers' current limits and pricing, and has the API left beta?
- Does `@cloudflare/vite-plugin` support the Worker Loader binding in local dev?
- What does Browser Rendering's screenshot API cost, and how fast is it?
- How large is the current client bundle's block code on a real site?
- Where does today's release time actually go: install, client build, server build, upload, or definitions sync?

## Sources

- [changelog] Dynamic Workers, now in open beta: https://developers.cloudflare.com/changelog/post/2026-03-24-dynamic-workers-open-beta/
- [api] Dynamic Workers API reference: https://developers.cloudflare.com/dynamic-workers/api-reference/
- [playground] Dynamic Workers Playground (`@cloudflare/worker-bundler`): https://developers.cloudflare.com/dynamic-workers/examples/dynamic-workers-playground/
- Dynamic Workers getting started: https://developers.cloudflare.com/dynamic-workers/getting-started
