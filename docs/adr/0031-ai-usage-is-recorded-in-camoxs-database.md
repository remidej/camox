# AI usage is recorded in Camox's database; PostHog is a copy

Camox will need limits on AI use and a price that covers it, and neither can be set without knowing what each call costs, for which organization, project and draft, and who started it. So every AI call, and later the sandbox compute around it, writes an AI Usage Record to one append-only table in D1. Limits will read it from inside the request path, without depending on an outside service. A scheduled job will later copy the records to PostHog as `$ai_generation` events, with the organization and the project as groups, for analysis. ([Record the cost of every AI call](https://github.com/remidej/camox/issues/704))

## Considered Options

- **OpenRouter Broadcast to PostHog.** It misses Cloudflare's web search costs, doesn't set PostHog groups, and would be a second source of numbers next to whatever limits read.
- **Workers Analytics Engine.** It samples data and keeps it about three months: too little to price from, and too loose to enforce limits on.
- **PostHog as the source of truth.** Limits would depend on an outside service in the request path.

## Consequences

- One record per call, keyed by OpenRouter's generation id (or another id the call has for good), so a call recorded again, as a Pi replay after an eviction does, counts once. Each retry of a call is its own record, marked `retried`, with what it cost. A thread's agent records one per step, from Pi's hooks: a failed step is marked `error`, and Pi's retry is the turn's next step.
- The cost is frozen at call time, in integer millionths of a dollar: what OpenRouter billed, or an estimate from the price list (pi-ai's model catalog) when it reports none. pi-ai drops OpenRouter's billed cost and routed provider from the messages it returns, so a thread reads them from OpenRouter's raw stream. A web search has no cost yet: Cloudflare bills it to the AI Gateway without telling the call.
- Who started the work is recorded apart from who it was for: a member, the agent, or Camox itself (patrollers, catch-up drafts), naming the patroller. Billing isn't decided, but these must be told apart.
- Recording never blocks or fails the user's work: records are written in the background, and failed writes retried.
- Records have no foreign keys and no cascading deletes: they outlive the organizations, projects, drafts and threads they name. They hold no prompts or outputs.
- The code asking for the work attributes it (`AiAttribution`): jobs as Camox, requests as their member or the agent. A call nothing attributed is still recorded, naming no project.
- It contradicts no earlier decision. ADR 0018 already keeps model calls out of code mode scripts, so scripts need no recording of their own.
