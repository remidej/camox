# Live threads hand requests off to drafts

Each editor's Live thread is theirs for good: it is never moved, emptied or deleted, so they can scroll back through everything they asked on Live. The agent on Live changes nothing itself. For each request that would change the website, it calls `startDraft` with a name and a Brief. That creates a named draft whose own thread opens with the Brief, from Camox, then the messages of the run that asked, word for word under the editor's name, and does the work there. The Live turn ends on a card linking to the draft, and the studio that sent the request enters it if it is still on Live ([Live threads hand requests off to drafts](https://github.com/remidej/camox/issues/626)). This replaces [Start a draft from a Live thread](https://github.com/remidej/camox/issues/411), where the agent's first write turned the whole Live thread into the draft's thread. That move carried every earlier, unrelated exchange into the draft, showed it to everyone in the draft, and left the editor an empty Live thread.

## Considered Options

- **Move the whole Live thread into the draft (#411).** It needs no copying and the run carries on in place, but it brings noise into the draft, shares an editor's private exchanges, and loses them for good once the draft ends.
- **Post a model-written summary as the editor's first message in the draft.** It cuts the noise, but it puts words the editor never wrote under their name, for teammates to read as theirs. It also needs a model call of its own, when the agent already knows what matters.
- **Let the agent on Live send requests into a draft it already started.** That would bring an editor's private thread into a shared one. The agent can point to the open draft's card instead, and editors continue there.

## Consequences

- The agent on Live has read tools and `startDraft`, which it calls directly rather than from a script, so that it can end the turn. A Live thread can start many drafts, and only those get a card: drafts an editor starts by editing on Live don't.
- The draft exists from `startDraft` on, so a run that fails before changing anything leaves an empty draft to delete.
- The card shows the draft's current name and whether it was published or deleted, worked out when the thread is shown. When the draft ends, Camox adds a note only the model sees at the end of the Live thread: its name, who ended it, and, when published, its Draft Overview. Nothing earlier in a Live thread is ever rewritten, and its system prompt no longer switches from Live to draft, so its cached prompt keeps up as it grows.
- A draft's thread still ends with the draft. Only the editor's Live thread keeps the request, as their own message and its card.
- Live threads grow without bound. Keeping their context in check is left for later.
