# Deleting a project

A marketer deletes a project from its page in the dashboard. Nothing is kept for recovery.

## During the request

`projects.delete` (`../projects/service.ts`) removes the project's rows, then its `<slug>.camox.site` entry from the `PROJECT_SLUGS` KV map, so the dispatch Worker answers the host with its not-found page at once (`apps/dispatch`). It then starts the `camox-project-deletion` Workflow, with the Project ID as its instance ID, and returns. The slug is free for a new project straight away.

## The deletion Workflow

`workflow.ts`. Workflows retry a failed step, and each step is done once what it deletes is gone:

1. **Stop the setup.** A project deleted while it was being set up may still have its creation Workflow (`../project-creation/`) underway, and a retried fork would make its repo again. The instance named after the Project ID is terminated unless it has ended. A project created before the creation Workflow existed has no instance.
2. **Delete the Worker.** Deletes the user Worker named after the Project ID from the `production` dispatch namespace through the Cloudflare API, with the API's `CF_TOKEN`. A Worker that was never deployed answers 404, which is done.
3. **Delete the repo.** Deletes the repo named after the Project ID from the `projects` Artifacts namespace. A repo that was never forked is done.

A step that gives up doesn't stop the next ones from cleaning up what they can. Once they've all run, a cleanup with a failed step emails one alert (`alert.ts`, on `src/lib/alert-email.ts`) to the alerts address, naming the project, its Project ID and the failed steps, and linking to the Workflow instance, then fails. The site is already offline, so only Rémi hears about it. Once the cause is fixed, restart the instance (named after the Project ID) from the Cloudflare dashboard.

A release can still be running when its project is deleted. Its `release` step fails without the project, but one already past it deploys the Worker again. That Worker serves nothing, as no host maps to it; re-running the cleanup deletes it.

## Tests

`workflow.integration.test.ts` runs the Workflow in the Workers pool, with Cloudflare Artifacts, the Cloudflare API's dispatch namespace scripts and email faked (`test/release-fakes.js`). The API's outbound fetches reach the fakes in tests (`outboundService` in `vite.config.ts`). `../projects/delete.integration.test.ts` covers the request.

## On Cloudflare

Nothing to provision: `wrangler deploy` creates the Workflow, and the `CF_TOKEN` that deploys user Workers into the `production` namespace (_Account › Workers Scripts › Edit_, `../releases/README.md`) can also delete them.
