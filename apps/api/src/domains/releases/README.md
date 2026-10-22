# Releases

A push to a project's `main` releases it: it builds the website, syncs its definitions to Live, then deploys its Worker into the `production` dispatch namespace, where `<slug>.camox.site` serves it (GLOSSARY.md, ADR 0014).

Cloudflare Artifacts sends `cf.artifacts.repo.pushed` for every push to a repo in the `projects` namespace, and `triggers.events` in `wrangler.jsonc` starts the `camox-release` Workflow (`workflow.ts`) with it. The event filter can only name the namespace, so the Workflow skips:

- a push to any branch other than `main`;
- a repo whose name isn't a Project ID, such as `template-default`, which every SDK publish refreshes;
- a Project ID no project has, such as a deleted project's repo.

## Steps

The Workflow runs on `@cloudflare/ci`. Each step after the first runs in its own Container sandbox, on the workspace the previous one left. Workflows retry a failed step, so each one is idempotent.

1. **Record the release.** It maps the repo to its project, reads the `camox` version from the commit's `pnpm-lock.yaml` through the Artifacts binding, and writes the release's row as `running`.
2. **`install`:** `pnpm install --frozen-lockfile`. Its workspace is cached on `pnpm-lock.yaml`, per project.
3. **`release`:** `pnpm exec camox release`, which builds the website and syncs its Definition Set to Live, as for any release. Syncing the same set again changes nothing.
4. **`deploy`:** `pnpm exec wrangler deploy --dispatch-namespace production --name <Project ID>`. The name comes from the repo, so a project's code can only replace its own Worker.

Live gets the new definitions before the new code is deployed. If the deploy fails for good, Live briefly has definitions the served code lacks, until the release is re-run or a fix is pushed.

The row ends `succeeded`, or `failed` with the step that gave up. Its `workflow_instance_id` names the Workflow instance, where the logs are. Restarting the instance re-runs the release and starts its row over as `running`.

## A new project's first release

Until a project is `live`, its releases carry its setup on (`../project-creation/README.md`): recording the release moves the setup step to `build`, the Workflow moves it to `serve` before deploying, and a succeeded release makes the project `live`. A release that gives up marks the project `setupFailed` at the step it belongs to (`install` and `release` are `build`, `deploy` is `serve`). A live project's releases leave its status alone.

## When a release fails

A step that gives up after its retries fails the release. The Workflow records the row as `failed` with that step, then emails an alert to the alerts address: from `alerts@camox.dev` to the API's `ALERT_EMAIL_TO` var. The alert is its own step, so a replay of the instance doesn't send it again, though a step can rarely run twice. The alert (`alert.ts`, on the generic alert email in `src/lib/alert-email.ts`, in the layout of `src/lib/email.ts` that auth emails share) names the project, its Project ID, the commit and the failed step, and links to the Workflow instance in the Cloudflare dashboard. A row that can't be recorded or an alert that can't be sent is logged: it neither stops the other nor hides the release's own error. A project deleted during its release stops it before it deploys, and its failures alert nobody (`../project-deletion/README.md`).

Nothing else changes: the previous Worker keeps serving, and neither the dashboard nor the studio shows the failure. A re-run that fails again sends another alert. A project serves the `camox` version of its last succeeded release, so the projects serving an SDK older than a version are a query on `releases` (ADR 0019).

## Secrets

Each secret reaches only the step that needs it:

- **The project's Deploy Token** goes to `release` alone, as `CAMOX_DEPLOY_TOKEN`. The Workflow reads it outside any step, so it never appears in a step's output, which the Workflow keeps and shows.
- **Camox's Cloudflare token**, the API's `CF_TOKEN` secret, goes to `deploy` alone, as `CLOUDFLARE_API_TOKEN`, through `@cloudflare/ci`'s `cloudflareCredentials`.
- The read token each sandbox clones the commit with is minted per step and only reaches the clone.

`@cloudflare/ci` redacts the Deploy Token from a failed step's error, but not from the step's raw logs.

## Where it runs

- **The Workflow** runs in the API Worker, beside the database it records releases in.
- **The sandboxes** are the `CiSandbox` Durable Object of the `camox-release-sandbox` Worker (`release-sandbox/`), which the API binds by script name, like the code mode sandbox. Only that Worker carries the Container image: `cloudflare/sandbox` with pnpm.
- **The `camox-release-cache` R2 bucket** keeps each step's workspace snapshot, which the next step restores and which caches installs.

The container size is `standard-2` (1 vCPU, 6 GiB). It hasn't been measured yet: one release of the Template, cold and warm, should pick between it and `standard-4` (#447).

## Tests

`workflow.integration.test.ts` runs the Workflow in the Workers pool with Cloudflare Artifacts, the sandboxes and the `EMAIL` binding faked at their bindings (`test/release-fakes.js`). The fake sandbox runs nothing: it records each command with its environment, and fails the ones a test asks it to. The fake email binding records each email instead of sending it.

```sh
pnpm --filter @camox/api exec vp test --run --project integration src/domains/releases
```

## Cloudflare setup

Do this before the first deploy that includes the release Workflow, as the API's deploy fails without the bucket and the sandbox Worker. Run the commands from `apps/api`.

1. **The R2 bucket** for workspace snapshots:

   ```sh
   pnpm exec wrangler r2 bucket create camox-release-cache
   ```

2. **An R2 API token** that can read and write `camox-release-cache` (dashboard: _R2 › Manage API tokens_, "Object Read & Write", that bucket only). The sandboxes write their snapshots with it. Give its keys and Camox's account ID to the sandbox Worker:

   ```sh
   pnpm exec wrangler secret put CLOUDFLARE_ACCOUNT_ID --config release-sandbox/wrangler.jsonc
   pnpm exec wrangler secret put R2_ACCESS_KEY_ID --config release-sandbox/wrangler.jsonc
   pnpm exec wrangler secret put R2_SECRET_ACCESS_KEY --config release-sandbox/wrangler.jsonc
   ```

3. **A Cloudflare API token for deploys**, with _Account › Workers Admin_ on Camox's account, so that `wrangler deploy --dispatch-namespace production` can create user Workers and project deletion can delete them (_Workers Editor_ can do neither). Give it and the account ID to the API:

   ```sh
   pnpm exec wrangler secret put CF_TOKEN
   pnpm exec wrangler secret put CLOUDFLARE_ACCOUNT_ID
   ```

4. **CI's token** deploys the sandbox Worker's Container and the API's event subscription, so it needs Containers and event subscription permissions on top of what it has. The `deploy` job's dry run builds the image with Docker before anything changes.

5. **An Email Routing rule** on `camox.dev` (dashboard: _Email › Email Routing › Routing rules_) that forwards `alerts@camox.dev`, the API's `ALERT_EMAIL_TO`, to the inbox where alerts are read. The `EMAIL` binding sends from `alerts@camox.dev`, which `allowed_sender_addresses` in `wrangler.jsonc` lists.

The `projects` Artifacts namespace and the `production` dispatch namespace already exist (`packages/cli/scripts/README.md`, `apps/dispatch/README.md`). `wrangler deploy` creates the `cf.artifacts.repo.pushed` subscription from `triggers.events`.
