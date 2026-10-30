# Live threads start afresh from each hand-off

Amends [Live threads hand requests off to drafts](0025-live-threads-hand-requests-off-to-drafts.md), where an editor's Live thread was never emptied and grew without bound.

Each time the agent on Live hands a request off with `startDraft`, the editor's Live thread starts afresh from the draft's card. Editors see only that card, not the messages before it nor the cards of earlier drafts, and the model reads only a note from Camox naming the draft, then whatever comes next. The thread is still the editor's own, at the same id: only what it shows and what the model reads start over. The Brief already carries everything the draft needs from the exchange, so nothing is lost for the work, and every request handed off costs no more than the first.

Pi does the reset: `#startDraft` ends by writing one entry heading a new context, of the kind `camox.draft-card`, with the card as data and the note as its user message. Pi places it once the round of tool calls ends, so the turn still ends on the card, and the entries before it stay in storage, outside the view and the model's context. Its request id keeps a call that runs again to one reset.

## Considered Options

- **A new Live thread per hand-off.** It needs no reset, but the editor's Live thread would change id, the drafts started earlier would tell a thread nobody shows, and the new one would need a way to show a card it never made.
- **Pi's compaction.** It keeps a summary of the exchange, but that is what the Brief is for, and it needs a model call of its own.
- **Resetting with `startDraft`'s `handoff` control.** Pi writes that reset itself, so it can't carry the card: the studio would show an empty thread.

## Consequences

- Messages an editor sends while the agent on Live starts the draft go to the draft only: the Live thread doesn't keep them, since it starts afresh right after.
- Notes that an earlier draft ended still reach the model, after the latest card. That draft's card is gone, so editors don't see how it ended on Live.
- The system prompt is written again after each reset, unchanged, so the cached prompt starts over with the thread.
