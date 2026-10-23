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
