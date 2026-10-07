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
