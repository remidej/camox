# The CLI works only in development drafts

The drafts plan first had the CLI pick or start any draft, so agents could manage Live from a repository. But the people who run a CLI are developers, in a checkout next to local code, and the only draft that renders with local definitions is their development draft (ADR 0006). The people who manage Live are editors. So the surface decides what content an agent can reach: the CLI and its agents work only in the caller's development draft, and editors' drafts are left to an in-app chat and an MCP server, neither of which v1 builds. The CLI still reaches Live: the development draft shows Live wherever it changes nothing, and publishing it lands on Live.

## Considered Options

- **A `--draft` flag on every command**, defaulting to the development draft. An agent in a regular draft would see content conformed to Live's definitions rather than the code in front of it, and the CLI would need draft naming, listing, and a way to read Live.
- **A stored current draft**, like `git checkout`. Parallel agents in one checkout would overwrite each other's choice.

## Consequences

- Commands take no draft, Live, or production flag. `camox publish` prints what publishing would do, including definitions that differ from Live as a blocking problem, with a token for the conflicts it showed; `camox publish --confirm <token>` publishes (ADR 0009). `camox delete` empties the development draft. They replace `env check`, `env push`, and `env pull`.
- A developer whose local definitions differ from Live's can't publish content until a release ships them, as push required before.
- Agents in parallel worktrees share their developer's development draft and publish or delete it together.
- The CLI can't create the development draft, since only dev mode syncs definitions: until the site has run locally once, commands fail and say so.
- AI tools take their draft from the request context and never as a parameter, so the chat and MCP server can reuse them for other drafts. Draft-management tools wait for them.
- Adding a draft flag later is additive, if a real need for it appears.
