# Creating a project

A member creates a project from the dashboard, with a name and a slug. There's no other way: `camox init` (and `npm create camox`) no longer creates projects.

## During the request

`projects.create` (`../projects/service.ts`) refuses a slug that isn't one lowercase DNS label, is reserved for Camox (`RESERVED_PROJECT_SLUGS` in `@camox/api-contract/projects`) or is taken, with the message the dashboard shows. `projects.checkSlugAvailability` tells the same reasons ahead of time. Otherwise it:

1. inserts the project with its Deploy Token, in status `settingUp` at the `copyTemplate` setup step;
2. writes `<slug> → <Project ID>` to the `PROJECT_SLUGS` KV map, so `<slug>.camox.site` answers at once with the dispatch Worker's "This site is being set up" page;
3. starts the `camox-project-creation` Workflow, with the Project ID as its instance ID, and returns.

If the KV write or the Workflow's start fails, the setup fails as a creation step would: the project is marked `setupFailed` at `copyTemplate`, the alert below is sent, linking to the Workflow rather than an instance, and the request returns the failed project.

## The creation Workflow

`workflow.ts`. Each step is retried, and a step whose work landed may have failed after it, so each first checks whether its work is done:

1. **Fork the Template.** Forks `template-default` into a repo named after the Project ID. A fork that already exists (`ALREADY_EXISTS`) was made by an earlier attempt.
2. **Commit the project's code.** Cloudflare Artifacts forks in the background, so getting the repo throws `FORK_IN_PROGRESS` until it's done, which retries the step. Without a Container, it clones the repo in memory with isomorphic-git (`copy.ts`, on `src/lib/memory-fs.ts`), writes the Project ID into `vite.config.ts` and `wrangler.jsonc`, the name into the Template's `{{projectName}}` placeholders and the slug into `package.json`, as `camox init` did, commits "Create <name>" and pushes to `main` with a short-lived write token. A `wrangler.jsonc` on `main` that already holds the Project ID means an earlier attempt pushed.
3. **Follow the setup to building.** The push starts the project's first release (`../releases/`).

The release Workflow carries the setup on while the project isn't live: it moves the setup step to `build`, then to `serve` before deploying, and makes the project `live` once the release succeeds. A first release that gives up marks the project `setupFailed` at its step, and its release alert reaches the alerts address.

## When the setup fails

A creation step that gives up marks the project `setupFailed` at `copyTemplate` and emails one alert (`alert.ts`) to the alerts address, naming the project, its Project ID and the failed step, and linking to the Workflow instance. Nothing is undone. The project's page marks the failed step and tells its organization Camox has been told, with no retry button. Once the cause is fixed, restart the instance (named after the Project ID) from the Cloudflare dashboard; a failed first release is re-run from its own instance, which puts the project back to setting up.

## Tests

`workflow.integration.test.ts` runs the Workflow, then the first release, in the Workers pool. Cloudflare Artifacts is faked at its binding (`test/release-fakes.js`), with the fake repos' Git remotes served over smart HTTP by `test/fake-git-server.ts`, which the API's outbound fetches reach in tests (`outboundService` in `vite.config.ts`). `../projects/create.integration.test.ts` covers the request.

## On Cloudflare

Nothing to provision beyond the release Workflow's setup (`../releases/README.md`): the API already binds the `projects` Artifacts namespace and the `PROJECT_SLUGS` KV map, and `wrangler deploy` creates the Workflow. Check once on Cloudflare that forking the read-only `template-default` gives a writable repo, and that a push with a repo write token as `Authorization: Bearer` is accepted from a Worker, as the Template refresh does from CI.
