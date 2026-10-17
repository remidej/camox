# Pivot: from a framework for developers to a platform for marketing teams

Status: starting point for brainstorming (2026-10-15). Not a decision yet; nothing here supersedes an ADR.

## Where Camox is today

Camox is a Vite framework. Developers (and their coding agents) build a website with it, and the content becomes editable by non-developers through Camox's editing experience.

- The framework is open source.
- It relies on an external API that I host. That API is open source too, but it leans heavily on Cloudflare.
- So there is an open source story, and today that is how Camox presents itself: the framework agents should use to generate websites.

The architecture is still changing fast, with breaking changes made freely. The platform approach is how I want to get past this stage.

## Why that positioning doesn't work

Being "the framework agents use to build websites" is a weak position:

- **Developers pick the tools, and they don't pick a framework for their agent.** I believe agents do benefit from a framework like Camox, if only for visual editing. But developers choose the stack, and it's been hard to convince them of that. It's harder still when the framework depends on a hosted service.
- **Developers don't feel the pain Camox solves.** Developers now manage their site by prompting Claude (or similar). When they want to change content, they prompt the agent and the agent edits it. The content stays hard-coded and that's fine for them, so Camox's value proposition doesn't land.

The value proposition is right; it's aimed at the wrong audience.

## Who it does land with

Marketing teams, especially at startups with fast-moving products. This comes from conversations with marketing people, not just a hunch:

- The product changes often, so the website and its content have to keep up.
- More and more companies have fast-moving products, because agentic product development speeds up how fast products ship.
- Marketing people want to own and change the site themselves without going through developers, or through prompting a coding agent on a codebase.

## The direction

Cut developers out of the loop and sell directly to marketing people.

To do that, Camox has to become a complete platform: essentially a vibe coding platform for marketing websites. Marketing teams create and run their site on it end to end.

- **No developer anywhere in the loop.** Avoiding the developer is the whole point. Marketers set up the site themselves, most likely with the help of the platform's own agent, not someone else's coding agent.
- The platform is built on Camox. The framework becomes its secret sauce rather than the product.
- This is no longer really an open source story. The product is the hosted platform, not the framework.

## Constraints

Scope has to stay small. Whatever gets built first has to be something marketers will pay for.

## What this changes (to explore)

Starting points for future sessions, not conclusions:

- **Product surface:** what a marketer does on the platform end to end (create a site, generate pages, edit content, publish, manage domains), and where the agent fits versus direct editing. Agents and background work are explored in [Agents and jobs](agents-and-jobs.md).
- **Role of the framework:** what "secret sauce" means concretely, i.e. what the platform can do because it generates Camox sites that a generic vibe coding tool can't.
- **Open source:** what happens to the open source framework and API (kept, frozen, closed, relicensed).
- **Existing work:** which current features and ADRs still matter in the new shape (e.g. drafts and publishing, the CLI, the developer workflow).
- **Competition and positioning:** against general vibe coding platforms and against traditional website builders and CMSs.
- **Business model:** pricing and who pays.
