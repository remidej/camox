# PROTOTYPE, throwaway: type checking in an isolate

For "Type checking in an isolate" (remidej/camox#519), on the map "The agent changing a site's code" (#512). Measured on 2026-10-23 with `@tsrs/wasm` 0.18.0-ts7.1.0-dev.20260929.

The question: can tsrs check a hosted site in a Durable Object within 128 MB, re-check one saved block fast enough for the agent's loop, and return readable diagnostics?

## What a hosted site's check reads

A copy of `apps/template-default` set up as `makeStandalone` does (`camox@^0.48.0` from npm, catalog versions filled in), checking `src/` only. `vite.config.ts` is platform-owned and fails on its own anyway (no `@types/node`).

- 1,287 files read, 8.6 MiB of `.d.ts`. Only 17 are the site's own.
- Most come through `@camox/api-contract`: its root `index.d.ts` (462 KB) inlines the API's oRPC router type, which pulls in better-auth, kysely, zod, typebox and type-fest. `camox`'s `structuredData.d.ts` imports that root for `ARTICLE_TYPES`, `EvaluatedNode` and `RecordStructuredData`, so every block check pays for it.
- Native TypeScript 7 (`tsgo`) uses 296 MB for this.

## Results

"Linear" is tsrs's WebAssembly memory, including its built-in 80 MiB stack. Production is a deployed Durable Object; the wall time is seen by the calling Worker, since timers freeze during the check.

| file set                                                        | Node (M1 Pro) |  linear | production DO                                                                  |
| --------------------------------------------------------------- | ------------: | ------: | ------------------------------------------------------------------------------ |
| today's types, whole `src/`                                     |         0.6 s | 172 MiB | **wrong answer**: stops after 382 of 1,287 files, a false TS2554 in `hero.tsx` |
| slim types (api-contract stubbed), whole `src/`                 |        0.36 s | 135 MiB | correct, 1.0–1.5 s warm, 2.5–2.8 s first                                       |
| slim, 4× the Template's blocks and components                   |        0.56 s | 171 MiB | correct, 1.2–2.1 s                                                             |
| slim, 6×                                                        |         0.9 s | 173 MiB | correct, 2.5–3.8 s                                                             |
| slim, 11×                                                       |         0.9 s | 245 MiB | isolate killed: "exceeded its memory limit and was reset"                      |
| slim, 21× and 41×, changed files only (`files: [hero, layout]`) |         0.3 s | 134 MiB | (flat, not deployed)                                                           |
| synthetic 40 × 1,500 interfaces                                 |         3.3 s | 317 MiB | isolate killed                                                                 |

- Diagnostics come back as data: an injected `const oops: number = 'x'` returns `hero.tsx` line 86, TS2322, "Type 'string' is not assignable to type 'number'."
- Every check is cold: a fresh instance re-parses React's and Camox's types. `--incremental` with `.tsbuildinfo` passed back is slower (0.79 s against 0.6 s) and bigger (181 MiB), so it's no help.
- Six checks in a row ran in one isolate without a reset at 135 MiB linear, so untouched stack pages don't seem to count against 128 MB.

## The wrong answer: root cause

In production, `memory.buffer` throws `RangeError: Invalid array buffer length` on some file reads, after a single 16 MiB growth (1,855 to 2,112 pages). `core.js`'s `fsCall` catches every exception other than `NotFoundError` and returns an error code. tsrs then drops that branch of the import graph without a diagnostic, and the check "passes" with a wrong result. `core.js.patch` records the swallowed errors. This is very likely oxc-project/tsrs#718. Local workerd, Node, and Node with a frozen clock or an 80 KB stack are all correct.

A plain `WebAssembly.Memory` grown 1,855 to 2,112 pages in a fresh isolate is fine. Holding 16–32 MiB of extra JS memory didn't move the cutoff, so the trigger isn't simply isolate memory. It's still unexplained.

## Not measured

- A tsrs build with a smaller stack (`TSRS_WASM_STACK_SIZE`). There was no Rust toolchain, and untouched stack pages seem not to count anyway.
- The fallbacks from #369 (TypeScript's JS compiler in a DO, a type-checking Container). tsrs fits once the types are slim and the check is scoped.

## Running it

Set up `/tmp/tpl` as above, then `tsgo -p tsconfig.check.json --listFiles` into `files.txt`, `node build-files.mjs files.txt files-full.txt`, `node make-slim.mjs`, `node node-one.mjs slim-all.txt slim.txt`, and `node make-grown.mjs <n> grown<n>.txt`. For production: copy one set to `set.txt`, put `tsrs.wasm` beside `worker.js`, run `wrangler deploy`, then `curl '<url>/?do=<name>&steps=cold,edit,error'`. Deploy one set at a time, since bundled sets count against the isolate's memory.
