# The URL names the draft

Requests used to say what they read twice: an `x-environment-name` header naming the environment, and a `live | draft | checkpoint` source on each procedure. A website render read the draft whenever a session cookie was present. With many drafts per project (ADR 0003) and no checkpoints (ADR 0008), the only question left is "Live, or which draft?", and the first server render of the preview has to know the answer. Every request now carries one `x-camox-draft` header, and no header means Live. The studio's selected draft is the `?camox-draft=<id>` search param, which the SDK keeps across navigations, so the URL always says what you're looking at.

## Considered Options

- **A cookie for the selected draft.** It survives every navigation for free, but it's per browser: switching to Live in one tab moves every other tab, and a link can't point at a draft.
- **Render Live on the server and switch to the draft on the client.** No transport needed, but every preview flashes Live first.
- **The server creates an auto-started draft and returns its id.** Two quick edits on Live, the second sent before the first returns, would start two drafts. The studio generates the id (a UUIDv7) instead, so both land in one draft.

## Consequences

- Without the param, a logged-in member sees the same Live as any visitor; the session no longer decides what a page shows.
- Writes always name a draft. The first edit on Live sends a "create if missing" flag with the studio's new id; without it, writing to a draft that has ended is rejected, so an ended draft never comes back.
- `x-camox-draft: development` means the caller's development draft. Dev mode and the CLI always send it, and dev mode ignores the URL (ADR 0006, ADR 0010).
- Live is public. Regular drafts are readable by the organization's members, and a development draft only by its owner. A draft that ended answers with a distinct error that says whether it was published or deleted, and by whom.
- A URL naming a draft the visitor can't see renders Live in the same response. The client removes the param without a history entry, and only members get a toast explaining why.
- Switching drafts in the studio is a navigation, with its own history entry. An auto-started draft reaches the URL only after its first write succeeds, replacing the current entry.
- One realtime room per project stays. Each invalidation names the draft it came from, Live's reach every viewer, and query keys end in `live | <draftId>`. Publishing or deleting broadcasts that the draft ended.
