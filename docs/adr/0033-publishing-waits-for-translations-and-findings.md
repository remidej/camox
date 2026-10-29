# Publishing waits for translations and findings

Supersedes [Publishing waits for translations](0017-publishing-waits-for-translations.md) where it lets editors and agents publish anyway.

A draft publishes only once nothing is left to translate in it, it has no blockers, and every finding its patrollers raised is fixed or dismissed (ADR 0034). There is no Publish Anyway. Publishing is meant to be deliberate, so what reaches Live is solid: a gate that can be skipped is one editors learn to skip. A model outage, or a patroller that can't run, now holds publishing until it recovers. We accept that over a way around the gate.

## Considered Options

- **Keep Publish Anyway, as ADR 0017 decided.** It keeps publishing up through an outage, but every check it skips has to be caught up after the fact on Live, which is what catch-up drafts did for translations.
- **Let a check that can't run pass.** It avoids holding publishing during an outage, but a draft published then goes to Live unchecked, with nothing to tell editors it did.

## Consequences

- Catch-up drafts only translate what a release adds to Live: a publish no longer leaves translations behind.
- Publishing anyway's drop of a draft's pending merges with Live's localizations (ADR 0016) goes with it.
