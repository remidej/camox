# Connected Agents drive Camox's agent, not its tools

Camox's agent knows the website but nothing about the business behind it, and marketers won't explain their company in a studio chat or plug their tools into Camox. Their own Claude or ChatGPT already knows the product, from Notion, specs and code. So Camox offers one MCP server through which a member's Connected Agent drives Camox's agent: it starts drafts and sends their threads messages carrying the request and the business context, and Camox's agent does the work, content and code alike. The Connected Agent brings the knowledge, and Camox brings the website.

## Considered Options

- **One MCP tool per mutation**, like `@camox/ai-tools`. The Connected Agent would have to learn definitions, blocks, layouts and localizations, chain dozens of round trips without code mode, and couldn't change code: the draft's repo, its builds and the agent's rules (ADR 0021) stay inside Camox. Camox would become a backend for someone else's agent.
- **One MCP URL per project.** It needs no project argument, but a connector directory lists one fixed URL, a member with two sites would install two identical sets of tools, and creating a project would fit neither.
- **Structured fields for the request** (context, audience, sources, assets, constraints). Fields ask to be filled even when they don't apply; one free-text message, whose description says what usually helps, gets the context without the filler.
- **A request as a turn in the member's Live thread**, which then calls `startDraft` (ADR 0025). It spends a model call rewriting a brief the Connected Agent already wrote, and fills the member's Live thread with requests they never typed in the studio.

## Consequences

- The server's tools are `start_draft(name, message)` and `send_message(draft, message)`, plus reads that stay at the level of pages: a project overview, a page as its Markdown Representation on Live or in a draft, and a draft's status with its thread's messages. No blocks, collections, records or files: those are Camox's agent's to work out. A draft is named by its id or a pasted studio link.
- Each request opens a new draft unless the Connected Agent names or links one. A message sent during a turn steers it, as an editor's does. A call returns when the turn ends: the agent's final message, a studio link to the draft on the page it changed, and its Blockers. Review and publishing stay in the studio.
- A Connected Agent starts a draft itself, with no Brief: its message opens the draft's thread, as a new kind of sender. It's labelled with the member and the client, "Rémi's Claude", and "Rémi's agent" when the client's name isn't verified.
- The server's instructions make business context the Connected Agent's job: Camox writes only from what it's given and what's already on the site, so too little context means slop. They ask for what to change and why, never how to build it, and for the studio link after each turn.
- One server serves every project. `tools/list` is shaped per member: with one project the tools take no project argument; with several, `project` is an enum of theirs, also named in the server's instructions. A name outside the list is still accepted, and answered with the member's projects, for clients that cache the list.
- A Connected Agent acts as the member, with their role and permissions, checked on every call rather than when access was granted. Better Auth is the OAuth 2.1 authorization server, preferring Client ID Metadata Documents and keeping Dynamic Client Registration as a fallback. One consent grants reading the website and starting and continuing drafts; publishing can come later through a step-up scope. Members see and disconnect their Connected Agents in the Dashboard.
- Signing up through the OAuth flow, creating projects, memory, publishing from a Connected Agent, MCP UI and limits on Connected Agents are left for later.
