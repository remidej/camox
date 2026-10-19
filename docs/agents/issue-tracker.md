# Issue tracker: GitHub

Issues and specs live in GitHub Issues for `remidej/camox`.
Use the `gh` CLI for tracker operations.

## Conventions

- Publish to the issue tracker by creating a GitHub issue.
- Fetch a relevant ticket with its body, labels, and comments.
- Use GitHub sub-issues for parent/child relationships. If unavailable,
  add `Part of #<parent>` to the child and a task list to the parent.
- Use native issue dependencies for blockers. If unavailable,
  add `Blocked by: #<number>` to the issue body.
- Use the label mapping in `docs/agents/triage-labels.md`.

## Pull requests as a triage surface

**PRs as a request surface: no.**

GitHub shares issue and PR numbers. Resolve the object type before acting.

## Research and brainstorms

The repo has no research notes or product docs; they live in issues.

- Research: a `wayfinder:research` issue whose body is the question.
  Post the findings, with sources, as a comment, then close it. Do
  not write findings to a file or a `research/*` branch. Research
  outside a map is the same issue with no parent.
- Brainstorm: an open `wayfinder:map` issue. Its body is the current
  thinking, edited as it changes; comments keep the history.
- Superseded findings: open a new issue linking the old one; never
  rewrite a closed one.
- ADRs link the issues behind them with full issue URLs.

## Wayfinding operations

- Map: one issue labelled `wayfinder:map`, with Notes,
  Decisions-so-far, and Fog sections.
- Child tickets: linked sub-issues labelled `wayfinder:<type>`,
  where type is research, prototype, grilling, or task.
- Frontier: open children with no open blockers or assignee;
  first in map order wins.
- Claim: assign the ticket to the driving developer before other writes.
- Resolve: comment with the answer, close the ticket, and append
  a summary and link to the map's Decisions-so-far.
