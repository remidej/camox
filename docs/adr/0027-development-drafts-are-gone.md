# Development drafts are gone, and contributors' dev mode releases to Live

Supersedes [The CLI works only in development drafts](0010-the-cli-works-in-development-drafts.md) and what remained of [Definitions live in Live and in development drafts](0006-definitions-in-live-and-development-drafts.md) for development drafts.

Development drafts held the definitions of code on a member's machine (ADR 0006), for websites whose code lived outside Camox. Hosted projects' code lives in Camox, and camox.ai, the last website built on a machine, is moving there (ADR 0026). So development drafts are removed, along with the CLI commands that worked in them (ADR 0010), and every draft's code is on the platform, where every member can preview it. Contributors still run the playground locally to work on Camox. Against a local API, dev mode releases its definitions to local Live on every save, with the local seed's deploy token. Content edits start regular drafts, which read Live's definitions, as in a hosted project whose code changes through an Upgrade ([Hosting camox.ai like any project](https://github.com/remidej/camox/issues/653)).

## Considered Options

- **Keep development drafts, for contributors only.** All their rules would stay across the API, the SDK and the studio for one local loop: publishable only once a release has given Live the same definitions, and emptied rather than ended.
- **Dev mode syncing a regular draft.** A draft's definitions come from its revisions. One synced from a machine would be a draft whose code nobody else can run.

## Consequences

- Dev mode refuses to start without a local API and the internal deploy token, and says that a hosted project's code reaches Camox through drafts and Upgrades.
- A save that adds a definition declaring content puts that content on local Live directly, as a release does.
- Existing development drafts are deleted.
- The CLI keeps `login`, `logout` and `release`, and gains the commands to clone and push (ADR 0026). `init`, the content commands, `publish`, `delete` and `create-camox` are gone. Agents outside Camox will reach content through an MCP server, not the CLI.
- Each checkout runs its own local API, so parallel worktrees don't release over each other.
