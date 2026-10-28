# Revisions build against an SDK Bundle

Most of a revision's build went to bundling Camox, React and their dependencies, which are the same for every project on an SDK version. In production, a warm build took 2.5 of the 6 to 7 seconds between the start of a build and its preview. So every build now bundles only the website's own code, against an SDK Bundle built ahead of time: Camox, React and the npm packages websites share with Camox, built for the browser and for workerd. That cuts a warm build to about 0.7 seconds. An SDK Bundle is named by a digest of what it's built from and never changes once built. Each revision records the one it was built against, so Live still serves the bytes members previewed (ADR 0020): the revision's build together with its SDK Bundle ([A shell for revision builds](https://github.com/remidej/camox/issues/665)).

## Considered Options

- **A full build on publish, with the SDK Bundle only for previews.** Live would serve a build nobody previewed, which ADR 0020 rejects.
- **One SDK Bundle per SDK version.** Two lockfiles that resolve Camox's dependencies differently would share one name and one set of bytes.
- **Naming it by the whole lockfile.** camox.ai's own dependencies would give it an SDK Bundle of its own, even though it resolves the bundle's packages the same way as the Template.
- **A full build for a website whose resolution differs.** Dispatch, previews and publishes would each handle two shapes of build.
- **SDK Bundles only for the builds Camox serves, with a local `vite build` staying whole-app.** The runtime would keep a second shape for builds nobody serves. A member's local dry-run release (ADR 0026) would also check a different shape from the one that ships.
- **Building a missing SDK Bundle in the sandbox that needs it.** That sandbox may have run a website's code, or restored its cached `node_modules`. Either could tamper with a bundle that other projects then serve.
- **One origin serving every project's SDK Bundles.** Browsers keep a separate cache per site, so visitors wouldn't share it, and it would cost CORS and another connection.
- **The settings `camox()` compiles in, made runtime config now.** They are leftovers from the framework era that belong in the database, which is a separate change. Until then, they are the same for every hosted project.
- **Compiling changed files one by one in a Worker** ([Previewing code changes without a dev server](https://github.com/remidej/camox/issues/369)). With an SDK Bundle, a warm build takes about 0.7 seconds. Per-file compiling would add a second compile path whose output isn't what Live serves.

## Consequences

- **What names an SDK Bundle:** a digest of the following.
  - The version of the code that builds it, which ships in `camox`, so the SDK owns what goes in.
  - The target: the browser or workerd.
  - The lockfile's resolution of the bundle's own packages.
  - The settings `camox()` compiles into it: icon ids, telemetry, experimental features and the API URL.

  Every hosted project shares one SDK Bundle per SDK version, since `vite.config.ts` is platform-owned (ADR 0021). Local development, which points at a local API, gets its own. When those settings move to the database, they leave the name.

- **Every build uses an SDK Bundle**, including a local `vite build` and `camox release`, which build theirs on the spot.
  - A build that names none is whole-app. Dispatch and publishing skip the SDK Bundle's files for it, so builds from before the switch keep working.
  - The next Upgrade's release replaces Live's build. The merge of `main` that follows rebuilds every open draft.
- **Only one step ever stores an SDK Bundle.** It runs in a fresh sandbox that installs from the lockfile with no cache, and stores the bundle unless one with its name already exists.
  - The Upgrade batch runs it for the Template's lockfile before it upgrades projects.
  - Each project's Upgrade runs it for that project's lockfile.
  - A build that finds its SDK Bundle missing waits for this step.
  - Revisions and releases only read SDK Bundles.
- **SDK Bundles are kept forever,** at about 13 MB each, since a revision, a draft's Worker or Live can pin any of them.
- **SDK Bundles are served under their own prefix,** `/_camox/sdk/<name>/`, beside the revision's `/_camox/r/<revision>/`.
  - For previews, dispatch serves the SDK Bundle's files from R2 and gives its workerd modules to the Dynamic Worker.
  - A publish uploads the files as the Worker's static assets, and the modules beside the build's. Workers Assets only uploads the files the Worker lacks.
  - Browsers keep the files across revisions and publishes until an Upgrade changes the name.
- **Visitors download no more JS than before.**
  - The npm packages Camox shares with the website are in the SDK Bundle rather than in both: tailwind-merge, clsx, class-variance-authority and lucide's icon helper.
  - A page's code is grouped into one chunk. The SDK lists the entry points a page loads, and a test fails when page code loads another one outside that chunk.
- **A revision's sandbox downloads its SDK Bundle while it warms,** off the build's path.
- **A preview is prepared from the build the API already holds,** at the same time as the build is saved to R2 and the code is pushed. It shows once all three have succeeded.
- **The Studio still checks the renderer frame's SDK version,** not its SDK Bundle (ADR 0023).
- **The public render cache key needs no SDK Bundle name** (ADR 0022). A render names its SDK Bundle's files, but a build pins one SDK Bundle that never changes, and every build gets a new build ID.
