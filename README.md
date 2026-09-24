<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="./art/logo-banner-dark.webp" />
    <source media="(prefers-color-scheme: light)" srcset="./art/logo-banner-light.webp" />
    <img src="./art/logo-banner-light.webp" alt="Camox logo" />
  </picture>
</p>

## The CMS framework for agent-managed websites

Camox is a web framework built on Vite, with a CMS at its heart. It’s designed for websites that coding agents not only build, but manage over time.

Agents and human editors work on the same site, with shared drafts and publishing workflows. Edit visually in the UI, or through your agent, without needing code changes or redeploys.

Camox takes an active role in maintaining your website. It watches content as it changes and works in the background to improve it, without waiting for you or your agent to ask.

- [Website](https://camox.dev)
- [GitHub](https://github.com/remidej/camox)

## Quick start

```bash
npm create camox@latest
```

## How it works

1. Create a project with `npm create camox@latest`.
2. Use your coding agent to define blocks in code.
3. Create pages by assembling blocks. Either visually in the UI, or with the CLI using your agent
4. Edit drafts, review changes, and publish when ready.

## Features

- **Visual editing:** edit content, assemble pages, and rearrange blocks directly on your website.
- **Publishing workflows:** autosave, drafts, and explicit publishing.
- **Agent workflows:** CLI content management, versioned skills, and schema-derived types.
- **Website features:** SEO metadata generation, image optimization, and customizable Open Graph images.
- **Markdown for agents:** define how each block’s content is represented in Markdown.

## Developing this repository

Run `.agents/prepare` to install dependencies, build packages, and initialize the
checkout-local database. Then run `pnpm dev` (`pnpm dev:servers` for only the API
and dashboard, or `pnpm dev:all` for all apps).

Each launch picks available API and dashboard ports, starting at 8787 and 3274,
and prints their URLs. Those URLs are passed to the apps together, so the
playground, template, and dashboard use this checkout's API and authentication
server. Other frontends and Worker inspectors select their own available ports.
Port choices are not saved, and shared environment files are not rewritten.
If a coordinated port is taken during startup, the launcher restarts the group
with fresh ports. Ctrl-C stops the group.

The setup script's checkout-local dev credentials also work when the dashboard
port changes. Production configuration is unchanged. For browser login testing,
remember that localhost cookies are shared across ports, and OAuth providers may
require registering the chosen API callback URL.

## License

The Camox framework is MIT-licensed: `camox`, `@camox/cli`, `create-camox`,
`@camox/ui`, `@camox/api-contract`, templates, and supporting packages. The
hosted API implementation in `apps/api` is source-available under [FSL-1.1-MIT](https://fsl.software/).
