# Patrollers share a contract, not a runtime

Amended by [Patrollers raise findings, and each keeps to the scopes its work belongs in](0034-patrollers-raise-findings-and-keep-to-their-scope.md): findings replace reports' attention level.

The Patrol shows editors the work Camox does without being asked, as patrollers such as the Translator and the SEO manager. Patrollers will differ in how they run: today's are AI jobs triggered by edits, while later ones may be multi-step Workflows or Pi agents (ADR 0018) on a schedule. So patrollers share a contract rather than a runtime. Each one runs however suits its work, answers whether it is working in a draft or on Live from its own records, and writes one Report per subject when work settles. A Report is either structured facts (what was done, to which subject, in which locale), which the studio turns into a sentence when it shows it, or text an AI wrote during the run.

## Considered Options

- **One runner for every patroller.** AI jobs, Workflows and agent loops have little in common beyond being unprompted, and forcing them into one shape would bend each to the others' limits.
- **Storing whether a patroller is working beside its Reports.** A second copy of what each runtime already records, as pending translations and pending generated values do. A job that crashed before settling would leave its patroller's ring spinning for good.
- **One Report per run.** Edits trigger the same jobs many times a minute, so the Patrol would fill with repeats. Keying Reports by subject, as jobs are keyed, keeps one line per thing done.

## Consequences

- A Report about structured facts follows renames and the studio's language. An AI-written one stays as it was written.
- Reports belong to a draft or to Live, end with their draft, and are hidden once their subject no longer exists. Work that changed nothing leaves no Report.
- A Report can carry an attention level, so a future patroller that needs a human, such as one finding contradictions across the website, raises it through the same contract.
