# Drafts carry code

Camox's agent changes a hosted site's code, and one request often mixes code and content ("add a pricing section with this copy"). So any draft can carry code changes beside its content, and publishing it releases both together. A draft's code is a Git branch in the project's Artifacts repo, created on its first code change, with one commit per agent turn. A draft with code holds its whole definition set, synced from each preview revision the way dev mode syncs a development draft (ADR 0006). To publish, Camox builds the draft's code and serves it reading Live overlaid with the draft, so from its first request the new code sees the content it was previewed with. The publish batch then makes Live match ([Drafts carrying code](https://github.com/remidej/camox/issues/517)).

## Considered Options

- **Code only in a separate kind of draft**, or in one code draft per project. The first splits one request across two drafts; the second makes agents wait on each other.
- **Git keeps only `main`**, with a draft's changed files in the database. Undoing one agent turn would need a second history beside Git.
- **A fork of the repo per draft.** Hundreds of repos per project for nothing a branch doesn't do.
- **Code first, content a few seconds later.** Visitors could see new code with old content in between.
- **Versioned Live content**, with each Worker version pinned to a content version. The same atomic switch, but every Live read would filter by version, reopening ADR 0005 and ADR 0008.
- **Merging `main` into a draft only when publishing**, or replacing Live's code like a content conflict. The first lets previews drift from what publishing produces; the second silently undoes code another draft or an Upgrade published.

## Consequences

- Publishing a draft with code starts the release Workflow for that draft. It builds the branch, uploads a Worker version without serving it, re-checks conflicts, promotes the version, then runs the publish batch, which also syncs the draft's definitions to Live (ADR 0009). A push to `main` still starts a plain release, for Upgrades.
- `main` moves only once the build succeeds, by one squashed commit per publish. Publishing and discarding both delete the draft's branch, so per-turn commits only serve undo while the draft is open.
- If the batch aborts after the version is promoted, because conflicts changed, the previous Worker version is promoted back and the confirmation shows the new conflicts.
- Code that doesn't build or type check is a blocker, fixed in the draft like any other.
- When `main` moves, Camox merges it into every open draft's branch, so untouched code shows the new Live as untouched content does. A merge conflict is a blocker.
- A draft that never changes code reads Live's definitions, as before.
- Development drafts stay, as drafts whose code is on a member's machine, with their rules unchanged (ADR 0006, ADR 0010). Only `apps/landing` uses them, until it is hosted.
- Live still keeps no history (ADR 0008). Undoing a publish is planned separately: the Live rows a publish overwrote plus the previous Worker version, restored by publishing a draft through this same path.

## Amendment: when `main` moves under a draft

Camox merges `main` into every open draft with code as soon as `main` moves, waking drafts that are idle. A draft whose agent is mid-turn merges right after that turn's commit, before any queued messages. A clean merge that passes the type check is silent: the preview simply picks up Live's new code. A merge that conflicts, or that merges cleanly but no longer type checks, is the same blocker, "code that doesn't merge with Live's". Camox fixes it with an agent turn of its own in the draft's thread, because editors review previews, never code (ADR 0021). It isn't a Conflict to confirm, since overwriting Live's code would silently undo what another draft or an Upgrade published ([Conflicts when main moves under a draft](https://github.com/remidej/camox/issues/537)).

### Considered Options

- **Ask an editor before resolving.** They would be asked about code they can't judge.
- **Keep the draft on its old base until publishing.** Previews would drift from what publishing produces, which this ADR already rejects.
- **A "reset this draft's code to Live's" action.** It would leave the draft's content using blocks and fields with no definitions, which reading would quietly flatten (ADR 0007).

### Consequences

- Camox's turn starts with a short message saying why. It only reconciles, and only touches code. Where both versions can't be kept, the draft's intent wins, as confirming a conflict would, and the agent says so.
- Until the blocker is resolved, the draft previews its last revision on the old `main`. The review's status line that the draft includes everything published to Live is false.
- If the turn fails, the blocker stays and the agent says in the thread, in preview terms, what it couldn't reconcile. Camox tries once for each move of `main`. After that, a member asks in the thread or discards the draft.
- Publishes with code run one at a time per project. The release Workflow merges the current `main` before building. A merge there that conflicts or no longer type checks aborts the publish back to the draft with the blocker, and Camox's turn starts.
- Undoing a turn reverts that turn's own changes on top of the branch's head, never resetting the branch, so a draft never loses Live's code. Merges can't be undone, and an undo that clashes with later turns is refused.

## Amendment: publishing releases the last revision's build

Publishing a draft with code no longer builds it. Every revision is already built in full, as a dry-run release, and stored in R2 as one archive ([Building a revision in a Container](https://github.com/remidej/camox/issues/550)). The publish deploys the build of the revision its confirmation showed, so Live serves the same bytes members previewed. A publish also never runs agent-written code next to the Deploy Token, which `camox release`'s definitions sync would do ([Publishing a draft's last revision build](https://github.com/remidej/camox/issues/551)).

### Considered Options

- **Rebuild in the release Workflow**, as this ADR first said. It's simpler, but Live would run a second build that nobody previewed, with a new build ID and maybe a newer sandbox image.
- **Serve Live under a per-build URL prefix too**, so a revision's build needs no change to deploy. Every publish would change every asset URL, and visitors would download unchanged JS and CSS again.
- **A separate origin per revision, built at the root.** The renderer frame portals into the studio's frames, which need the same origin, and members would need a session on every revision's host.
- **Fall back to building in the release** when `main` moved and the draft hasn't merged it yet. That would make two build paths, and Live could run code that was never a revision.

### Consequences

- A build doesn't bake in its URL prefix. Client URLs are relative. Server-rendered URLs, the SDK's own included, take a prefix at runtime: `/_camox/r/<rev>/` from the Dynamic Worker, `/` on Live. The prefix is set before the server bundle loads, since the SDK reads its asset URLs then. A prototype confirmed this covers every URL in a build ([One build under any URL prefix](https://github.com/remidej/camox/issues/552)).
- A build is safe to ship when its revision's Git tree is the tree the publish puts on `main`, which means it already includes the current `main`. The lockfile, `vite.config.ts` and `wrangler.jsonc` are in the tree. The sandbox image doesn't count, and the revision's build ID carries over to Live, still new for each release (ADR 0022).
- The confirmation pins the revision it showed. A later agent turn aborts the publish back to the confirmation, as changed conflicts do (ADR 0009). Camox's merges of `main` are the exception: if the draft hasn't merged the current `main`, the publish waits for its merge revision, built in the draft's sandbox, and ships that. A merge that conflicts or no longer type checks is the blocker above. A head whose build is missing is built again the same way. The publish never builds.
- The publish Workflow skips the source checkout, `pnpm install` and `camox release`. The publish batch syncs the draft's definitions, already synced from the pinned revision. A small sandbox with wrangler in its image uploads a Worker version and its assets from the archive, then promotes it.
- The order: upload without serving, re-check conflicts, promote, run the batch, record the tree Live serves, push the squashed commit to `main`, then delete the draft's builds and branch. `main` moves only once the batch has committed. That replaces "`main` moves only once the build succeeds".
- A push to `main` whose tree Live already serves starts no release, so the publish's own push doesn't release the same code again.
- The full build of each revision stays when per-file compiling speeds up previews, moved off the preview's path. Publishing waits for the head's build, and "code that doesn't build" comes from it.
- Upgrades still build twice, a dry run and then their release. Reusing the dry run is left for later.

## Amendment: a revision each time the agent builds

An agent turn can leave several revisions, not one. "Add a pricing section with this copy" needs the new block's definition before its content can be placed, and a draft's definitions come only from a built revision. So the agent builds when it needs to: a build that passes commits a revision, syncs its definitions to the draft and reloads the preview, and the turn carries on with the content tools. When the turn ends, whatever it changed since its last revision is built and committed ([The agent's code tools](https://github.com/remidej/camox/issues/553)).

### Considered Options

- **Build without committing**, syncing definitions from an uncommitted build and committing once at the end of the turn. The draft's definitions could come from a state that never became a revision, if a later edit broke the build.
- **One revision per turn, as first decided.** Content using a new block would wait for the next turn, splitting the mixed requests this ADR exists for.

### Consequences

- Undoing a turn reverts all the revisions it left.
- A merge of `main` while the agent is mid-turn waits for that turn's last commit, not its first.
- If the end-of-turn build still fails after a few tries, the turn commits anyway and the draft gets the "code that doesn't build" Blocker. That revision isn't built, so the preview keeps showing the last revision that built.
