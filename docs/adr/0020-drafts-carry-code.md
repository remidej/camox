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
