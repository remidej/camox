# Agents and jobs

Product exploration, 2026-10-17. Nothing here is decided. These are leanings from a brainstorm about how people work with agents in Camox, written down so they can be grilled into decisions later.

## The goal

Camox gives marketing teams websites that agents help maintain (see [the pivot](pivot-to-a-platform-for-marketing-teams.md)). The first step is an agentic chat in the studio. This note covers the product shape around it: where conversations live, which agents users see, how background work is surfaced, and where people talk to Camox.

"Draft" here means the planned named, project-wide drafts that sit on top of Live, not the per-entity draft state the glossary describes today.

## Conversations

### Neither ChatGPT-style threads nor one endless chat

- **One thread per topic** makes users manage context ("should I start a new chat?") and strands knowledge in old threads.
- **One self-compacting chat** hides context management. When compaction drops something, users can't see it or fix it. It also suits one person, not a team.

Split context into two kinds instead:

1. **Company memory**: brand voice, positioning, product facts, decisions ("never name competitor X"). Visible and editable, like a "what Camox knows about your company" page. The agent proposes additions and people correct them.
2. **Working context**: the task at hand, which lives with the draft.

### The draft is the thread

Starting work starts a draft, and the draft carries its own conversation. A draft has a lifecycle (publish or discard), which gives the conversation a natural end. Users never decide when to start a new chat. Teammates can join a draft's thread when they want to collaborate, and stay out of each other's way when they don't.

### The conversation on Live

Each person gets a private conversation with Camox while on Live, like a DM. It handles:

- **Questions** that change nothing: "which pages mention our old pricing?"
- **Setup**: creating jobs, adding a language, teaching company memory.

When a request turns into a change, it starts a draft (matching the rule that the first edit on Live starts a draft). The conversation moves into the draft's thread, carrying the messages that led to it, and the Live conversation keeps a link. If the person already has a draft open, Camox asks whether to add to it or start a new one.

The Live conversation can run forever and compact freely, because no work in progress lives in it: changes are in drafts, lasting knowledge is in company memory. It also works as a home screen: "2 drafts waiting for review, German translation finished."

## One agent, not a roster

Users talk to one agent, a chief of staff. Specialists exist internally, as subagents, skills and prompts, and as headless runs triggered by workflows. They don't get user-facing identities.

What exposing agents usually buys, and where it comes from instead:

- **Seeing what's running**: a list of jobs.
- **Control**: on/off, scope, frequency, spend, set per job.
- **Knowing why a change happened**: provenance names the trigger ("release v2.3 on GitHub"), not a persona.
- **Packaging and pricing**: jobs can be the unit.
- **Isolation**: a job that reads untrusted text (GitHub issues, outside websites) is exposed to prompt injection and shouldn't be able to publish. That's capability scoping inside Camox, not something users need to see.

A roster also brings back the routing problem: users would have to choose which agent to ask. Names and avatars can be added to jobs later as a presentation layer if marketing needs them. Taking personas away once users are attached to them would be harder.

The chief of staff acts more like an editor-in-chief than a router. Specialist jobs produce findings, and it bundles them into proposed drafts with a short explanation. Its opinions show in defaults and proactive suggestions ("your pricing page hasn't changed in 4 months while you shipped 12 features"), not in arguing during chat.

## Jobs

A job is a trigger plus what it does, scoped to what it may touch. Agentic and deterministic work are merged under this one concept, because users care about what a job does to their site, not whether there's an agentic loop.

### Camox events are the hard-to-copy part

Jobs can be triggered by Camox events: a page published, an image uploaded, a language added, a draft opened. A chatbot that happens to live on your website can't do that. The list of events is a product surface in itself.

### Three kinds of output

| Kind     | What happens                                   | Examples                                             |
| -------- | ---------------------------------------------- | ---------------------------------------------------- |
| Fills in | Writes into untouched fields, applied directly | SEO metadata, image alt text, summaries              |
| Proposes | Opens a draft for review                       | Page updates after a release, fixing inconsistencies |
| Reports  | Changes nothing, gives information             | Page performance                                     |

This is about trust: does it change my site without asking? It could be a per-job setting (apply, propose, off). The kinds feed each other: a report notices a page performing badly, and the chief of staff proposes a fix.

### Jobs Camox already runs

These already exist as AI generation in the API and can be surfaced as jobs:

- SEO metadata for pages (`generatePageSeo`)
- Image metadata for files (`generateFileMetadata`)
- Summaries of blocks and repeatable items (`generateBlockSummary`, `generateRepeatableItemSummary`)

Summaries mostly make the studio easier to use. Keep them running but don't advertise them as a job.

### Candidate jobs

- **Inconsistency check**: needs no integrations, works on day one. A strong onboarding moment: "we read your site and found 7 contradictions."
- **Release watching**: GitHub or tracker activity turns into drafts updating feature pages. The clearest answer to "why Camox" for fast-moving products. Turning a PR into marketing copy is a real editorial problem.
- **Translations**: not built yet. A proven paid category (Weglot, for example).
- **Page performance**: a scheduled report job.

Competitor watching was considered and dropped: crowded, and it produces information rather than site changes.

### Translations: open product questions

- When the source page publishes, do other languages go live later, or does publishing wait so all languages go live together?
- Does a hand edit to a translation survive the next translation run?
- Is there a per-language glossary (product names, terms never translated)? It could live in company memory.

### Surfacing value without noise

Fill-in jobs run constantly, so listing every run would bury users. Show the value as a digest instead: "This week: alt text for 34 images, SEO for 6 new pages, 12 pages translated to German." It works as a weekly Slack or email message.

## Surfaces

- **Studio**: where review happens. Visual diffs of a draft need a visual surface.
- **Slack**: where proactive work gets noticed. The DM with the Camox bot is the Live conversation, and each draft is a thread in a channel. Small changes could be approved from Slack.
- **MCP**: if it exposes raw edit tools, Camox becomes a backend for someone else's agent. If it exposes Camox's own agent and company memory, it brings people back to Camox. The second fits the product better.

## Branding

Camox means chamois in Latin, and the logo loosely shows the animal's head. The landing page's footer already draws a mountain ridgeline. The agent feature builds on that.

### Nimble and sure-footed

A chamois moves fast on steep ground without falling. The feature's story pairs both traits:

- **Nimble**: the site keeps up with a product that ships every week.
- **Sure-footed**: nothing goes live by surprise. Changes arrive as drafts to review.

Speed alone wouldn't answer the main worry about agents, "does it change my site without asking?". Sure footing does.

Candidate lines:

- "Keep your site as nimble as your product."
- "Your product moves fast. Your site keeps its footing."

In copy and motion, the chamois **leaps**.

### Names

- **Camox** is the agent's name. Users ask Camox, and Camox opens drafts. This matches having one agent rather than a roster.
- **Reflexes** are what this note calls jobs. The name says what sets them apart: they react to Camox events ("when a page is published…").
- **Instincts** is the studio page for what Camox knows and does on its own, with a brain icon. It holds:
  - **Memory**: brand voice, positioning, product facts.
  - **Rules**: things Camox always follows ("never name competitor X"). Kept beside memory, separate from reflexes.
  - **Reflexes**: each one's trigger, scope, trust level, on/off switch, spend, and recent runs written as results.
  - **Connections**: GitHub, Slack, email.

  Subtitle: "What Camox knows, and what it does on its own." When someone adds to memory: "Sharpen Camox's instincts."

- **From the Lookout** is the weekly digest by Slack or email. A chamois herd keeps a lookout that whistles at danger.

### Guardrails

- At most one mountain touch per surface. Errors, billing, permissions and publishing stay plain.
- Avoid overused mountain words: summit, peak, base camp.
- No mascot character. Personas are hard to take away once users are attached to them.

## Vocabulary to settle

- **Agent** in the glossary means a coding agent working through the CLI or AI tools. The agent users talk to is named Camox; internal specialists still need a term.
- **Draft** needs redefining once named drafts replace per-entity drafts.
- **Reflex** (called job above), **company memory**, **Instincts** and **Live conversation** are new to the glossary. The branding above proposes names but nothing is settled.

## Open questions

- Are startup marketing teams usually one person or several? That decides how much the multi-person model matters at launch.
- Which job ships first alongside the chat?
- Which Camox events should jobs be able to react to first?
