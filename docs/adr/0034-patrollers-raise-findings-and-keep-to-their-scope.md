# Patrollers raise findings, and each keeps to the scopes its work belongs in

Amends [Patrollers share a contract, not a runtime](0024-patrollers-share-a-contract-not-a-runtime.md).

Besides doing work and reporting it, a patroller can raise findings: problems in content, such as a link that doesn't work, with the fix it suggests when it has one. A draft's findings, in what it changed, hold its publish until each is fixed or a member dismisses it (ADR 0033), and a dismissed finding is not raised again. Dismissals belong to the project, not to the draft they're made in, so they hold on Live and in every draft, and survive the draft ending. Findings replace the attention level ADR 0024 put on reports. The Link checker is the first to raise them.

Each patroller works only in the scopes its work belongs in. Content only changes in drafts, so patrollers that write content (the Translator, the SEO manager) work in drafts, and on Live only for a catch-up draft. Patrollers that check what can go wrong without an edit, like the Link checker, also patrol Live every 6 hours. Their new findings on Live go to the Patrol Draft, the one draft Camox opens for them, where Camox's agent fixes what it can tell how to, asks in the draft's thread about the rest, and never dismisses. Members get one email per run that raised new findings, and a run that found nothing new stays silent.

## Considered Options

- **Flag through reports' attention level.** Reports end with their draft and say what a patroller did. Findings outlive drafts through their dismissals, which the Patrol compares against so they aren't raised again.
- **Blockers that only a fix clears.** Link checking is a judgment call that is sometimes wrong, like a site that turns crawlers away. Members need to be able to overrule them.
- **Patrollers fix what they find themselves.** Editing an editor's content behind their back. In a draft, applying a suggested fix is one click, and on Live, the agent's fixes are reviewed in the Patrol Draft like any change.
- **Every patroller on Live too.** Live only changes by publishing and releases, and publishing already passed every patroller, so running them again on Live finds nothing.

## Consequences

- The Link checker takes over checking links to deleted pages from publishing's content checks: they are findings now, not blockers.
- In a draft, the Link checker runs once the draft has been idle for a while, and again when its review opens if anything changed since, so editors don't wait on them while they write.
- A link fails two checks in a row before it's raised, so a site's blip raises nothing.
- Each patroller keeps the time it last checked, so the Patrol shows a patroller that found nothing as recently at work without a report.
