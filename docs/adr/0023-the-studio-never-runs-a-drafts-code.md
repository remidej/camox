# The studio never runs a draft's code

The studio used to render every block itself: one React root in the studio's own document, built with the site's code, portaled into the Preview's and each Canvas card's iframe. A draft that carries code (ADR 0020) can't render that way, since Live's Worker holds Live's blocks. So the studio's nav, sidebars and threads always come from the project's Live Worker. Only the frames run the shown draft's code: one hidden renderer frame per Website Section loads a revision's client build and portals into each visible frame. Agent-written code then can't break the panels an editor uses to get it fixed, and a new revision reloads only the frames ([The smallest preview of a changed block](https://github.com/remidej/camox/issues/538)).

## Considered Options

- **Serve the whole studio from the revision** whenever the URL names a draft with code. Less work up front, but switching to that draft swaps the studio itself, every turn reloads the threads and sidebars, and a crashing block takes the studio down with it.
- **A real document per Canvas card**, each loading the revision's bundle. Simpler to reason about, but dozens of React apps on a large Canvas, each with its own query cache.
- **Renderer frames only for drafts with code**, keeping the single root for Live and other drafts. Two rendering models would drift, and the common case would hide the code case's bugs.

## Consequences

- Live and every draft render through the renderer frame. Only its source differs: the project Worker, or a revision's Dynamic Worker for a draft with code. The split ships before any agent-changed code.
- The sidebars read a draft's definitions from the API, synced from each revision before the studio hears of it. Anything that needs block code, such as a new block's initial content and block thumbnails, is asked of the renderer.
- Selection and editing in place cross a document boundary, through messages between the studio and the renderer.
- The dispatch Worker sends a draft with code's renderer document and its runtime reads (`/_camox/data`, `/_camox/routes`) to the revision's Dynamic Worker, only for members who can see the draft. Everything else reaches the project Worker as before.
- A new revision is announced in the project room once it has built, synced its definitions and been prewarmed. Every viewer of that draft reloads its renderer; Canvas position and selection, kept in the studio, survive.
- The studio and the renderer can run different SDK versions between an Upgrade's release and the draft's merge of `main`. They compare versions when they connect, and the frames wait for the merged revision rather than bridging versions.
