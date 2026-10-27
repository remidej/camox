# Members push code to drafts through the API, never to the repo

Camox's own website, camox.ai, needs to be built from a checkout, with a developer's coding agent, before Camox's agent can build it alone. So on a project that allows it, a member can push commits from their own checkout onto a draft, where they become a revision like the agent's, previewed and published like any other. Cloudflare Artifacts write tokens cover a whole repo, with no branch protection and no check before a push lands. A token that could push a draft's branch could also push `main`, which releases, or rewrite other drafts' branches. So pushes go to the Camox API, which checks them and writes the draft's branch itself: Camox stays the only writer of a project's repo. Reads are plain Git, with short-lived read tokens. This is an escape hatch for Camox's own projects, behind a per-project flag, not the way websites are built.

## Considered Options

- **Write access to the Git server, with a push to a branch opening a draft.** Publishing's guards come too late: the push has already landed, and could have gone to `main`.
- **Checks in the CLI only.** Anyone holding the write token can skip the CLI.
- **A one-way export from the monorepo**, like the Template's refresh. Whatever else moves `main` (publishes with code, Upgrades) would be overwritten, so Camox's agent couldn't change the code.
- **A Git proxy that checks pushes**, so a plain `git push` works. The same checks for much more work. It can come later, on top of the same checks.
- **A local dev server working in a development draft.** A draft whose code runs on one member's machine can't be previewed or published by anyone else, and every surface would have to handle that (ADR 0027).

## Consequences

- Pushed code follows the same line as the agent's (ADR 0021). In the pushed tree, every file outside `src/**/*.{ts,tsx,css}`, or under `src/camox/`, must be identical to the current `main`'s. Merging `main` locally, Upgrades included, passes. An unmerged Upgrade or a changed `vite.config.ts` is refused. A push can't add dependencies.
- A push is refused, and writes nothing, when:
  - it doesn't include the draft's current head ("pull first");
  - it starts a draft from a commit that was never on `main`, or that conflicts with the current `main`;
  - its branch's draft was published or deleted;
  - its head doesn't build.
- The API fast-forwards the draft's branch to the pushed head and keeps the commits as they are, so the checkout and the draft share history. Only the head is built, as one revision left by the push. Type errors are Blockers, as for the agent's revisions.
- A push waits in the draft's build queue behind an agent turn, as a merge of `main` does. Like a later agent turn, it aborts a publish confirmation back to the review (ADR 0020). It adds an entry to the draft's thread naming the member, their commits, and whether they built. The agent reads it as context and doesn't answer it.
- When `main` later moves and conflicts with a pushed draft, Camox's agent reconciles, as for any draft (ADR 0020).
- The first push from a local branch opens a draft named after the branch, and sets the branch's upstream to the draft's branch, which the draft's id names. A push can also name an existing draft, such as one the agent started. The checkout's Project ID names the project.
- The flag allows both cloning and pushing. A checkout has no dev server (ADR 0027). Type checks, lint and a dry-run release run locally, and a push is the only way to preview.
