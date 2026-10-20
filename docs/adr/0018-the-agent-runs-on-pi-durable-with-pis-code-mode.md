# The agent runs on Pi Durable, and writes content through Pi's code mode in a sandbox Worker

Camox's agent runs each thread in a Durable Object of its own, with Pi Durable through Cloudflare's `PiHarness`: Pi saves a run at every step, so an eviction or a deploy resumes it instead of cutting it off. The agent changes content through one code mode tool, whose scripts call the `@camox/ai-tools` tools. The scripts run in Pi's code mode, QuickJS in a Durable Object of a separately deployed sandbox Worker, rather than in Cloudflare's codemode on Worker Loader, which [Agent tooling for content](https://github.com/remidej/camox/issues/396) had leaned toward. Pi replays a script interrupted by an eviction without running its finished calls again, and a script that computes doesn't hold up the thread's own Durable Object.

## Considered Options

- **Cloudflare's codemode on Worker Loader.** The model writes TypeScript and scripts run on V8, but a script interrupted by an eviction is lost, so the agent would only learn which calls went through. Pi measured a Dynamic Worker loaded by the session's object holding that object up for as long as the script computes.
- **Pi's code mode inside the thread's Durable Object.** No second Worker to deploy, but a script that computes stops the thread's live updates, and QuickJS joins the API Worker's bundle.

## Consequences

- The model writes JavaScript. Every tool declares its input and output schemas, which Pi turns into TypeScript declarations in the prompt, and Zod still checks every call at runtime.
- Scripts can't call a model: Pi's `models.*` is turned off, so writing copy stays with the agent's own turn.
- The sandbox Worker is deployed beside the API, and local development runs both Wrangler configs.
- Pi Durable is experimental and changes in minor releases, so its packages are pinned to exact versions.
