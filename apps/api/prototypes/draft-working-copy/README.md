# PROTOTYPE, throwaway: the draft's working copy (#521)

Can a Durable Object hold a draft's working copy and commit each agent turn to the project's Artifacts repo with isomorphic-git, within 128 MB? It uses `isomorphic-git` 1.44.3 and the API's `MemoryFs` (`src/lib/memory-fs.ts`). It was deployed and measured, then deleted, along with its `prototype-521` Artifacts namespace.

- `make-repos.mjs` builds the test repos from a clone of `template-default` (camox 0.48.0, 34 files, 326 KB, 271 KB of it `pnpm-lock.yaml`):
  - `tpl`: the Template.
  - `grown`: `src/blocks` and `src/components/ui` grown to 40× (541 files, 1.37 MB).
  - `long`: the Template after 20,000 agent turns on `main` (53 MiB pack). The drafts forked 500 turns ago and have 100 turns of their own.
  - Each has `draft`, `draft-conflict` (edits the same line of `faq.tsx` as `main` does), and two more `main` commits after the fork: a published draft and an Upgrade.
- `ops.js`: shallow clone, one turn (edit 3 files, add 1, commit, push), merge `main` into the draft, and reading the tree through the binding.
- `node-bench.mjs`: the same operations in Node, for memory (`node --expose-gc node-bench.mjs turn|merge|conflict|full <repo>`, with `DEPTHS=<draft>,<main>` for known depths).
- `worker.js`, `wrangler.jsonc`: a Durable Object running them, plus saving and restoring the `MemoryFs` to the DO's SQLite.

Pushes go to `bench/*` refs, so the drafts stay where they are between runs.

## Memory (Node 24, V8 heap + external, peak over the baseline)

| repo                                        |                 clone depth 1 + turn | + merge main | merge with a conflict |
| ------------------------------------------- | -----------------------------------: | -----------: | --------------------: |
| tpl                                         |                               15 MiB |       17 MiB |                19 MiB |
| grown (40×)                                 |                               29 MiB |       33 MiB |                33 MiB |
| long, deepening until a merge base is found |                               16 MiB |    47–56 MiB |                49 MiB |
| long, known depths (draft 101, main 503)    |                                      |       46 MiB |                       |
| long, **whole history** (no depth)          | 615 MiB peak, 129 MiB retained, 64 s |              |                       |

## Time (deployed DO, wall)

`performance.now()` only moves on I/O in Workers, so CPU-only steps (commit, merge, SQLite save/restore) read 0 ms there. In Node: commit 15–20 ms, merge 25–65 ms.

| step                                                        |                                          tpl |      grown |                                        long |
| ----------------------------------------------------------- | -------------------------------------------: | ---------: | ------------------------------------------: |
| `createToken` per request                                   |                                 100–1,000 ms |            |                                             |
| shallow clone of the draft                                  |                                       520 ms |     430 ms |                                370–1,050 ms |
| push one turn                                               |               210–440 ms (one 2.2 s outlier) | 330–440 ms |                                  255–370 ms |
| save the whole MemoryFs to SQLite / restore it              | under timer resolution (0.44 / 1.5 / 3.9 MB) |            |                                             |
| read the tree through the binding (`readTree` + `readBlob`) |                                        2.0 s |      3.0 s |                                       0.4 s |
| merge main, deepening                                       |                                    1.1–7.8 s |      1.1 s |                         HTTP 500 after 86 s |
| merge main, known depths (draft 101, main 503)              |                                              |            |            7–10 s, of which fetch 3.4–4.9 s |
| merge main, steady state (base already local, main moved 1) |                                              |            |     1.35 s: one 0.4–0.9 s fetch, 0.4 s push |
| whole-history clone                                         |                                              |            | "exceeded its CPU time limit and was reset" |

## Other findings

- Artifacts refused a single push of the 20,000-commit history: `pack offset metadata exceeds memory budget`. Pushing it in 2,000-commit chunks worked, about 33 s each.
- The merges came out right: the merge of `long` matched `git merge-tree` exactly, and parents were (draft, main).
- `isomorphic-git`'s merge reports conflicts (`MergeConflictError` with the paths) and commits nothing.
- A restored MemoryFs (working tree, `.git` and `shallow`) commits and pushes without re-cloning.
