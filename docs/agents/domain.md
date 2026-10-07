# Domain Docs

## Layout and reading rules

This repo uses a single-context layout across all apps and packages:

- `GLOSSARY.md` at the repo root: shared domain vocabulary.
- `docs/adr/`: architecture decision records.

Before exploring the codebase, read the glossary and ADRs relevant
to the area being explored.

If these files are absent, proceed silently. Do not suggest creating
them upfront; the domain-modeling skill creates them as terms and
decisions are resolved.

## Use the glossary's vocabulary

Use glossary terms in issue titles, proposals, hypotheses, and test
names. Avoid synonyms the glossary explicitly rejects.

If a needed concept is missing, reconsider invented terminology or
note a genuine gap for domain-modeling.

## Flag ADR conflicts

Explicitly identify any existing ADR your proposal contradicts and
explain why the decision merits reopening.
