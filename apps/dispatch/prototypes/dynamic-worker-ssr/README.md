# PROTOTYPE, throwaway: server rendering in a Dynamic Worker (#522)

Can a Camox-owned Worker render a Camox site in a Dynamic Worker, and at what memory and cold-start cost? It renders `apps/landing`'s homepage (the production site, content from `api.camox.ai`) from its server build, loaded with `LOADER.get(revisionId, …)`. It was deployed and measured on 2026-10-23, then deleted, along with its R2 bucket and dispatch namespace.

- `make-module-map.mjs` turns `apps/landing/dist/camox_landing` (built with `CAMOX_INTERNAL_RELEASE=dry-run npx vp build`) into a module map: 22 JS modules (5.03 MiB) plus one 3.8 MiB Wasm module (OG images). It went to the scratch R2 bucket `camox-proto-522`.
- `worker.js`, `wrangler.jsonc`: the loader Worker (`camox-proto-522-loader`).
  - The Dynamic Worker's only network is `ContentGateway`, a `ctx.exports` entrypoint as `globalOutbound`, which forwards requests to `api.camox.ai` and refuses the rest. The SDK reads content over HTTP, so this stands in for an RPC stub without changing the SDK.
  - `Tailer` records each invocation's CPU and wall time from tail events.
  - A wrapper entry module adds memory ballast (1 MiB arrays of doubles) before or after the render.
  - `/stub` passes a stub of a user Worker in the scratch dispatch namespace `prototype-522` into a Dynamic Worker's `env`, as is and wrapped in a `WorkerEntrypoint`.
- `site-worker/`: that user Worker, with `fetch` and an RPC method.
- `node-bench.mjs`: the same render in Node, for memory (`node --expose-gc node-bench.mjs`).

## Results (deployed, `remidej.workers.dev`, requests from France)

|                                                       |       wall | CPU (tail events) |
| ----------------------------------------------------- | ---------: | ----------------: |
| read the module map from R2 (9 MB)                    | 160–920 ms |                   |
| Dynamic Worker startup: ship modules, parse, evaluate | 320–870 ms |                   |
| cold request, total                                   |  1.2–4.1 s |        110–190 ms |
| warm request (render only)                            | 340–650 ms |          35–58 ms |
| live `camox.ai`, time to first byte, for comparison   | 0.96–1.9 s |                   |

Startup is the total minus the R2 read minus the render, timed in the loader. Render wall time is mostly the site's calls to the API. Requests with the same id often reached a fresh isolate: the first 6 of 10 ran the code callback again.

Memory, by ballast until "Worker exceeded memory limit":

|                                     | most ballast that passed | first that failed |
| ----------------------------------- | -----------------------: | ----------------: |
| ordinary Worker (the loader itself) |                  250 MiB |           260 MiB |
| empty Dynamic Worker                |                  252 MiB |           256 MiB |
| site, ballast after the render      |                  250 MiB |           260 MiB |
| site, ballast before the render     |                  236 MiB |           240 MiB |

So a render peaks at about 16 MiB (12–20) and keeps under 10 MiB once done, and a Dynamic Worker gets the same budget as an ordinary Worker. Both pass about twice the documented 128 MB. Node agrees: +6 MiB after importing the modules, +15–23 MiB peak while rendering.

## Bindings

- `globalOutbound: null`: the site throws "This worker is not permitted to access the internet", as it reads content over HTTP.
- A dispatch-namespace stub (`env.DISPATCHER.get(name)`) passed directly into `env`: "internal error".
- The same stub wrapped in a `WorkerEntrypoint` from `ctx.exports`: both `fetch` and RPC methods work.
