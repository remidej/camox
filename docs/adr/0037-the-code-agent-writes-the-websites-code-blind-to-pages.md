# The Code Agent writes the website's code, blind to pages

Amends [Artifact Agents write artifact sources](0035-artifact-agents-write-artifact-sources.md) and refines [What code the agent may change](0021-what-code-the-agent-may-change.md).

The thread's agent wrote Block Definitions with the exact copy and page it was working on in its context, so it shaped blocks around that one Placement, whatever the `camox` and `website-design` skills said: the specifics in context pull harder than rules. And code work, the heaviest thing a thread carries (the skill, source files, build and lint errors, screenshots of new designs), stayed in its transcript for every later step. So in a draft, the website's code gets an agent of its own: the Code Agent, one Pi conversation per draft thread, beside the root conversation and its Artifact Agents, started on the first `code` call, which outlives every request and remembers them all. The thread's agent hands it what the code must do and why with `code`, and places and fills what it built with the content tools. The Code Agent is blind to pages on purpose: it has no content tools, so it designs a block for what it is for and the shape of its content, never for one page. Only the Code Agent touches code: the thread's agent has no code tools, in a draft or on Live, where questions about how the website is built are answered from its definitions.

## Considered Options

- **Instructions alone**, telling the thread's agent to write reusable blocks. Already tried, in both skills: it fits code to whatever is in its context.
- **A subagent per request.** For the reasons of ADR 0035: each request would read the skill and the code again, and forget what earlier requests settled.
- **Keeping the code reading tools on the thread's agent**, to answer questions about how the website is built. The boundary would blur again, and reading code pulls it back into planning code: it asks the Code Agent instead.

## Consequences

- `code` takes a `request` and `final`, as `artifact` does. The request carries the block's purpose and the shape of its content, never the content or the page: that's guidance in the thread's agent's instructions, the one way specifics can still leak in.
- The Code Agent's instructions are the same for every website, so its cached prompt keeps. It writes within the write line (ADR 0021, whose three layers stay as they are), and has `build`, `conflicts`, `searchFonts`, the web tools and `look`. Its `look` sees Block and Layout Definitions and the pages of Singleton and Derived Layouts, never a curated Layout's pages; the thread's agent's sees pages and Placements only. Its model is configured on its own, starting as the thread's.
- Each Code Agent request ends with the end-of-turn build and lint loop, moved from the thread's agent's turn, and `code` returns once it ends: definitions it added are discovered by then. The thread's agent's turn no longer builds, since it writes no code. Live's code still merges into the draft as that turn ends, never between Code Agent requests.
- ADR 0035 is amended: `artifact` ends the turn on its answer with `final` whenever the call is the round's only one, whether or not the turn changed code, since the Code Agent built it. `code` does the same.
- Camox's reconcile turn still opens in the thread's agent's conversation, whose instructions hand the clash to the Code Agent with `code`, which works as Camox for that request.
- A member's push that landed since the Code Agent's last request reaches it with its next one. One that landed before it started needs nothing: it reads the code afresh.
- Editors still see one thread with one agent: the Code Agent's activity and build status show as the agent's, its `final` answer as the agent's message, and stopping the run stops it. Its conversation ends with the thread. There's no Code Agent on Live, which hands requests off to drafts (ADR 0025).
