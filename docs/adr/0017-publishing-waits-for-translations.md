# Publishing waits for translations, and Camox catches them up in a draft of its own

Superseded by [Publishing waits for translations and findings](0033-publishing-waits-for-translations-and-findings.md) where it lets a draft publish anyway.

Camox translates a draft's default-locale changes into its other locales as background jobs (ADR 0015), so a draft can be ready to publish while some of its translations are still running. Publishing a draft takes every locale live together: it waits until nothing is left to translate in it, merges with Live's localizations included (ADR 0016). Editors and agents can publish anyway. The draft then publishes as it is, and the translations still pending carry on in a catch-up draft that Camox opens, against the new Live. Camox publishes that draft as itself once nothing is left to translate in it, so Live catches up without anyone reviewing it. Content a release adds to Live is translated into Live's other locales the same way.

## Considered Options

- **Only publish once translated.** A model outage would stop every publish, which generated values were designed never to do (ADR 0012).
- **Finish the translations straight on Live.** Live only changes through publishing and releases (ADR 0006). A catch-up draft keeps the checks of publishing: one with blockers or conflicts stays open for a member to review, like any other draft.

## Consequences

- Camox is an actor of its own: it creates, publishes and ends its catch-up drafts, and is named as their author and publisher.
- A project has at most one catch-up draft open at a time; later translations to catch up join it, and a release's several requests share it.
- A translation requested in the catch-up draft while Camox publishes it stops that publish, and the draft publishes once that translation settles too. A catch-up draft whose translations changed nothing is dropped.
- Publishing anyway drops the draft's pending merges with Live's localizations: its localizations replace Live's as they are (ADR 0016).
