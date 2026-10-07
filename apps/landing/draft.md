<!-- Hero — keep unchanged -->

# Build _editable_ websites with your coding agent

Camox is a Vite framework with visual editing, draft workflows, and SEO built in.

```bash
npm create camox@latest
```

<!-- Why Camox -->

## Why Camox

Camox does not replace your coding agent. It gives your agent the structure and tools needed to keep a website consistent, editable, and manageable as it grows.

- **The site stays consistent as it grows.** Synced blocks keep structure and design from drifting as your agent creates more pages.
- **Content stays out of the codebase.** Edit copy and assets directly in production—no code, commits, or redeploys.
- **Drafts look like the real page.** Edit on the page, see every change in context, and publish when it is ready.
- **Your agent can manage the whole site.** It can inspect and create blocks, manage pages and content, and publish changes through the CLI and included skills.

<!-- Agent workflow -->

## The website tools your coding agent needs

Keep using Claude Code, Codex, or another coding agent. Camox fits into that workflow; it does not ask you to switch to a proprietary agent.

- **Your agent.** Use the coding agent you already know, with access to your codebase and the rest of your development tools.
- **Your AI usage.** Coding sessions stay with the provider and plan you already use. Camox does not sit between you and your model provider.
- **Your integrations.** Keep using the skills and MCP servers already connected to your agent, including services like Figma.

<!-- Built for the web — keep unchanged -->

Built for the web

# Modern websites require modern solutions.

Sites have very different needs from apps. Camox was purpose-built to address them.

- **SEO metadata generation** Camox always watches changes to your page content, and generates new title and description tags optimized for Google when needed.
  ![Search result card for "page builder CMS" on Camox.site, showing the title "The page builder framework for coding agents — Camox" and a brief description of Camox as a CMS for developers, LLMs, and human editors.](https://api.camox.dev/cdn-cgi/image/format=auto,quality=85,fit=scale-down,width=1280/files/serve/15/1779105468337-SERP%20Card@2x.webp)
- **Optimized images, metadata included** All your assets get compressed and served in the most efficient format. And AI writes the file names and alternative text, ensuring good a11y.
  ![Sunset over a ridge with a bright moon.](https://api.camox.dev/cdn-cgi/image/format=auto,quality=85,fit=scale-down,width=1280/files/serve/15/1779105363716-Image%20Card@2x.webp)
- **Open Graph image generation** Make your site stand out when shared on the web. All your pages get an OG image out of the box, using a template you can customize.
  ![Tweet promoting Camox, a page builder framework for coding agents, with statistics on engagement like likes and shares.](https://api.camox.dev/cdn-cgi/image/format=auto,quality=85,fit=scale-down,width=1280/files/serve/15/1779105566064-Post%20Card@2x.webp)
- **Serve markdown to agents** When an LLM fetches a page on your site, they don't get HTML but markdown, the most token-efficient language. You define the block-to-markdown template, so nothing is lost in translation.
  ![A visual representation of the markdown serving feature](https://api.camox.dev/cdn-cgi/image/format=auto,quality=85,fit=scale-down,width=1280/files/serve/15/1779105428624-Doc%20Card@2x.webp)

<!-- Stack — keep unchanged -->

STACK

## A foundation you can build on.

- ### React

  Server-side rendering for great SEO. Link prefetching on hover. And extremely type-safe APIs and links.

- ### Vite Plus

  No more tooling problems. Your app comes with the fastest linter, formatter and type checker, based on oxc and tsgo.

- ### Nitro

  Nitro adds support for all runtimes (serverless or not) so you can deploy anywhere. Or swap it for the Cloudflare Vite plugin – your code, your choice.

- ### Tailwind and shadcn/ui

  The best way for AI to manage styles. Change the look of your site by tweaking the theme in a single CSS file.

- ### Base UI

  The most modern and well-maintained headless component library. With full shadcn/ui support.

- ### TanStack Query

  Server data management, fully integrated with your router.

<!-- FAQ -->

## FAQ

### Is Camox free?

Camox will be a paid product, with a free tier for small projects. Pricing details and payment processing will be added once it is ready for production use.

### Is Camox open source?

The codebase is public on GitHub. Almost all of it is MIT-licensed. The API server uses the Fair Source License, with each release becoming MIT-licensed two years after publication.

### Is Camox stable?

Not yet. Do not use it in production. Bug reports are welcome and help make Camox more robust.

### Where is the data stored?

Page content is stored in Camox's hosted API. It runs on Cloudflare Workers, D1, and R2 so compute and database reads happen close to your users.

### Can I self-host Camox?

You host the frontend yourself. Self-hosting the API is possible but not encouraged: its source is public, and you can fork and deploy it to Cloudflare Workers.
