# Changelog

## [0.66.0](https://github.com/remidej/camox/compare/camox-v0.65.1...camox-v0.66.0) (2026-10-30)


### Changes

* **api:** hand artifact sources to Artifact Agents ([#765](https://github.com/remidej/camox/issues/765)) ([6fdcc8e](https://github.com/remidej/camox/commit/6fdcc8e84fe8f2dd7370b55bc432624762328575))
* **api:** start the Live thread afresh each time it hands a request off to a draft ([#772](https://github.com/remidej/camox/issues/772)) ([156a5c6](https://github.com/remidej/camox/commit/156a5c6a7ab0a4642712f9eebf55be0a3477c6ee))
* **api:** steer the agent away from repetitive pages ([#761](https://github.com/remidej/camox/issues/761)) ([d0d9633](https://github.com/remidej/camox/commit/d0d96337f300eb286d5e9129bcfdd3a91125d9c6))
* ask what to do with a draft started by editing on Live ([#763](https://github.com/remidej/camox/issues/763)) ([0fa9ec9](https://github.com/remidej/camox/commit/0fa9ec97354334a315c63712c3f25702d4901f34))
* **sdk:** cover Canvas seams without overlapping blocks ([#771](https://github.com/remidej/camox/issues/771)) ([d58c4e7](https://github.com/remidej/camox/commit/d58c4e795e7c38c1e1bd1facee78003b30fc14e6))
* **sdk:** keep the chat on the agent's work and the composer focused across threads ([#766](https://github.com/remidej/camox/issues/766)) ([f49e730](https://github.com/remidej/camox/commit/f49e7308fb89e2eb7090d2dedfd7f50af7df831f))
* **sdk:** refetch the social preview image when the draft gets a new revision ([#770](https://github.com/remidej/camox/issues/770)) ([1a9e0b1](https://github.com/remidej/camox/commit/1a9e0b138827780b585d5969e4a414e51e10f41c))
* **sdk:** remove the callouts about page structure being set in code ([#769](https://github.com/remidej/camox/issues/769)) ([4b48115](https://github.com/remidej/camox/commit/4b48115c9da688749fea9ff8e9b41190cba7bf08))
* **sdk:** split the unnamed draft bar's buttons and make Publish primary ([#768](https://github.com/remidej/camox/issues/768)) ([c0bd0d3](https://github.com/remidej/camox/commit/c0bd0d38e813dc71b30d37b5e80a5dc1b8d961f4))
* **sdk:** start the next page halfway across the agent sidebar when snapped ([#767](https://github.com/remidej/camox/issues/767)) ([bac54aa](https://github.com/remidej/camox/commit/bac54aa209e3d6bbb8ea379dd6c916416c059fa4))
* show the Patrol as a grid of patroller avatars with profile cards ([#764](https://github.com/remidej/camox/issues/764)) ([ad57614](https://github.com/remidej/camox/commit/ad5761490c29b74d09666de6bb0ab9092ed46af0))

## [0.65.1](https://github.com/remidej/camox/compare/camox-v0.65.0...camox-v0.65.1) (2026-10-30)


### Changes

* **api:** keep new patrollers away from studios that can't show them ([#759](https://github.com/remidej/camox/issues/759)) ([ef4ddbd](https://github.com/remidej/camox/commit/ef4ddbddcc05b99b7efa55a365b9489020d07375))

## [0.65.0](https://github.com/remidej/camox/compare/camox-v0.64.0...camox-v0.65.0) (2026-10-30)


### Changes

* **api:** lint the turn's changed files beside its build, and have the agent fix what lint finds ([#756](https://github.com/remidej/camox/issues/756)) ([a866791](https://github.com/remidej/camox/commit/a866791ac331438dc37ee03ce21506f0d1688682))
* **api:** publishing always waits for translations ([#755](https://github.com/remidej/camox/issues/755)) ([3a062e4](https://github.com/remidej/camox/commit/3a062e4067460c6ef15db0a191845800d604fb06)), closes [#743](https://github.com/remidej/camox/issues/743)
* decide that patrollers raise findings that hold publishing, and drop Publish Anyway ([c7b27c2](https://github.com/remidej/camox/commit/c7b27c21ce0a668333b3177086767af779adc38c))
* link ADRs 0033 and 0034 to their specs ([5e6f689](https://github.com/remidej/camox/commit/5e6f689df3407ffbd2132bd7170255afb1e196e1))
* the Proofreader and the Link checker: findings that hold publishing ([#757](https://github.com/remidej/camox/issues/757)) ([a197a44](https://github.com/remidej/camox/commit/a197a44ce468379e4a62b8c98c171b048353096c))

## [0.64.0](https://github.com/remidej/camox/compare/camox-v0.63.0...camox-v0.64.0) (2026-10-29)


### Changes

* **api:** annotate lookTool's return type so package declarations build ([60953a5](https://github.com/remidej/camox/commit/60953a574c95eaf63ff82d7f9b129a3a95549b2a))
* **api:** give the agent a website design skill ([#730](https://github.com/remidej/camox/issues/730)) ([7a7941c](https://github.com/remidej/camox/commit/7a7941c43e53cbb13a002a68e41773a58959327f))
* **api:** log failed agent model calls, and alert when OpenRouter's account turns them down ([#733](https://github.com/remidej/camox/issues/733)) ([9fdbcff](https://github.com/remidej/camox/commit/9fdbcfffd9421a7711c8b14c26a0febc1ae65cb5))
* let the agent look at pages of Singleton and Derived Layouts ([#734](https://github.com/remidej/camox/issues/734)) ([ba5dbfd](https://github.com/remidej/camox/commit/ba5dbfd288d75bef58e6a48d1b757abd62393243))
* **sdk:** crop long chat messages past four lines, with a button to show them in full ([#732](https://github.com/remidej/camox/issues/732)) ([1470617](https://github.com/remidej/camox/commit/1470617e2573d9b5c482a7ddb244165744b83cb7))
* **sdk:** invite editors to connect their AI from the Agent Sidebar ([#735](https://github.com/remidej/camox/issues/735)) ([a4afc37](https://github.com/remidej/camox/commit/a4afc372bec4d362bd34884d399a46f2481851ee))
* **sdk:** keep leaving sidebar cards where they were as the stack changes ([#736](https://github.com/remidej/camox/issues/736)) ([cd5ea6b](https://github.com/remidej/camox/commit/cd5ea6b8b4ce08633c7118dd97f261ccfbf390b0))
* **sdk:** stop clicks beside a field on the Canvas from editing it ([#737](https://github.com/remidej/camox/issues/737)) ([5e05b83](https://github.com/remidej/camox/commit/5e05b83eef70a127dfbf9d8d205a19d28cb58a50))
* **sdk:** zoom the Canvas overview out past a lone short Page ([#739](https://github.com/remidej/camox/issues/739)) ([6f39878](https://github.com/remidej/camox/commit/6f398780fa8b0cc1242dc0de709807141a7a7a99))
* the agent looks at what it designed ([#727](https://github.com/remidej/camox/issues/727)) ([70f8822](https://github.com/remidej/camox/commit/70f8822a192cb1cc51102b5dd16d719341d8b147))

## [0.63.0](https://github.com/remidej/camox/compare/camox-v0.62.0...camox-v0.63.0) (2026-10-29)


### Changes

* Connected Agents, an MCP server through which members' own AI drives Camox's agent ([#714](https://github.com/remidej/camox/issues/714)) ([90b40df](https://github.com/remidej/camox/commit/90b40dff770dee5b34d8a6f4f9dacb50ca2b81d1))

## [0.62.0](https://github.com/remidej/camox/compare/camox-v0.61.0...camox-v0.62.0) (2026-10-29)


### Changes

* **adr:** let the agent see a draft through a look token ([71310e2](https://github.com/remidej/camox/commit/71310e29ccce567ee138d63cf3e23d0ce189777c))
* **api:** give the agent platform skills it reads when a task needs them ([#698](https://github.com/remidej/camox/issues/698)) ([438f96f](https://github.com/remidej/camox/commit/438f96fc8e5095f8a3e6e5b73d20582b1a0e8091))
* **api:** record what every AI job call costs ([#715](https://github.com/remidej/camox/issues/715)) ([816f74d](https://github.com/remidej/camox/commit/816f74db3ddc906a36880c58aa61e040c5911127))
* **api:** run the agent on Claude Opus 5.5 at medium effort ([#703](https://github.com/remidej/camox/issues/703)) ([78847c3](https://github.com/remidej/camox/commit/78847c3ad2272370c363c9742cbaaf44ac21880e))
* decide that Connected Agents drive Camox's agent over MCP ([da2471d](https://github.com/remidej/camox/commit/da2471d35b4cdf57629a33e2a09d09e3c105a484))
* link ADR 0030 to its spec ([f6fdc99](https://github.com/remidej/camox/commit/f6fdc99c6bc2d24494c4149baa09e9978591280a))
* make experimental features a Project Setting ([#699](https://github.com/remidej/camox/issues/699)) ([f870808](https://github.com/remidej/camox/commit/f870808e716ab009bcf29b5beb1962790b34f6ae))
* **template:** add an accent color to the Theme ([#695](https://github.com/remidej/camox/issues/695)) ([b172389](https://github.com/remidej/camox/commit/b1723891bec4ccdda5122f95c50727da3ad89141))

## [0.61.0](https://github.com/remidej/camox/compare/camox-v0.60.2...camox-v0.61.0) (2026-10-28)


### Features

* turn SDK Bundles on, and fix the Upgrade's SDK Bundle install ([#696](https://github.com/remidej/camox/issues/696)) ([13d8295](https://github.com/remidej/camox/commit/13d8295e819c4b44ac3fd286d56802b3ea6feb53))


### Miscellaneous

* lint against unchecked type assertions with vendored anti-slop rules ([#693](https://github.com/remidej/camox/issues/693)) ([d27970f](https://github.com/remidej/camox/commit/d27970fc0f5fab43b5fabd13aae25d4bfb6b789c))

## [0.60.2](https://github.com/remidej/camox/compare/camox-v0.60.1...camox-v0.60.2) (2026-10-28)


### Bug Fixes

* **api:** resolve every SDK export from source in the API's tests ([#691](https://github.com/remidej/camox/issues/691)) ([13ca046](https://github.com/remidej/camox/commit/13ca0469357140841aad980da67a3aa146d8bfec))

## [0.60.1](https://github.com/remidej/camox/compare/camox-v0.60.0...camox-v0.60.1) (2026-10-28)


### Bug Fixes

* **api:** bundle the release fakes against the SDK's source ([#689](https://github.com/remidej/camox/issues/689)) ([21b51bf](https://github.com/remidej/camox/commit/21b51bf31632c8a964d7a08648ecb466c85d3a4f))

## [0.60.0](https://github.com/remidej/camox/compare/camox-v0.59.0...camox-v0.60.0) (2026-10-28)


### Features

* revisions build against an SDK Bundle ([#681](https://github.com/remidej/camox/issues/681)) ([b7b39c7](https://github.com/remidej/camox/commit/b7b39c7441fb5a79f93da46ca5520327e712e083))
* say what the agent does beside its squareling, with a face for each activity ([#686](https://github.com/remidej/camox/issues/686)) ([9760946](https://github.com/remidej/camox/commit/97609460e279d3dcb68ea2ea94ccd263837d4d6b))
* **sdk:** open a patroller's reports in a popover to the left ([#685](https://github.com/remidej/camox/issues/685)) ([25480db](https://github.com/remidej/camox/commit/25480db12aafad3eb7ec98af48dd2b85a4dcb6a7))
* **sdk:** reorder social profiles by drag and drop ([#688](https://github.com/remidej/camox/issues/688)) ([fb34563](https://github.com/remidej/camox/commit/fb3456396b1a1ac769c3a5c15ce3d901279c605e))
* serve camox.ai from its hosted project and remove the framework-era landing ([#682](https://github.com/remidej/camox/issues/682)) ([3d68865](https://github.com/remidej/camox/commit/3d6886564fbdaaf7f6fb6c5fcf6b39394b618a2a)), closes [#663](https://github.com/remidej/camox/issues/663)
* show the selection in the agent composer and tell the agent about it ([#687](https://github.com/remidej/camox/issues/687)) ([6456d5e](https://github.com/remidej/camox/commit/6456d5edef50cf1595de877b567f5676c1f19403))
* tell the agent which page the editor is looking at ([#668](https://github.com/remidej/camox/issues/668)) ([f1a2ca7](https://github.com/remidej/camox/commit/f1a2ca7ec0641e2a960a40ff412aca292d8becaf))


### Bug Fixes

* **dashboard:** show the project slug input as one field with its domain ([#666](https://github.com/remidej/camox/issues/666)) ([3317879](https://github.com/remidej/camox/commit/3317879cbcf4fbe128924298349ff3ac6ef3b614))
* **sdk:** sign the studio in on the Worker, without a reload ([#683](https://github.com/remidej/camox/issues/683)) ([b6502d4](https://github.com/remidej/camox/commit/b6502d42517c5c44227ee792caf74a2d76d01693))
* **sdk:** stop a draft's preview doubling its page when new code arrives ([#680](https://github.com/remidej/camox/issues/680)) ([daa11d5](https://github.com/remidej/camox/commit/daa11d5d787bad5ffc19eec7d5e350ad5afb3bc4))
* studio navbar keeps draft and locale, plus dashboard touch-ups ([#684](https://github.com/remidej/camox/issues/684)) ([34bffd9](https://github.com/remidej/camox/commit/34bffd9410b7161fc47747476644006bb9ed5dad))


### Documentation

* revisions build against an SDK Bundle (ADR 0029) ([04aaff6](https://github.com/remidej/camox/commit/04aaff6ee349496712c3262d49b9aa91005e6efd))


### Miscellaneous

* check out camox.ai's hosted project as a submodule ([#669](https://github.com/remidej/camox/issues/669)) ([06a32b8](https://github.com/remidej/camox/commit/06a32b84812c27c47a0b6a7d8b63f307d8f68e62)), closes [#662](https://github.com/remidej/camox/issues/662)

## [0.59.0](https://github.com/remidej/camox/compare/camox-v0.58.1...camox-v0.59.0) (2026-10-28)


### ⚠ BREAKING CHANGES

* `vite dev` refuses to start unless `_internal.apiUrl` is a local API and `_internal.localDeployToken` is set: a hosted project's code reaches Camox through drafts and Upgrades.

### Features

* host camox.ai like any project (pushing code to drafts, no development drafts, Custom Domains) ([#664](https://github.com/remidej/camox/issues/664)) ([147ab16](https://github.com/remidej/camox/commit/147ab16efda8fa75049e9b5e08eb25f7f94e5f88))


### Performance Improvements

* faster revision builds ([#649](https://github.com/remidej/camox/issues/649)) ([#651](https://github.com/remidej/camox/issues/651)) ([e3d2653](https://github.com/remidej/camox/commit/e3d2653018b07476f48ba3592f64ea3c800fa332))


### Documentation

* link ADRs 0026 to 0028 to their spec, [#653](https://github.com/remidej/camox/issues/653) ([be9fca6](https://github.com/remidej/camox/commit/be9fca6f424c668e3fa71ff3b4183d579026d664))
* pushing code to drafts, no more development drafts, and Custom Domains ([26de31c](https://github.com/remidej/camox/commit/26de31c22491dd264883f205aa94f0de85002b42))


### Miscellaneous

* **agents:** split test quality out of tdd into a good-tests skill ([#650](https://github.com/remidej/camox/issues/650)) ([1c194a7](https://github.com/remidej/camox/commit/1c194a704f7862790a609be11dff6b285f65dab8))

## [0.58.1](https://github.com/remidej/camox/compare/camox-v0.58.0...camox-v0.58.1) (2026-10-27)


### Performance Improvements

* faster revision previews and publishes ([#636](https://github.com/remidej/camox/issues/636)) ([#647](https://github.com/remidej/camox/issues/647)) ([c4fc113](https://github.com/remidej/camox/commit/c4fc1135eeb076cad4159728066a18dd01f0a8af))


### Miscellaneous

* **api:** drop the one-off artifact source backfill now that it ran ([cc18970](https://github.com/remidej/camox/commit/cc1897095b562d1fc94b2d996d9572d6de16bc21))

## [0.58.0](https://github.com/remidej/camox/compare/camox-v0.57.0...camox-v0.58.0) (2026-10-27)


### Features

* public pages load artifacts by URL ([#643](https://github.com/remidej/camox/issues/643)) ([8cb2fa5](https://github.com/remidej/camox/commit/8cb2fa57176d9407604f1df8f0c19422e935baff))


### Refactoring

* **sdk:** drop renaming drafts from the draft picker ([#644](https://github.com/remidej/camox/issues/644)) ([b01a77f](https://github.com/remidej/camox/commit/b01a77f0e600f659b3feff5749e523d17a5dbeaf))

## [0.57.0](https://github.com/remidej/camox/compare/camox-v0.56.0...camox-v0.57.0) (2026-10-27)


### Features

* Live threads hand requests off to drafts ([#632](https://github.com/remidej/camox/issues/632)) ([371d044](https://github.com/remidej/camox/commit/371d0442515f299744ab985f68ad01f2115feacb))
* the Patrol shows the work Camox does without being asked ([#624](https://github.com/remidej/camox/issues/624)) ([6bc46f5](https://github.com/remidej/camox/commit/6bc46f5e01a8607f38321634710961feffb6a362))


### Bug Fixes

* a draft with code's preview uses its revision's stylesheet, and timing logs for builds, turns and publishes ([#635](https://github.com/remidej/camox/issues/635)) ([f557bf9](https://github.com/remidej/camox/commit/f557bf917b93664b01e94485e022d45c366f9da9))
* **api:** read main's tip over git protocol v2, as Cloudflare Artifacts speaks it ([052ae62](https://github.com/remidej/camox/commit/052ae62f788bf8a897cc61fb2136dfd7d6f1f7ee))
* **landing:** inline the footer's year at build time so it hydrates ([#633](https://github.com/remidej/camox/issues/633)) ([49f027a](https://github.com/remidej/camox/commit/49f027ac1e9dd25612f230362ec9d2817803aa64))


### Performance Improvements

* **sdk:** stop the sidebar stack and Canvas page paths from repainting as they move ([#634](https://github.com/remidej/camox/issues/634)) ([1a7f8ae](https://github.com/remidej/camox/commit/1a7f8aeab9c49874a76e291150faccbbb942ea7e))


### Documentation

* hand Live threads' requests off to drafts with a Brief, and record ADR 0025 ([f51e653](https://github.com/remidej/camox/commit/f51e653a8b4b3b95d0648bbccf69381e26d26ca4))
* public pages load artifacts by URL, amending ADR 0002 ([3cdf646](https://github.com/remidej/camox/commit/3cdf64655dfb11b9489dad48a0937716aa0b9ce6))

## [0.56.0](https://github.com/remidej/camox/compare/camox-v0.55.0...camox-v0.56.0) (2026-10-27)


### ⚠ BREAKING CHANGES

* the API's `drafts.discard` procedure is now `drafts.delete`, an ended draft's outcome is `deleted` instead of `discarded`, and the CLI's `discard` command is now `delete`. A migration rewrites stored outcomes.

### Features

* the agent reads the camox skill at the version its website installs ([#623](https://github.com/remidej/camox/issues/623)) ([9a0cd14](https://github.com/remidej/camox/commit/9a0cd14c30d30d7e3897cd2a241eb5f9b2e540f2))


### Bug Fixes

* **cli:** wait for npm before resolving the Template's lockfile ([#613](https://github.com/remidej/camox/issues/613)) ([9bc9b12](https://github.com/remidej/camox/commit/9bc9b1217d795ccfa4fd966abbba66f7fc6b1606))


### Refactoring

* delete drafts instead of discarding them ([#615](https://github.com/remidej/camox/issues/615)) ([bc5ccce](https://github.com/remidej/camox/commit/bc5ccce7a2a61389cbd8d834ec1cf7aeea60663f))


### Documentation

* name the Patrol, its patrollers and reports, and record ADR 0024 ([15c35a3](https://github.com/remidej/camox/commit/15c35a38aeba16286c34dfcaf9b52d7a65008360))

## [0.55.0](https://github.com/remidej/camox/compare/camox-v0.54.0...camox-v0.55.0) (2026-10-26)


### Features

* **api:** let the agent upload files from a URL ([#606](https://github.com/remidej/camox/issues/606)) ([626856b](https://github.com/remidej/camox/commit/626856bb46645c35f17ea4f1bf5ebb22e2701ca7))
* **sdk:** light sidebar cards from above, and fold one more parent ([#608](https://github.com/remidej/camox/issues/608)) ([84f42cc](https://github.com/remidej/camox/commit/84f42ccbc1c6c2336ee6a7054a1e31ff1c9612b4))
* **sdk:** split the Canvas's right side into an Agent Sidebar with workers and chat ([#610](https://github.com/remidej/camox/issues/610)) ([131fa57](https://github.com/remidej/camox/commit/131fa573f03a835200bbc118e5968a60252a4e68))


### Bug Fixes

* **api:** lint a draft's code as a dry-run release ([#609](https://github.com/remidej/camox/issues/609)) ([4a8182a](https://github.com/remidej/camox/commit/4a8182a38f165e18f66c576692a7818964fa3b9b))

## [0.54.0](https://github.com/remidej/camox/compare/camox-v0.53.1...camox-v0.54.0) (2026-10-26)


### Features

* **sdk:** collapse the middle of long selection paths in the sidebar stack ([#604](https://github.com/remidej/camox/issues/604)) ([b8bbc1c](https://github.com/remidej/camox/commit/b8bbc1c40184554a37c47cc9f5b6d788ff347720))
* **sdk:** give the agent a squareling avatar that shows what it's doing ([#605](https://github.com/remidej/camox/issues/605)) ([231adc3](https://github.com/remidej/camox/commit/231adc3022172761803f116ac87d9c918ce78f56))
* **sdk:** style page images with the site's Tailwind theme and fonts ([#600](https://github.com/remidej/camox/issues/600)) ([6d88acf](https://github.com/remidej/camox/commit/6d88acf5cea0c8f3a06e75b2df063ffb2054d916))


### Bug Fixes

* **sdk:** draw sidebar card edges as solid inner borders ([#603](https://github.com/remidej/camox/issues/603)) ([5b7de9b](https://github.com/remidej/camox/commit/5b7de9b07d5179f2540b0ccbcb92fbde42b33268))
* **sdk:** preload block code in production builds ([#601](https://github.com/remidej/camox/issues/601)) ([c02f319](https://github.com/remidej/camox/commit/c02f319f3d08d85190033e816638f3e799ac2d38)), closes [#558](https://github.com/remidej/camox/issues/558)

## [0.53.1](https://github.com/remidej/camox/compare/camox-v0.53.0...camox-v0.53.1) (2026-10-26)


### Bug Fixes

* **sdk:** load a started draft's renderer on its first revision ([#597](https://github.com/remidej/camox/issues/597)) ([26fcb9b](https://github.com/remidej/camox/commit/26fcb9b6044c86fcdf0e697ec7e89deb122ab534))

## [0.53.0](https://github.com/remidej/camox/compare/camox-v0.52.3...camox-v0.53.0) (2026-10-26)


### Features

* **api:** search the web with Exa instead of Ceramic ([b3f5d1b](https://github.com/remidej/camox/commit/b3f5d1b9119674279092897541062c674e6c02a4))
* **sdk:** list the Canvas navigator's Pages without a search ([be96c92](https://github.com/remidej/camox/commit/be96c92be7a57cec3e305373a5f1ca160bd2ad19))
* **sdk:** navigate the Canvas sidebar as a stack of views ([c7a934b](https://github.com/remidej/camox/commit/c7a934bac879ac6ec87e7d656d7fc8eee2ad4a00))
* **sdk:** set the Canvas and sidebars into the studio as rounded cards ([16e2520](https://github.com/remidej/camox/commit/16e2520fe5cd6ea1947a582e61dc5249639f91ab))
* **sdk:** show SEO and Markdown for singleton and derived pages ([#596](https://github.com/remidej/camox/issues/596)) ([4bdb249](https://github.com/remidej/camox/commit/4bdb249e8fc0a6c89acf22b446e0db9590c0421e))
* **sdk:** span the Canvas across the studio, under its sidebars ([557c6a2](https://github.com/remidej/camox/commit/557c6a29e8eb3063157c9e74f8dd904dff2fce69))


### Performance Improvements

* **api:** let project rooms hibernate between broadcasts ([2b6e815](https://github.com/remidej/camox/commit/2b6e81508f132213c2672fb08a1abf29b792fe39))

## [0.52.3](https://github.com/remidej/camox/compare/camox-v0.52.2...camox-v0.52.3) (2026-10-25)


### Bug Fixes

* **api:** build revisions over the sandbox's RPC transport ([#591](https://github.com/remidej/camox/issues/591)) ([a5d4663](https://github.com/remidej/camox/commit/a5d466396804aae64f85ebd301d48b9c6618aa78))

## [0.52.2](https://github.com/remidej/camox/compare/camox-v0.52.1...camox-v0.52.2) (2026-10-25)


### Bug Fixes

* **api:** keep an upgrade's updated package.json and lockfile across its steps ([#589](https://github.com/remidej/camox/issues/589)) ([adb8846](https://github.com/remidej/camox/commit/adb88460e4cbfd33d804c0e7dfdba4d29bf4d1e2))

## [0.52.1](https://github.com/remidej/camox/compare/camox-v0.52.0...camox-v0.52.1) (2026-10-24)


### Bug Fixes

* **dispatch:** stop using Promise.try, missing from Node 22 ([#586](https://github.com/remidej/camox/issues/586)) ([c33e3a7](https://github.com/remidej/camox/commit/c33e3a738a0f5742bb412cf2a1ec8151584dc06c))
* **sdk:** keep public renders in a named cache, not caches.default ([#588](https://github.com/remidej/camox/issues/588)) ([7825ff9](https://github.com/remidej/camox/commit/7825ff9099b29ec01ccd910697f33b45f4ad26fd))

## [0.52.0](https://github.com/remidej/camox/compare/camox-v0.51.0...camox-v0.52.0) (2026-10-24)


### Features

* the agent changes a website's code in a draft ([#584](https://github.com/remidej/camox/issues/584)) ([b129ef3](https://github.com/remidej/camox/commit/b129ef321870cfc755df95bdcb0fe754d085d598))

## [0.51.0](https://github.com/remidej/camox/compare/camox-v0.50.0...camox-v0.51.0) (2026-10-23)


### Features

* move Project Settings into the studio and make dashboard cards open the website ([#549](https://github.com/remidej/camox/issues/549)) ([58d24b8](https://github.com/remidej/camox/commit/58d24b80bfa04324de4a8b309d68b5ca6cd65ae3))


### Performance Improvements

* **api-contract:** move the router types to a router entry ([#559](https://github.com/remidej/camox/issues/559)) ([a829969](https://github.com/remidej/camox/commit/a829969b3ed2d02074d53892389d74054527c276))


### Documentation

* **adr:** confirm one build serves under any URL prefix ([cecf35e](https://github.com/remidej/camox/commit/cecf35e35e2a4a39bae11895fb993bee57c0ba8a))
* **adr:** leave a revision each time the agent builds ([e7de9a1](https://github.com/remidej/camox/commit/e7de9a108f35cafbcfa1ba9bb44ad3c201c27f7d))
* allow outbound requests and move agent guards into the build ([6c553ef](https://github.com/remidej/camox/commit/6c553ef0802ef58263939ac1aac1bf5050e4703a))
* decide publishing deploys the last revision's build ([ca49a87](https://github.com/remidej/camox/commit/ca49a87d4cec4cab96e3a59ffd3f2f99eb5aeddb))
* decide the smallest preview of an agent-changed block ([98ee85c](https://github.com/remidej/camox/commit/98ee85c036a949e3f3a104da5bc4cfc01627508a))
* decide what happens when main moves under a draft ([5dc06a0](https://github.com/remidej/camox/commit/5dc06a0cc263e82f8fabee2e69d6f4b08c6c351b))
* **glossary:** add the Settings Section, narrow the Dashboard ([e4de7df](https://github.com/remidej/camox/commit/e4de7df23791e8c746b3dcebd98284054d97e2e8))

## [0.50.0](https://github.com/remidej/camox/compare/camox-v0.49.0...camox-v0.50.0) (2026-10-23)


### Features

* cache public renders, files and hashed assets at the edge ([#540](https://github.com/remidej/camox/issues/540)) ([2c648e0](https://github.com/remidej/camox/commit/2c648e0d57f8980f1e8e9c529eae930e240b1634))


### Performance Improvements

* fewer sequential API calls and D1 round trips for public page reads ([#539](https://github.com/remidej/camox/issues/539)) ([48dabe2](https://github.com/remidej/camox/commit/48dabe2023c18f8962062efbb09bc1d94e192c37))

## [0.49.0](https://github.com/remidej/camox/compare/camox-v0.48.0...camox-v0.49.0) (2026-10-23)


### ⚠ BREAKING CHANGES

* the SDK and CLI default to api.camox.ai and app.camox.ai.
* **api:** definition sets with label, or reference fields with labelField, are rejected. SDKs older than 0.48.0 can't sync collections.

### Features

* **api:** stop accepting label in collection definitions ([#513](https://github.com/remidej/camox/issues/513)) ([b568638](https://github.com/remidej/camox/commit/b568638e6b2998d0c8984143c9c4169060d52318)), closes [#508](https://github.com/remidej/camox/issues/508)
* draft overview and problem cards in the review sheet ([#534](https://github.com/remidej/camox/issues/534)) ([65f8126](https://github.com/remidej/camox/commit/65f8126a21505f0c39bc0fa4af68435f6b097fe1))
* move Camox from camox.dev to camox.ai ([#524](https://github.com/remidej/camox/issues/524)) ([8f276b1](https://github.com/remidej/camox/commit/8f276b1cd35ae48a95c9e35808ebf1c10f46d19d))


### Bug Fixes

* **sdk:** log one line per definitions sync ([#523](https://github.com/remidej/camox/issues/523)) ([7ddf748](https://github.com/remidej/camox/commit/7ddf74814e1b629a5898c0d447900ebff3ecdee1))


### Refactoring

* **sdk:** handle shortcuts with TanStack Hotkeys ([#535](https://github.com/remidej/camox/issues/535)) ([f8788e9](https://github.com/remidej/camox/commit/f8788e9008b510d4d20fa31000492a3d5eb666e7))


### Documentation

* **api:** alerts@camox.ai is forwarded by Email Routing ([#525](https://github.com/remidej/camox/issues/525)) ([5a87002](https://github.com/remidej/camox/commit/5a87002471e839a8dcbaca12213888b5930cf479))
* record that drafts carry code ([edaabb7](https://github.com/remidej/camox/commit/edaabb7ac11b9a197fc55199d8db7afae0d8d2d7))
* record what code the agent may change ([cd2a433](https://github.com/remidej/camox/commit/cd2a4334ef548820f08a221073b2cc0a7632f099))

## [0.48.0](https://github.com/remidej/camox/compare/camox-v0.47.0...camox-v0.48.0) (2026-10-22)


### ⚠ BREAKING CHANGES

* the old option names are type errors with no runtime path left, and definitions without the required titles fail to type-check.

### Features

* **sdk:** show the chat only beside the Canvas, with wider sidebars ([#511](https://github.com/remidej/camox/issues/511)) ([d68917f](https://github.com/remidej/camox/commit/d68917f9391b9d56c561937dc1db4f94345b6ea1))
* structured data and the to* definition API ([#509](https://github.com/remidej/camox/issues/509)) ([20be067](https://github.com/remidej/camox/commit/20be0673e8490c190c6b4037f610c86115dd2153))

## [0.47.0](https://github.com/remidej/camox/compare/camox-v0.46.0...camox-v0.47.0) (2026-10-22)


### Features

* **api:** let the agent search and read the web ([#488](https://github.com/remidej/camox/issues/488)) ([c15d338](https://github.com/remidej/camox/commit/c15d338748631246c7f2ebf266a27c18d2628ae8))
* **sdk:** sign in from the show-canvas shortcut when signed out ([#490](https://github.com/remidej/camox/issues/490)) ([c040fdd](https://github.com/remidej/camox/commit/c040fdd78a464ffcf4747811950d7f9eb0715fbb))
* **sdk:** snap the Canvas camera from a window of zoom and position ([#493](https://github.com/remidej/camox/issues/493)) ([63d51b8](https://github.com/remidej/camox/commit/63d51b88a367992fbd10b777b99f8bc7b5ae2789))


### Bug Fixes

* **sdk:** keep a zoomed-out Canvas camera in place as pages resize ([#491](https://github.com/remidej/camox/issues/491)) ([e4135a3](https://github.com/remidej/camox/commit/e4135a341b11ac57232d1d9d6df09b6b97f3b52c))


### Documentation

* drop Component and Label from the glossary ([fada671](https://github.com/remidej/camox/commit/fada6718c5e901730ebc91117b2120c6023d0def))

## [0.46.0](https://github.com/remidej/camox/compare/camox-v0.45.0...camox-v0.46.0) (2026-10-22)


### ⚠ BREAKING CHANGES

* **api:** sites on an older SDK still ask for ?placeholder=camox and get a 404, so they show the browser's blank icon until upgraded.

### Features

* **canvas:** show only pages on the Canvas ([#481](https://github.com/remidej/camox/issues/481)) ([ecf3cd4](https://github.com/remidej/camox/commit/ecf3cd4744eb1abc25f1ed8a742886655fb3c09e))
* **sdk:** open the block picker in a side sheet ([#487](https://github.com/remidej/camox/issues/487)) ([657c6cb](https://github.com/remidej/camox/commit/657c6cb05bf404661d7b456f46d90284625b9e30))


### Bug Fixes

* **api:** set up projects from a Template with symlinks, and retry a failed setup ([#483](https://github.com/remidej/camox/issues/483)) ([c9c9787](https://github.com/remidej/camox/commit/c9c97871d6a83375c19c8401a09b21217f6ce894))
* **canvas:** show a selected Page's frame in its own place in the row ([#486](https://github.com/remidej/camox/issues/486)) ([3d75f32](https://github.com/remidej/camox/commit/3d75f32c0ddf172600dec8f3420704ad0cb4a3cc))
* **sdk:** stop the studio sign-in redirect loop on deployed sites ([#485](https://github.com/remidej/camox/issues/485)) ([ac0081f](https://github.com/remidej/camox/commit/ac0081f2fe7f7a2f7ee00cd95b42f0a750ca1e72))


### Refactoring

* **api:** outline the default favicon and stop calling it a placeholder ([#484](https://github.com/remidej/camox/issues/484)) ([bf3faaf](https://github.com/remidej/camox/commit/bf3faafbd43e7befcd64031a21938a20708f1db7))

## [0.45.0](https://github.com/remidej/camox/compare/camox-v0.44.0...camox-v0.45.0) (2026-10-22)


### ⚠ BREAKING CHANGES

* older CLIs and SDK dev servers can't create preview sign-in links (`/one-time-token/generate` is removed).
* **api:** inputs that named a project by `projectSlug` are rejected with BAD_REQUEST. SDKs older than the one sending Project IDs ([#461](https://github.com/remidej/camox/issues/461)) can no longer sync definitions or render pages.
* camox({ projectSlug }) must become camox({ projectId }) with the Project ID shown in the Camox dashboard. Requires the API from #457.
* SDKs calling the six removed procedures stop syncing definitions. Deploy the API before publishing the SDK that calls definitions.sync.
* remove comments ([#298](https://github.com/remidej/camox/issues/298))

### Features

* **ai-tools:** declare every tool's output ([#413](https://github.com/remidej/camox/issues/413)) ([4b2923c](https://github.com/remidej/camox/commit/4b2923cabe1bb6bda33c776428460f8c8a445f2f))
* **ai-tools:** offer tools per surface instead of by risk ([#415](https://github.com/remidej/camox/issues/415)) ([b069721](https://github.com/remidej/camox/commit/b06972146474a3131c0622bae23306cfcb5dd5ae))
* **api:** add and remove locales ([#366](https://github.com/remidej/camox/issues/366)) ([3c94915](https://github.com/remidej/camox/commit/3c94915db27c12cbc8145c7baafb4f2b59bfe6b1))
* **api:** conform content to its definitions on read ([#254](https://github.com/remidej/camox/issues/254)) ([e0b47e1](https://github.com/remidej/camox/commit/e0b47e1604ab494eae8c9b3e6d8e30045443ef3e))
* **api:** email an alert when a release fails ([#466](https://github.com/remidej/camox/issues/466)) ([a3e3a29](https://github.com/remidej/camox/commit/a3e3a292ad16df6e909a19a5c422dfd09f5014bd)), closes [#448](https://github.com/remidej/camox/issues/448)
* **api:** end threads with their drafts ([#424](https://github.com/remidej/camox/issues/424)) ([801955c](https://github.com/remidej/camox/commit/801955ce27418a2a1bafcc4525182b8aa2430741))
* **api:** generate values per locale ([#375](https://github.com/remidej/camox/issues/375)) ([96955d0](https://github.com/remidej/camox/commit/96955d0935d8fcbf288781e67b17da1cf072c8a0))
* **api:** identify definitions by their names ([#255](https://github.com/remidej/camox/issues/255)) ([0024c88](https://github.com/remidej/camox/commit/0024c8870a64fd2f67b5cb461bd9fdd6c7ad021b))
* **api:** keep hand edits to localizations through source changes ([#380](https://github.com/remidej/camox/issues/380)) ([4c43d94](https://github.com/remidej/camox/commit/4c43d944b2a79c73953f082c69fece6036afb857))
* **api:** key content by locale ([#363](https://github.com/remidej/camox/issues/363)) ([9f11740](https://github.com/remidej/camox/commit/9f117404c9fab091a05fa39905c365e5d3cecc04))
* **api:** let localizations diverge in structure ([#388](https://github.com/remidej/camox/issues/388)) ([c9e1ece](https://github.com/remidej/camox/commit/c9e1ece3a8d4e9fb47955c05c967dbf51a65dabc))
* **api:** let the agent read the website through code mode ([#416](https://github.com/remidej/camox/issues/416)) ([2e6a09a](https://github.com/remidej/camox/commit/2e6a09a6599311049b8533c3320fa623a67be7b9))
* **api:** name projects only by Project ID, ending the slug bridge ([#463](https://github.com/remidej/camox/issues/463)) ([b700f0b](https://github.com/remidej/camox/commit/b700f0b3502d70741c7f342094ae710a4e14074e))
* **api:** optimize short videos at source resolution ([2436b6a](https://github.com/remidej/camox/commit/2436b6a0d96a15af72633897ec8a3204705d9ffb))
* **api:** release a project on every push to main ([#465](https://github.com/remidej/camox/issues/465)) ([d2c4ed8](https://github.com/remidej/camox/commit/d2c4ed872840a1ea1cc506839347d373c610acc0)), closes [#447](https://github.com/remidej/camox/issues/447)
* **api:** store a synced block's shared content as one entity ([#261](https://github.com/remidej/camox/issues/261)) ([4f48652](https://github.com/remidej/camox/commit/4f4865294750069177f94b54887aca0d347cac53))
* **api:** translate the default locale into every locale ([#376](https://github.com/remidej/camox/issues/376)) ([bec1b50](https://github.com/remidej/camox/commit/bec1b503ceec42c76596b117d83d20ebce5aa890))
* **api:** translate the defaults of blocks placed in a locale ([#378](https://github.com/remidej/camox/issues/378)) ([24b06fb](https://github.com/remidej/camox/commit/24b06fbc3b6b26a4bf4666bf0919ef1ce1685208))
* **api:** translate the way the website's audience writes ([#399](https://github.com/remidej/camox/issues/399)) ([5aa682a](https://github.com/remidej/camox/commit/5aa682ae643f10ef5994771b891fdc0303331473))
* **art:** add the new chamois logo and a brand book that generates every asset ([#222](https://github.com/remidej/camox/issues/222)) ([472df8f](https://github.com/remidej/camox/commit/472df8fb5c4e2b023bd17d701b6929af5c7bf41a))
* artifacts in the studio and AI features ([#178](https://github.com/remidej/camox/issues/178)) ([27c789d](https://github.com/remidej/camox/commit/27c789d6a07c019790d2e68ba46d6f9ff9698087))
* block publishing on duplicate paths, broken references and wrong-kind values ([#270](https://github.com/remidej/camox/issues/270)) ([54e7ff8](https://github.com/remidej/camox/commit/54e7ff857809836a46b223b95f2a5fca008ae386))
* **canvas:** add the Block Catalog shelf with live block frames ([#158](https://github.com/remidej/camox/issues/158)) ([8052aa2](https://github.com/remidej/camox/commit/8052aa2b9f7a48e793d39f74b9ce3cdcba45fe59))
* **canvas:** keep the sidebars mounted and add a Canvas navigator ([#221](https://github.com/remidej/camox/issues/221)) ([09ceb66](https://github.com/remidej/camox/commit/09ceb66bac6bad179bdb6d504acd909e18dc30f7))
* **canvas:** lay out the Canvas as typed items with a Pages Shelf Marker ([#155](https://github.com/remidej/camox/issues/155)) ([f151dbb](https://github.com/remidej/camox/commit/f151dbbe7744f08109e5a48dfb84805dbf6aa233))
* **canvas:** overlay the sidebars and deselect into /camox/canvas ([#209](https://github.com/remidej/camox/issues/209)) ([956160a](https://github.com/remidej/camox/commit/956160ac9504a8e27a037683a10ed3ff56669def))
* **canvas:** select Block Catalog blocks at /camox/blocks/&lt;id&gt; ([#168](https://github.com/remidej/camox/issues/168)) ([c322da0](https://github.com/remidej/camox/commit/c322da0f791ac72e5ec5ffd8e68ee12ad246446d)), closes [#151](https://github.com/remidej/camox/issues/151)
* **canvas:** show block sidebars when a Block Catalog block is selected ([#169](https://github.com/remidej/camox/issues/169)) ([2aec70c](https://github.com/remidej/camox/commit/2aec70cfac3ed6b1b68e4e3d05589d3f52f83d97))
* **canvas:** show block usage in the Block Catalog ([#167](https://github.com/remidej/camox/issues/167)) ([a0e3d78](https://github.com/remidej/camox/commit/a0e3d786124f5ada7e19f61b5302456e16e77bc6)), closes [#152](https://github.com/remidej/camox/issues/152)
* **canvas:** show Synced Blocks' shared content in the Block Catalog ([#170](https://github.com/remidej/camox/issues/170)) ([ce154f5](https://github.com/remidej/camox/commit/ce154f5e5496d7b4fea3f6c5def6a7a4c999006c))
* **canvas:** Space + drag to pan, earlier Page snapping, and stop swipe history navigation ([#156](https://github.com/remidej/camox/issues/156)) ([38e9df2](https://github.com/remidej/camox/commit/38e9df2a5284e927b72a2d1e1aa6e2aebe8cce21))
* change content from a draft's shared thread ([#418](https://github.com/remidej/camox/issues/418)) ([5bc555b](https://github.com/remidej/camox/commit/5bc555b55a060dbd5dc7a55159529119236a95f6))
* chat with the agent on Live ([#414](https://github.com/remidej/camox/issues/414)) ([5575471](https://github.com/remidej/camox/commit/557547172f46c9a85a51ac6d94d65717eef71d9b))
* **cli:** expose layout-owned block discovery ([975bf9a](https://github.com/remidej/camox/commit/975bf9a8056810272f24864ade2b87fbaf148418))
* **cli:** refresh the Template in Cloudflare Artifacts on every SDK publish ([#464](https://github.com/remidej/camox/issues/464)) ([322d33d](https://github.com/remidej/camox/commit/322d33d184753c750e1a8d196b087133dcae4eb4))
* **cli:** set string fields from files with --field-file ([#174](https://github.com/remidej/camox/issues/174)) ([3b302ba](https://github.com/remidej/camox/commit/3b302ba37115561320049b72cddf6447ce698c48))
* collection records and references in drafts ([#268](https://github.com/remidej/camox/issues/268)) ([292dd7f](https://github.com/remidej/camox/commit/292dd7ff45925fc2fdf221440a18adf21e3579c6)), closes [#239](https://github.com/remidej/camox/issues/239)
* **collections:** add definitions and record lifecycle ([b3c36fc](https://github.com/remidej/camox/commit/b3c36fcc4490b0f160b6394b069866ab321af4f7))
* **collections:** add item authoring with media library assets ([0017fcc](https://github.com/remidej/camox/commit/0017fccc67a3870df4405a560cc99490c3d0cee2))
* **collections:** add standalone record publication and AI tools ([84c9e20](https://github.com/remidej/camox/commit/84c9e202ee678d254f314081034e5423296959cb))
* **collections:** make collection records plain content ([#257](https://github.com/remidej/camox/issues/257)) ([58a629a](https://github.com/remidej/camox/commit/58a629a20dfdda91116a6a8ef7d2668e98ea3e18))
* **collections:** support single references and additive schemas ([853ff52](https://github.com/remidej/camox/commit/853ff5297abce35eaa28675345cbe10d2aaa1db0))
* comments in drafts ([#267](https://github.com/remidej/camox/issues/267)) ([cdf6327](https://github.com/remidej/camox/commit/cdf6327c1105331b9b8a1715ff042867eb060879)), closes [#241](https://github.com/remidej/camox/issues/241)
* **content:** add experimental collection browsing and item forms ([6c211bb](https://github.com/remidej/camox/commit/6c211bb51ed661b16202c93b751c6185730298d6))
* development drafts replace development environments ([#274](https://github.com/remidej/camox/issues/274)) ([e1f8a07](https://github.com/remidej/camox/commit/e1f8a07c69b594d7b9ccb455e8e20d615c015ba6)), closes [#246](https://github.com/remidej/camox/issues/246)
* **dev:** isolate worktree sessions and open playground sign-in ([e5615b6](https://github.com/remidej/camox/commit/e5615b64c679404cd9ba0f360e5aa3e1df4c1f4f))
* discover the pages of derived layouts ([#176](https://github.com/remidej/camox/issues/176)) ([7ba7b7c](https://github.com/remidej/camox/commit/7ba7b7c959c0c0e352ac8afab025198bd595c87c))
* discover the pages of record layouts ([#206](https://github.com/remidej/camox/issues/206)) ([0475948](https://github.com/remidej/camox/commit/047594888f3bdb0a5f6173eaf602dd03edf6ca0a))
* **dispatch:** serve projects' websites at &lt;slug&gt;.camox.site through a dispatch Worker ([#455](https://github.com/remidej/camox/issues/455)) ([483a01e](https://github.com/remidej/camox/commit/483a01e446e823c045cf6e2b37db60e1d23c6efe))
* drafts v1 ([e6473b2](https://github.com/remidej/camox/commit/e6473b2ffd21e7ba3a404a03c6a73dccae136876))
* edit a record in place on its record page ([#210](https://github.com/remidej/camox/issues/210)) ([3671b73](https://github.com/remidej/camox/commit/3671b738da03e43494355533e78388544df2f5d0)), closes [#190](https://github.com/remidej/camox/issues/190)
* edit blocks in a draft while Live stays unchanged ([#262](https://github.com/remidej/camox/issues/262)) ([4ea5fcd](https://github.com/remidej/camox/commit/4ea5fcda4eef980a6e43f1f133370618d783ce84))
* files in drafts ([#271](https://github.com/remidej/camox/issues/271)) ([b38b21f](https://github.com/remidej/camox/commit/b38b21f56b67451f69237e8b92f1e8cc5590b550)), closes [#240](https://github.com/remidej/camox/issues/240)
* follow the agent's changes on the Canvas ([#433](https://github.com/remidej/camox/issues/433)) ([94940c2](https://github.com/remidej/camox/commit/94940c27828524273e76fa18d87909ae80df95ac))
* generated values sit beside content ([#272](https://github.com/remidej/camox/issues/272)) ([81cb4da](https://github.com/remidej/camox/commit/81cb4da1330ccb25784e3ec3587d8feaba7cd130)), closes [#244](https://github.com/remidej/camox/issues/244)
* hand studio sessions only to a member's project hosts ([#467](https://github.com/remidej/camox/issues/467)) ([f89a8ca](https://github.com/remidej/camox/commit/f89a8ca19c4453738d783a65e4f88a7563624ec4))
* hosted projects for marketing teams (rest of [#444](https://github.com/remidej/camox/issues/444)) ([#469](https://github.com/remidej/camox/issues/469)) ([f33cc9c](https://github.com/remidej/camox/commit/f33cc9c28bc88531277db3d7ed12dd5e48bed471))
* identify files, collection records and comments by UUIDv7 ([#253](https://github.com/remidej/camox/issues/253)) ([2efc5da](https://github.com/remidej/camox/commit/2efc5da7a6c56e6bc3428d954684fb23f36d1b80))
* identify pages, blocks and repeatable items by UUIDv7 ([#260](https://github.com/remidej/camox/issues/260)) ([ee3a8c9](https://github.com/remidej/camox/commit/ee3a8c90af9bd5d79803c53cc5c4dc8b17fe56cb))
* identify projects by a permanent Project ID instead of their slug ([#461](https://github.com/remidej/camox/issues/461)) ([d83992a](https://github.com/remidej/camox/commit/d83992afa7e73a2b8cbfb55255e107d7b1b0e44a))
* **landing:** illustrate features with artifacts and pause motion in the Canvas ([#284](https://github.com/remidej/camox/issues/284)) ([2d4d1f6](https://github.com/remidej/camox/commit/2d4d1f621a811ecd578e80b690e80645b3a6bfe1))
* layout Markdown and metadata for singleton and derived pages ([#179](https://github.com/remidej/camox/issues/179)) ([eb4a89c](https://github.com/remidej/camox/commit/eb4a89c0e5e6fec2334c97e577442030e5031e4b))
* links and references resolve per locale ([#393](https://github.com/remidej/camox/issues/393)) ([8cf7a55](https://github.com/remidej/camox/commit/8cf7a55266eab0352994ac98078487346fa4aa9c))
* make Live read-only ([#273](https://github.com/remidej/camox/issues/273)) ([4ff0e5e](https://github.com/remidej/camox/commit/4ff0e5ec4f1475daf0eff8a7e170c9aba9e8c0e9)), closes [#245](https://github.com/remidej/camox/issues/245)
* manual reference lists ([#137](https://github.com/remidej/camox/issues/137)) ([9b4714d](https://github.com/remidej/camox/commit/9b4714d02a675bef97f2c831a3ae4b259277fc43))
* migrate landing's Live with a rehearsed script ([#276](https://github.com/remidej/camox/issues/276)) ([e560dd5](https://github.com/remidej/camox/commit/e560dd5a38a3481a21a4697d06fb75898fd8bd3e)), closes [#249](https://github.com/remidej/camox/issues/249)
* navigation and realtime follow the selected draft ([#263](https://github.com/remidej/camox/issues/263)) ([4cbf39f](https://github.com/remidej/camox/commit/4cbf39feedda355995e10b177468f5a868f7c1b0)), closes [#237](https://github.com/remidej/camox/issues/237)
* pages, repeatable items and synced content in drafts ([#269](https://github.com/remidej/camox/issues/269)) ([af252a6](https://github.com/remidej/camox/commit/af252a6603ebdde401a23b071e5f7aec1f7f37c4)), closes [#238](https://github.com/remidej/camox/issues/238)
* **playground:** seed demo articles automatically in dev ([#146](https://github.com/remidej/camox/issues/146)) ([37cc0e0](https://github.com/remidej/camox/commit/37cc0e0aa3b834b3ffabe4bb9aeb9508fd55c28a))
* **playground:** show a dotted globe artifact in the hero ([11b9cce](https://github.com/remidej/camox/commit/11b9cce4e0802637b3de17e14519dbc48f14e596))
* PostHog as a second analytics provider ([#391](https://github.com/remidej/camox/issues/391)) ([c55dcfe](https://github.com/remidej/camox/commit/c55dcfe6793427a1c20b5d1d8b8dbadde19c036a))
* publish a record from its record page ([#207](https://github.com/remidej/camox/issues/207)) ([bdb28e0](https://github.com/remidej/camox/commit/bdb28e03907d69b74dafa4b0888b750afb3a07b9)), closes [#189](https://github.com/remidej/camox/issues/189)
* publish every locale together ([#387](https://github.com/remidej/camox/issues/387)) ([d0ea50f](https://github.com/remidej/camox/commit/d0ea50fc324f86fd6fe558d9ef36b63686e83913))
* publish from the CLI and AI tools, and remove environments ([#275](https://github.com/remidej/camox/issues/275)) ([eb8369b](https://github.com/remidej/camox/commit/eb8369bd433b32cd31ad5f283aed691871e6b395)), closes [#248](https://github.com/remidej/camox/issues/248)
* publish or discard a draft ([#264](https://github.com/remidej/camox/issues/264)) ([1698b1f](https://github.com/remidej/camox/commit/1698b1f53fe2dc8d19cde57fd9c5a6ff9b01c387)), closes [#236](https://github.com/remidej/camox/issues/236)
* query-backed reference lists ([#145](https://github.com/remidej/camox/issues/145)) ([d4aefd9](https://github.com/remidej/camox/commit/d4aefd99e580d58b1df7d449eb92f9cd2ad14ab1))
* references between collections ([#141](https://github.com/remidej/camox/issues/141)) ([7c4a36b](https://github.com/remidej/camox/commit/7c4a36b17711fd26b85c79b1b3612e8bc72cf8df))
* references in repeatable items ([#140](https://github.com/remidej/camox/issues/140)) ([c416ea2](https://github.com/remidej/camox/commit/c416ea29347abb9e9c561b63ab85229b1dd4c326))
* releases write Live ([#265](https://github.com/remidej/camox/issues/265)) ([75b9bcc](https://github.com/remidej/camox/commit/75b9bcc3e8a39fedb49550aa0c61a387ed42b86e)), closes [#247](https://github.com/remidej/camox/issues/247)
* remove comments ([#298](https://github.com/remidej/camox/issues/298)) ([400b1d9](https://github.com/remidej/camox/commit/400b1d995f4bf88cea175a3684e11c3f3a89fc5d))
* render a collection record from its URL with collection.pages() ([#205](https://github.com/remidej/camox/issues/205)) ([a5823ca](https://github.com/remidej/camox/commit/a5823ca5d12e37826c50bdbaff525ba4a6114f6f))
* render a record page's record through a read-only layout.Item ([#208](https://github.com/remidej/camox/issues/208)) ([9fc8e20](https://github.com/remidej/camox/commit/9fc8e2064343777794e6eeb038b1f02a409e3c94))
* **sdk:** add camox-expand skill ([#171](https://github.com/remidej/camox/issues/171)) ([30738e8](https://github.com/remidej/camox/commit/30738e8a9a98a3b17d5a818c9da098731b0ea8b2))
* **sdk:** add context-specific field builders ([#138](https://github.com/remidej/camox/issues/138)) ([5fd2c0a](https://github.com/remidej/camox/commit/5fd2c0aa4fd2fe87f23e92c4141971df7c5bb6e3))
* **sdk:** add experimental multi-page canvas ([c953e0f](https://github.com/remidej/camox/commit/c953e0fa14fa0ef425d9f400772c12492d29b864))
* **sdk:** add page hover overlays ([#123](https://github.com/remidej/camox/issues/123)) ([0e6e275](https://github.com/remidej/camox/commit/0e6e275ad3969da19a0c5227de3dbc7969317fdb))
* **sdk:** add URL-selected canvas pages and shared sidebars ([d55d468](https://github.com/remidej/camox/commit/d55d4688886a0073c1f171d253cb62360834b4ab))
* **sdk:** animate canvas navigation with smooth camera flights ([97a18a3](https://github.com/remidej/camox/commit/97a18a359aa793f51a1bb8574b187d335225d0d0))
* **sdk:** center tablet and mobile frames in shaded Canvas areas ([#338](https://github.com/remidej/camox/issues/338)) ([ad54bbd](https://github.com/remidej/camox/commit/ad54bbd8488df2ae6ceb432365f8935dab69e1fd))
* **sdk:** collapse a selected page's blocks in the canvas sidebar ([#291](https://github.com/remidej/camox/issues/291)) ([4cb5a18](https://github.com/remidej/camox/commit/4cb5a18ca09be950b880c4c98b7885922d43b642))
* **sdk:** count visitors in Google Analytics 4 on the first page load ([#379](https://github.com/remidej/camox/issues/379)) ([76a61c5](https://github.com/remidej/camox/commit/76a61c556c5b90d0427a319c1bb89b6627a58a5b))
* **sdk:** dedicate the right sidebar to chat and feedback ([#283](https://github.com/remidej/camox/issues/283)) ([8fe5f43](https://github.com/remidej/camox/commit/8fe5f43c0a7752950af97cebcf27f55ac3816e53))
* **sdk:** delete and create pages from the canvas sidebars ([#294](https://github.com/remidej/camox/issues/294)) ([f477a94](https://github.com/remidej/camox/commit/f477a948a50ca905eb833de1e4ddbf58e94e9d0f))
* **sdk:** edit collection items in modals ([de60791](https://github.com/remidej/camox/commit/de607911d1913a82ff7d83dbc0d499aa9fe79d16))
* **sdk:** edit referenced collection records in the sidebar and preview ([#131](https://github.com/remidej/camox/issues/131)) ([04dba27](https://github.com/remidej/camox/commit/04dba2711ae10c2fda387d052e245823d993f1a2))
* **sdk:** enable feedback by default ([26ee749](https://github.com/remidej/camox/commit/26ee749f00e51cf57b1e4dabd13b38850a57825e))
* **sdk:** enable interactive canvas editing ([9496b27](https://github.com/remidej/camox/commit/9496b273154f2743dadf4c8bc2f932435433c770))
* **sdk:** extend canvas comment indicators to all page targets ([b8f0bbc](https://github.com/remidej/camox/commit/b8f0bbc294e458c737d1fd6bc8069069ec394200))
* **sdk:** fit the chat to its narrow sidebar and tidy studio controls ([#426](https://github.com/remidej/camox/issues/426)) ([b3e91cd](https://github.com/remidej/camox/commit/b3e91cd8e74f2eda79aa55e61af644888698c2e2))
* **sdk:** give artifacts scroll progress, content height and navigation ([#180](https://github.com/remidej/camox/issues/180)) ([bbbd515](https://github.com/remidej/camox/commit/bbbd515e7988834b30d5aea49290dd5efaf17f22))
* **sdk:** hreflang, sitemap alternates and a language switcher ([#394](https://github.com/remidej/camox/issues/394)) ([eb46db3](https://github.com/remidej/camox/commit/eb46db3589e481e45c22910814f4757e39536465))
* **sdk:** inject the camox runtime into artifacts and expose camox.studio ([#177](https://github.com/remidej/camox/issues/177)) ([d8df07c](https://github.com/remidej/camox/commit/d8df07ccee7ad4cc1e98d14208ee7d0ba80c31f5))
* **sdk:** keep canvas state across sections, drafts and locales ([#400](https://github.com/remidej/camox/issues/400)) ([85b146b](https://github.com/remidej/camox/commit/85b146b84b131163cc8b81ce8630b027d6cf2970))
* **sdk:** keep the page mounted across Edit Mode, and speed up the Canvas ([#293](https://github.com/remidej/camox/issues/293)) ([7a263c7](https://github.com/remidej/camox/commit/7a263c781a61698f79fc1d180eae1abd83932a6e))
* **sdk:** link and serve each page's Markdown Representation at a .md URL ([#285](https://github.com/remidej/camox/issues/285)) ([593a684](https://github.com/remidej/camox/commit/593a6843a49a1c7111442c6de98a4341e2659aab))
* **sdk:** make a Canvas selection always mean a snapped camera ([#328](https://github.com/remidej/camox/issues/328)) ([c65f2eb](https://github.com/remidej/camox/commit/c65f2ebec9ee5da33a0959d44ff32b6b06e7d5a4))
* **sdk:** move live site control to navbar ([621fb2c](https://github.com/remidej/camox/commit/621fb2c7b88bcb8822a7457edcb2bb94e0ee71e7))
* **sdk:** move preview overlays into the canvas ([284579d](https://github.com/remidej/camox/commit/284579d0c303265423979942d2ae4bc3b77fa160))
* **sdk:** move the command palette into the user menu ([#392](https://github.com/remidej/camox/issues/392)) ([97313fc](https://github.com/remidej/camox/commit/97313fc74d29b10535a49981cb2d9473889547cc))
* **sdk:** offer drafts actions in the command palette ([#289](https://github.com/remidej/camox/issues/289)) ([8f87986](https://github.com/remidej/camox/commit/8f879861bdc1e37d30669f268c4ecd93fae2a7a6))
* **sdk:** only the selected Canvas Page offers visual editing ([#427](https://github.com/remidej/camox/issues/427)) ([b594a20](https://github.com/remidej/camox/commit/b594a20a4087bb3ad2b8217793b30e70b774bf23))
* **sdk:** open canvas comments in inline popovers ([50a3b79](https://github.com/remidej/camox/commit/50a3b795884ce6bc6768e30f0de2b79a9d2417cb))
* **sdk:** open collection item create and edit forms in a side sheet ([#374](https://github.com/remidej/camox/issues/374)) ([5ec5ea3](https://github.com/remidej/camox/commit/5ec5ea3b0c07c5667fb4efb625b0b7e5f68c503e))
* **sdk:** open every page's Markdown with title, description and URL front matter ([#373](https://github.com/remidej/camox/issues/373)) ([36f3c28](https://github.com/remidej/camox/commit/36f3c28e012760d5e80364a6b2d4ba054b08f9d0))
* **sdk:** pass the request's source to loaders and route discovery ([#191](https://github.com/remidej/camox/issues/191)) ([18836be](https://github.com/remidej/camox/commit/18836be48944375bf2fc52fb5527fd6c3c0822ee))
* **sdk:** prefetch the Canvas so the first show skips loading ([#329](https://github.com/remidej/camox/issues/329)) ([57dc5ff](https://github.com/remidej/camox/commit/57dc5ff11feb40183b0b0e0cafb57711b6e112fb))
* **sdk:** print authenticated development links ([20cbdb8](https://github.com/remidej/camox/commit/20cbdb8b77fd948dc5531fe7986a9240fc453f57))
* **sdk:** publish seeded dev content to Live on a fresh database ([#326](https://github.com/remidej/camox/issues/326)) ([c3b2d0a](https://github.com/remidej/camox/commit/c3b2d0a9fb58c10bb1a2e3c003ef5197dd32a873))
* **sdk:** rename any draft from the draft picker, and its name in place in the review ([#442](https://github.com/remidej/camox/issues/442)) ([728ff4c](https://github.com/remidej/camox/commit/728ff4cc2d53945c3d4e20a9262f1be9583157de))
* **sdk:** rename pages from the Canvas sidebar header ([#324](https://github.com/remidej/camox/issues/324)) ([bb8b26c](https://github.com/remidej/camox/commit/bb8b26cca3ac32190511f5ee9bb0fc43cae583e5))
* **sdk:** render an artifact field ([#172](https://github.com/remidej/camox/issues/172)) ([122e7a6](https://github.com/remidej/camox/commit/122e7a62f0be64b60d407a48b1661351caa37594))
* **sdk:** render locales under their prefix and switch locale in the studio ([#372](https://github.com/remidej/camox/issues/372)) ([5f40b8b](https://github.com/remidej/camox/commit/5f40b8bac7f27c895079be5239f83a59b9a42362))
* **sdk:** render themed mountain image placeholders ([ad8cb8f](https://github.com/remidej/camox/commit/ad8cb8f5804a1a365ea4eb05d8224efcb04d238f))
* **sdk:** replace add-block sidebar with a searchable grid dialog ([93ce362](https://github.com/remidej/camox/commit/93ce3624a7b78ea11c8edac749fe13449a38ccbb))
* **sdk:** replace editable preview with canvas ([b0eda62](https://github.com/remidej/camox/commit/b0eda628823a1d8dbbfd1116fe3ab09fa2b6011d))
* **sdk:** restore scroll, prefetch on link intent, and announce client navigations ([#355](https://github.com/remidej/camox/issues/355)) ([1a9abf1](https://github.com/remidej/camox/commit/1a9abf1f80874f1e029e5097e9fcc6e39367874e))
* **sdk:** review drafts and page SEO/markdown in side sheets ([#314](https://github.com/remidej/camox/issues/314)) ([a1a8a8f](https://github.com/remidej/camox/commit/a1a8a8fc411e222506c8f14bcfc29b96cee40fd3))
* **sdk:** run Camox apps on Cloudflare Workers instead of Nitro ([#319](https://github.com/remidej/camox/issues/319)) ([415df45](https://github.com/remidej/camox/commit/415df45a71b8aee057c155782d5c8f82acc869a3))
* **sdk:** send a page view after each client-side navigation ([#390](https://github.com/remidej/camox/issues/390)) ([01b9cbd](https://github.com/remidej/camox/commit/01b9cbd0325f70e5e5b4756ecfe699210d0e3196))
* **sdk:** serve a generated /llms.txt on every Camox website ([#365](https://github.com/remidej/camox/issues/365)) ([400bef6](https://github.com/remidej/camox/commit/400bef65c55f161d7087aa8288f630328f7e5619))
* **sdk:** set the favicon from the studio's project menu ([#287](https://github.com/remidej/camox/issues/287)) ([ba000b9](https://github.com/remidej/camox/commit/ba000b9820d62152819865aa69f19951e09cd03d))
* **sdk:** share sibling fields and settings with artifacts as Artifact Data ([#182](https://github.com/remidej/camox/issues/182)) ([bd765b5](https://github.com/remidej/camox/commit/bd765b5ab73bf87d34e94c9d1da3f0397356df79))
* **sdk:** show field comments on canvas ([a3c2f4b](https://github.com/remidej/camox/commit/a3c2f4bfbe9f0ddd5b802e650e52ecffbe127af9))
* **sdk:** show insertion seam guides ([6772f39](https://github.com/remidej/camox/commit/6772f39b9833f64125cc0a64a95cf13e8c501f02))
* **sdk:** show page paths and collapse blocks in the Canvas navigator ([#323](https://github.com/remidej/camox/issues/323)) ([3cab1f6](https://github.com/remidej/camox/commit/3cab1f6d5494d11988de8d118d35f49cf54cea33))
* **sdk:** show page status badges in canvas ([ac983da](https://github.com/remidej/camox/commit/ac983da6360662f93cb62eb0a6a9ac0391680e48))
* **sdk:** show site publication status in navbar ([8919e3e](https://github.com/remidej/camox/commit/8919e3e358fc749d84ade3032b6599fd60f99209))
* **sdk:** show the chat sidebar on every Studio page but the preview ([#301](https://github.com/remidej/camox/issues/301)) ([4d812d5](https://github.com/remidej/camox/commit/4d812d57b507cd4f5f81e32c2c17145c83a8d86c))
* **sdk:** show whole canvas action with Cmd+Escape shortcut ([#312](https://github.com/remidej/camox/issues/312)) ([c63108b](https://github.com/remidej/camox/commit/c63108bbfeb3cd594c2e0b6654d3d9590cd37584))
* **sdk:** simplify the draft picker label and show it without flashing ([#335](https://github.com/remidej/camox/issues/335)) ([9eb4829](https://github.com/remidej/camox/commit/9eb4829cc651e0fc84b7f7847aada4a54aa6a27b))
* **sdk:** snap canvas zoom to visible pages and assist vertical scrolling ([c1eaffd](https://github.com/remidej/camox/commit/c1eaffdb2b2d487879dfb51143289867d4065756))
* **sdk:** split the drafts control into a draft picker and a pending changes button ([#395](https://github.com/remidej/camox/issues/395)) ([3395795](https://github.com/remidej/camox/commit/339579516f4ac4ed538829d92738d3cc23c63c5e))
* **sdk:** stabilize canvas slots and enable inline page renaming ([35c8b2b](https://github.com/remidej/camox/commit/35c8b2bfc5174fc3282a6a3c9c3cc64496f927c2))
* **sdk:** theme artifacts with the website's tokens and fonts ([#181](https://github.com/remidej/camox/issues/181)) ([eb23606](https://github.com/remidej/camox/commit/eb23606aaa1ffe1ba345758a9e226cbfb00e4b8f))
* **sdk:** track repeatable items with Fragment refs instead of a wrapper div ([#175](https://github.com/remidej/camox/issues/175)) ([b34d7d2](https://github.com/remidej/camox/commit/b34d7d28edf92f5fbaec066a8e18848a33ecd869)), closes [#119](https://github.com/remidej/camox/issues/119)
* **sdk:** tuck page settings behind a checkbox in the page sidebar ([912dc24](https://github.com/remidej/camox/commit/912dc247a676e6da2505719cbd4a716c9f2be731))
* start a draft from a Live thread ([#425](https://github.com/remidej/camox/issues/425)) ([1cf351e](https://github.com/remidej/camox/commit/1cf351e1cb7ae2aacfd7088ab6191b89d506d6f4))
* steer and stop runs, and show failed turns ([#417](https://github.com/remidej/camox/issues/417)) ([24e4072](https://github.com/remidej/camox/commit/24e4072bd0d8cbbf127931d71da7b326f50b3780))
* sync each website's Definition Set from one app module, atomically ([#435](https://github.com/remidej/camox/issues/435)) ([7e149ff](https://github.com/remidej/camox/commit/7e149ffde6f79f7aae88688c3362f60e21291387))
* the drafts control ([#266](https://github.com/remidej/camox/issues/266)) ([59a3597](https://github.com/remidej/camox/commit/59a3597e77404748ad3c339edff396c3bfb9ee64)), closes [#242](https://github.com/remidej/camox/issues/242)
* the Template's own Theme and Components ([#480](https://github.com/remidej/camox/issues/480)) ([106a4f5](https://github.com/remidej/camox/commit/106a4f51b25bda250c69a65436f87f7f5123a85c))
* use the new chamois logo in the dashboard and landing, and a ridgeline footer ([#224](https://github.com/remidej/camox/issues/224)) ([267e826](https://github.com/remidej/camox/commit/267e826e8972fe5025bb8d7ede6b3b4312ff5540))


### Bug Fixes

* add colletions instructions to camoxify skill ([9636d74](https://github.com/remidej/camox/commit/9636d7484c2717c9e216b372d8f5398db167d3f0))
* **api:** enforce JSON schemas before content writes ([d65f58c](https://github.com/remidej/camox/commit/d65f58cfe49ae3ef36615cb458815561f2f786d2)), closes [#122](https://github.com/remidej/camox/issues/122)
* **api:** locate wrangler bin through its package.json ([f655d49](https://github.com/remidej/camox/commit/f655d499707510df2f53f7858ccdd4f1a06293c3))
* **api:** only project members join a project's realtime room ([#437](https://github.com/remidej/camox/issues/437)) ([c375479](https://github.com/remidej/camox/commit/c375479889a0ba1a57ae41bf83929889a0506c4a)), closes [#402](https://github.com/remidej/camox/issues/402)
* **api:** retry AI jobs instead of dropping them on failure ([db4f0c2](https://github.com/remidej/camox/commit/db4f0c252b82f34ab7a93311c3a5f62d85f9b225))
* **api:** validate embed content before writes ([da08a1a](https://github.com/remidej/camox/commit/da08a1a715c4608cd7d5ecac1d75948db3b363a7)), closes [#113](https://github.com/remidej/camox/issues/113)
* **canvas:** change comments count rendering ([c575753](https://github.com/remidej/camox/commit/c57575394f6f2adbf0c2829ce88f11d1a7717ec8))
* **ci:** deploy the dashboard from its built wrangler config ([#282](https://github.com/remidej/camox/issues/282)) ([7965bea](https://github.com/remidej/camox/commit/7965beabf6a2d11679ee0e9d3907ecd724c0c8ea))
* **ci:** type-check workspace packages from source ([#139](https://github.com/remidej/camox/issues/139)) ([40a82d9](https://github.com/remidej/camox/commit/40a82d95005650b016f02e899c1ae08281e54b5f))
* **content:** move assets to a dedicated route ([0b11a62](https://github.com/remidej/camox/commit/0b11a6208f43077c71e93f6584052df5f8dd5928))
* **dashboard:** server-render the org redirect and dashboard data ([#377](https://github.com/remidej/camox/issues/377)) ([346fc00](https://github.com/remidej/camox/commit/346fc00f89d53601dd2276c24bdb7bc3eea9590f))
* **drafts:** address the feat/drafts review findings ([#277](https://github.com/remidej/camox/issues/277)) ([1e46291](https://github.com/remidej/camox/commit/1e462917c3a258dba5e1134c9de3f8ed4fb4104f)), closes [#226](https://github.com/remidej/camox/issues/226)
* keep drafts out of public Markdown and the sitemap ([#173](https://github.com/remidej/camox/issues/173)) ([9c00554](https://github.com/remidej/camox/commit/9c005540fa8ea65dcff885cc045292900eae7898))
* **landing:** keep footer ridgeline proportions on mobile, remove type-safe block demo ([#259](https://github.com/remidej/camox/issues/259)) ([728a037](https://github.com/remidej/camox/commit/728a037dc1290b6a564cadc294879029d860205c))
* lint errors ([8ca7cee](https://github.com/remidej/camox/commit/8ca7cee221965a4cd2090c69da863d15163fde09))
* **scripts:** run worktree preparation non-interactively ([94c19ac](https://github.com/remidej/camox/commit/94c19ac0453a3d943f8393e8d20b996f803fc6dc))
* **sdk:** Canvas regressions from keeping the page mounted across Edit Mode ([#302](https://github.com/remidej/camox/issues/302)) ([e2443dd](https://github.com/remidej/camox/commit/e2443dd956f69d29643d2553447074fc9c7171fb))
* **sdk:** correct repeater and breadcrumb hover highlights ([424b641](https://github.com/remidej/camox/commit/424b64100c4795f390935b1c3c3f040c21defab8))
* **sdk:** hide the Preview's page when its shelf collapses ([#313](https://github.com/remidej/camox/issues/313)) ([a94f6fe](https://github.com/remidej/camox/commit/a94f6fef49444efccc8a811c5b72d7cf4bee4d76))
* **sdk:** improve canvas zoom and horizontal snapping ([0879aed](https://github.com/remidej/camox/commit/0879aed2a0caf094a741b409a1c89dbb40efa1a0))
* **sdk:** keep @iconify/utils out of client bundles ([#290](https://github.com/remidej/camox/issues/290)) ([c0f0500](https://github.com/remidej/camox/commit/c0f05001bbf7683ff886942e77f0d4e4556f7ff9))
* **sdk:** keep Canvas content in view, snapped through resizes, and zoom faster ([#322](https://github.com/remidej/camox/issues/322)) ([9f85a41](https://github.com/remidej/camox/commit/9f85a41d67e9501b867891bf29223c5dffb38720))
* **sdk:** keep the zoomed-out Canvas free of dropped tiles and seams ([#341](https://github.com/remidej/camox/issues/341)) ([541f830](https://github.com/remidej/camox/commit/541f830ffee897772f164d6864dd4b6d347234c0))
* **sdk:** position preview toolbar beside selected text ([a42b898](https://github.com/remidej/camox/commit/a42b89895673c165bbd3381c540c837d04744b3f))
* **sdk:** preserve viewport context across mode switches ([bdd0f8d](https://github.com/remidej/camox/commit/bdd0f8d5389fb2f404e919b96aca3f02c7a0a4a2))
* **sdk:** prevent placeholder label selection ([40a450b](https://github.com/remidej/camox/commit/40a450bc385fb2cfff9eb22346db287126f09397))
* **sdk:** reach *.localhost dev servers from the dev worker ([#340](https://github.com/remidej/camox/issues/340)) ([03ee3bf](https://github.com/remidej/camox/commit/03ee3bf33b8190f9c9209c90944fda9ecccaf7ec))
* **sdk:** refine preview layout and live-site availability ([a348724](https://github.com/remidej/camox/commit/a348724f7632e9a0818bb9b9c0c037fa507d8590))
* **sdk:** render a page in a draft on the server ([#281](https://github.com/remidej/camox/issues/281)) ([623922a](https://github.com/remidej/camox/commit/623922a18fa4d857580fb4d08ca4de8e875a2d11))
* **sdk:** reset preview state when leaving the preview ([92d6373](https://github.com/remidej/camox/commit/92d6373b6a24c5f4151d93a5427d6b78d006539d))
* **sdk:** restore realtime preview updates ([bcb6988](https://github.com/remidej/camox/commit/bcb6988e05f9c99363edb90c3d9f1c46c63ccee9))
* **sdk:** return to the last page when hiding a Canvas with nothing selected ([#337](https://github.com/remidej/camox/issues/337)) ([9fa626f](https://github.com/remidej/camox/commit/9fa626fb22c1e5d0f4904857f393a14375b90762))
* **sdk:** reveal selected blocks with the canvas camera ([#398](https://github.com/remidej/camox/issues/398)) ([25d6004](https://github.com/remidej/camox/commit/25d600459303d77c087097aeb47dd5fae71b4165))
* **sdk:** scroll to the message an editor just sent in the chat ([#434](https://github.com/remidej/camox/issues/434)) ([8460801](https://github.com/remidej/camox/commit/8460801f3798ff6df25acf3fe6ec44aa53efb32c))
* **sdk:** settle Edit Mode's layout before the Canvas shows ([#315](https://github.com/remidej/camox/issues/315)) ([3eb2802](https://github.com/remidej/camox/commit/3eb280227c95f5d5340f18442ca63b163889b331))
* **sdk:** stop string field editors at the field's maxLength ([#304](https://github.com/remidej/camox/issues/304)) ([2fd55fe](https://github.com/remidej/camox/commit/2fd55fe1fe75da390a9dce7c47970a08beef5698))
* **sdk:** stop the page frame jumping as Canvas zoom selects and deselects ([#325](https://github.com/remidej/camox/issues/325)) ([8a14078](https://github.com/remidej/camox/commit/8a14078d57b92bad63adbee54af1ba89cef0b98a))
* **ui:** merge credential buttons into inputs and steady menu trigger colors ([#252](https://github.com/remidej/camox/issues/252)) ([e8b31c9](https://github.com/remidej/camox/commit/e8b31c929dbe8bedaa872e7bf22a45be52950051))


### Performance Improvements

* **canvas:** only run the Canvas frames someone is looking at ([#212](https://github.com/remidej/camox/issues/212)) ([94e7c99](https://github.com/remidej/camox/commit/94e7c99aa39864ad6d5873d6af4288ad4d3dc21b))
* **sdk:** keep the canvas smooth while the camera moves ([#401](https://github.com/remidej/camox/issues/401)) ([68d5bd7](https://github.com/remidej/camox/commit/68d5bd7de52a567d8faaa26d72c83e7a471a071d))
* **sdk:** let a Canvas zoom land while a pan goes on ([#454](https://github.com/remidej/camox/issues/454)) ([c38fc80](https://github.com/remidej/camox/commit/c38fc803ad6cb23afba86314a9faae1fc88eeb75))
* **sdk:** load blocks on demand in the browser and preload a page's blocks ([#258](https://github.com/remidej/camox/issues/258)) ([df49cb8](https://github.com/remidej/camox/commit/df49cb84a6aac86bf5057ce0c7963fd475cbf98b))
* **sdk:** promote canvas page headers ([2aa1535](https://github.com/remidej/camox/commit/2aa153545d7da2c36a5d94f85297fb72fdff4b2f))
* **sdk:** show Canvas Pages as still images when zoomed out ([#468](https://github.com/remidej/camox/issues/468)) ([dc65514](https://github.com/remidej/camox/commit/dc6551439b830216a36a5e5a8b6c9c8fffd84303))
* **sdk:** slim the HTML of pages with artifacts ([#286](https://github.com/remidej/camox/issues/286)) ([b45c226](https://github.com/remidej/camox/commit/b45c226aa9c147724328a2baddd7f252f91e7094))
* **sdk:** start the canvas with the Block Catalog collapsed ([#403](https://github.com/remidej/camox/issues/403)) ([d5d784e](https://github.com/remidej/camox/commit/d5d784eec1b3c9a47e4b1606b07f4a61f6125ec5))
* **sdk:** stop shipping Studio code and wasted requests to anonymous visitors ([#305](https://github.com/remidej/camox/issues/305)) ([71379a8](https://github.com/remidej/camox/commit/71379a80e87c6d798b8f5a6affec5d644ee692b5))


### Refactoring

* align terminology across the platform ([5c68704](https://github.com/remidej/camox/commit/5c687042a3fe9892c9faaaa560d567fabd9acdfa))
* **api:** derive realtime invalidation from a journal of writes ([#311](https://github.com/remidej/camox/issues/311)) ([35c4523](https://github.com/remidej/camox/commit/35c452313cf4d1fdc6912c4dcca8c1203519cc31))
* **api:** drafts overlay as the only writer, and one content access module ([#306](https://github.com/remidej/camox/issues/306)) ([fd2e7f0](https://github.com/remidej/camox/commit/fd2e7f0aea34bc9bc7be078cd9a9d50046896b9d))
* **api:** migrate services to Effect ([3786cd2](https://github.com/remidej/camox/commit/3786cd29156bc51ce25da0f3498c9276b4991806))
* **api:** one content reader, the only way content leaves the API ([#310](https://github.com/remidej/camox/issues/310)) ([df78584](https://github.com/remidej/camox/commit/df785842e3444fad6729ccadb1fa1f4ece325695))
* **api:** one generation module owns the generated-value jobs ([#316](https://github.com/remidej/camox/issues/316)) ([5e3bf87](https://github.com/remidej/camox/commit/5e3bf8723d6fc05f9484c4e7ea4dde99fe1aa9fc))
* **api:** read stored field schemas through one field-kinds module ([#308](https://github.com/remidej/camox/issues/308)) ([f961bc3](https://github.com/remidej/camox/commit/f961bc3b983bde648a2dfcaf2a8504024ac9fe87))
* **api:** replace the migrations with one baseline ([#251](https://github.com/remidej/camox/issues/251)) ([cf5d2cd](https://github.com/remidej/camox/commit/cf5d2cdab1afe8834a1da67d0617be2465cdb8f6))
* drop page and layout checkpoints and per-item publishing ([#256](https://github.com/remidej/camox/issues/256)) ([989cb75](https://github.com/remidej/camox/commit/989cb75c8f20cec2e7f69be00871c2dec34d7adb))
* **landing:** remove unused blocks ([#339](https://github.com/remidej/camox/issues/339)) ([b9bf9a8](https://github.com/remidej/camox/commit/b9bf9a8e935b551c1f1c0dd73e099eccb7ec4a3a))
* **sdk:** let a layout own a record placement ([#200](https://github.com/remidej/camox/issues/200)) ([a6d4653](https://github.com/remidej/camox/commit/a6d4653ec2a88cf28bdc3037c879f988f17a4f25))
* **sdk:** migrate layout loaders to result envelopes ([6a9ec27](https://github.com/remidej/camox/commit/6a9ec271b2e1de4108a1310d5c4acc284a926680))
* **sdk:** one draft scope per render and one catalog of studio reads ([#309](https://github.com/remidej/camox/issues/309)) ([eb91eb6](https://github.com/remidej/camox/commit/eb91eb6d00c181e9101a8e114d12c7ae6d79358d))
* **sdk:** one editing frame module for the Preview and the Canvas ([#307](https://github.com/remidej/camox/issues/307)) ([364aedb](https://github.com/remidej/camox/commit/364aedbb3f73824a467f2e75f8fea4b7605f56f0))
* **sdk:** organize the Canvas sidebar into a navigator and inspectors ([#327](https://github.com/remidej/camox/issues/327)) ([812bffe](https://github.com/remidej/camox/commit/812bffeaefae3ea9cae95281c61d222720293c3e))
* **sdk:** replace Edit Mode with showing the Canvas ([#317](https://github.com/remidej/camox/issues/317)) ([638dbd9](https://github.com/remidej/camox/commit/638dbd974ca146f8ff5e71737c6f6830aeb9a79f))
* **sdk:** scope preview selection to its page or layout ([5a6e493](https://github.com/remidej/camox/commit/5a6e493519a1e600e828f3d5234d52368dafc0a9))
* **sdk:** tidy record pages after review ([#211](https://github.com/remidej/camox/issues/211)) ([a26a3f6](https://github.com/remidej/camox/commit/a26a3f6059f5d9cc58d91a5da202f9ec55853421))


### Documentation

* add artifact ADR and glossary terms ([c7cc3c2](https://github.com/remidej/camox/commit/c7cc3c2329401074a2bb4d8593185bb955631503))
* add branding for the agent and reflexes to the agents product note ([1e2cd2d](https://github.com/remidej/camox/commit/1e2cd2d0306f0c697e03aca6ae24dfb04720925e))
* add drafts ADR and rewrite publishing glossary ([b0d3132](https://github.com/remidej/camox/commit/b0d3132b37cb18d820c92e46f077b53ae75780a1))
* add localization terms and ADR 0015 ([#357](https://github.com/remidej/camox/issues/357)) ([4323e9c](https://github.com/remidej/camox/commit/4323e9cb984760e76b28b2188143b376551bcc5c))
* add product notes on the marketing platform pivot and agents ([0a6dfa8](https://github.com/remidej/camox/commit/0a6dfa8f83575dcd354d2a99d94f2e3bfb3c0b73))
* add Visitor and Project Setting to the glossary, rename Setting to Block Setting ([#361](https://github.com/remidej/camox/issues/361)) ([41cb643](https://github.com/remidej/camox/commit/41cb643e4cbd1902d686676345208a69450240c9))
* **collections:** record slice 8 decisions for record pages ([7652d2c](https://github.com/remidej/camox/commit/7652d2c54fb3fda5d761cfcb5f57cbe3785d3c18))
* **collections:** specify APIs and playground examples ([5e06837](https://github.com/remidej/camox/commit/5e06837e2007d7c938cff90ead6263619037c6b1))
* decide how content survives definition changes ([da9c265](https://github.com/remidej/camox/commit/da9c265bb39759feb5078cab49ad97592be0b8e2))
* decide how drafts store their changes ([91f55e2](https://github.com/remidej/camox/commit/91f55e243c81446a6fc759a374a031c1fa480d78))
* decide how publishing a draft works ([d8eab27](https://github.com/remidej/camox/commit/d8eab27fbb30f808418a9562012ab463e6b205d9))
* decide stable content identity for drafts ([6ae2d7c](https://github.com/remidej/camox/commit/6ae2d7cf63e0ba1e923a698798888671f4c62a64))
* decide that Live keeps no history in v1 ([34e6512](https://github.com/remidej/camox/commit/34e6512403f2ababbcacf775eb034a84f0f98a59))
* decide that the CLI works only in development drafts ([989e2e5](https://github.com/remidej/camox/commit/989e2e599c08d1ffb41ba2180a9c3c527b2ec9bf))
* decide the draft lifecycle ([9a004aa](https://github.com/remidej/camox/commit/9a004aaab57093157f16bbf8a0545ceb31d2c949))
* decide where definitions live and how development drafts work ([f6a706e](https://github.com/remidej/camox/commit/f6a706ee5812dff65e00e9693b5217383f719251))
* define Definition Set in the glossary ([0163503](https://github.com/remidej/camox/commit/016350323d8235566ee941a721b1c07a313f9171))
* define Project ID and Project Slug in the glossary ([4cd329f](https://github.com/remidej/camox/commit/4cd329f316aaed1a7e8e3d408c2d3e17620f38d7))
* define Theme, Color Scheme and Component in the glossary ([fe735d8](https://github.com/remidej/camox/commit/fe735d82b45e135a97940e1f2ce058d5f80621c8))
* drop obsolete plans and add sandbox-free block changes research ([#223](https://github.com/remidej/camox/issues/223)) ([ca2e659](https://github.com/remidej/camox/commit/ca2e659036ad3f02936837445012fda726f8a894))
* glossary updates and ADRs for drafts refactor ([#225](https://github.com/remidej/camox/issues/225)) ([7b25bbd](https://github.com/remidej/camox/commit/7b25bbdac113ed060d09d7255b4821fb4d7c3a2f))
* **land:** prevent Nx socket path length errors ([248773a](https://github.com/remidej/camox/commit/248773aac6e61f582453fe8a4393dda83b957896))
* link drafts research from the ADR ([9955fa0](https://github.com/remidej/camox/commit/9955fa0a745aa0677dfe3a709728ab593612b337))
* move research notes and brainstorms into GitHub issues ([#371](https://github.com/remidej/camox/issues/371)) ([e348569](https://github.com/remidej/camox/commit/e34856995caeed9db1cf06a0140dde7103178ef7))
* point drafts research at the ADR with relative links ([6a06349](https://github.com/remidej/camox/commit/6a0634918b042a8f42663740b86685707fdf5c22))
* record in-site AI editing platform RFC ([1b092f5](https://github.com/remidej/camox/commit/1b092f5d563a3fd25b21283e8ab14068de6f39e6))
* record the Thread term and Pi Durable as the agent's harness ([acfc5d3](https://github.com/remidej/camox/commit/acfc5d3e641e45a4096fc313a3070512dee656ec))
* replace sandbox-free research with previewing code changes without a dev server ([e8d4d81](https://github.com/remidej/camox/commit/e8d4d81666c953d46be650cf4bbfe4fab79adbc4))
* repurpose Release for the platform and record how the API bridges old SDKs ([452f1fe](https://github.com/remidej/camox/commit/452f1fe297532c26ea1da40f5d640015e15bfb64))
* research D1 limits for publishing ([5cf1685](https://github.com/remidej/camox/commit/5cf168530126b724a0442f5bd2a80ba660628fa2))
* research prior art for parallel content changes ([a20e3da](https://github.com/remidej/camox/commit/a20e3dac53b03b4073092d746e886032c35f631a))
* **sdk:** document repeater callback index ([f2affa9](https://github.com/remidej/camox/commit/f2affa9ae245ae8f800954311cb0d55ec7e58b32))
* specify collections v1 API and behavior ([7440062](https://github.com/remidej/camox/commit/744006248c2d356e05e2fab8aba651938aee1367))


### Miscellaneous

* **agents:** add implementation diff count to PR summaries ([#318](https://github.com/remidej/camox/issues/318)) ([bf04c82](https://github.com/remidej/camox/commit/bf04c82613b6fa876257d80878a96ce8bdf3a037))
* **api:** write all generated values with Gemini 3.1 Flash Lite ([#321](https://github.com/remidej/camox/issues/321)) ([88d423b](https://github.com/remidej/camox/commit/88d423ba393d8d7d28e71780919d0fc2074f6399))
* clean up warnings and tooling quirks after vite-plus 1.3.0 ([#299](https://github.com/remidej/camox/issues/299)) ([7a9f2c8](https://github.com/remidej/camox/commit/7a9f2c886cdba11c8ff6532896cd60956b0215d9))
* cut over to the new database ([#278](https://github.com/remidej/camox/issues/278)) ([31c613f](https://github.com/remidej/camox/commit/31c613f201d6db75c1700687feba48056762029b))
* install mattpocock skills ([4812967](https://github.com/remidej/camox/commit/4812967530fa36ea178b1af03b0c6c612cdeb401))
* integrate latest main into canvas flights ([dff55e0](https://github.com/remidej/camox/commit/dff55e0e71343c4bfe18f5cd4b305db4cf96864e))
* merge main for collections landing ([c3237cb](https://github.com/remidej/camox/commit/c3237cb474543dac3c4fb042417ddfef5824ef2e))
* merge main into canvas landing ([6eb58c6](https://github.com/remidej/camox/commit/6eb58c6b36332a982b0330c45c26c0795c5e1112))
* merge main into schema validation landing ([21f15da](https://github.com/remidej/camox/commit/21f15da740dfdd991d50d0b194b31f51f941af8f))
* **plans:** remove outdated canvas plan draft ([784ca61](https://github.com/remidej/camox/commit/784ca615581452c68d06764341c37bdcc4eec387))
* **worktrees:** configure T3 Code setup ([1227455](https://github.com/remidej/camox/commit/12274554ac192fa6bfc47c1a7ab644e30aba71b4))
* **worktrees:** remove post-checkout hook ([6808af6](https://github.com/remidej/camox/commit/6808af644182afedea39b5373031a958b4ff1aa1))
* **worktrees:** run worktree prep in background and add dev action ([880cc43](https://github.com/remidej/camox/commit/880cc4388397573e37329630dc3d4ba00dcb5c7e))

## [0.44.0](https://github.com/remidej/camox/compare/camox-v0.43.0...camox-v0.44.0) (2026-09-24)


### Features

* add strikethrough marker instead of underline ([5cf5e11](https://github.com/remidej/camox/commit/5cf5e1139881482cab0a97d6efd5a1e915fd1ef5))
* **auth:** isolate credentials and databases per checkout ([730095b](https://github.com/remidej/camox/commit/730095b94dd9634549e2a2576487373e4e7b0936))
* **cli:** list and resolve page comments ([3142dd8](https://github.com/remidej/camox/commit/3142dd8ced6a9a4f08f921ee0583ba9c5c80c391))
* **feedback:** mark comments as done ([28954ae](https://github.com/remidej/camox/commit/28954ae99ef6adfa07ba4f7dc7821d51349224d9))
* **feedback:** persist object comments across environments ([816d09a](https://github.com/remidej/camox/commit/816d09acded7d1fab1efbf791e7f3c55b14393c0))
* **icons:** add typed icon fields and searchable picker ([f7ad47f](https://github.com/remidej/camox/commit/f7ad47f19b92446cda38ebf1a1f6247f7e29b46b))
* **preview:** add authenticated CLI-to-browser draft handoff ([cdad73b](https://github.com/remidej/camox/commit/cdad73b54783d318ba5603a049e10493388de94c)), closes [#114](https://github.com/remidej/camox/issues/114)
* **preview:** send feedback to agent ui ([5de0f81](https://github.com/remidej/camox/commit/5de0f81a5ffc4f3af26483dcfec977a17ec22f0b))
* **sdk:** add feedback shortcut and archive comment action ([99dbf08](https://github.com/remidej/camox/commit/99dbf088afc96948322159cbe4b81220c30b3f3c))
* **sdk:** send page feedback to agent with actionable prompt ([dee4e1f](https://github.com/remidej/camox/commit/dee4e1f8116d60c01e47c37b68b6896cc0c40208))
* **studio:** richer video support ([3f57f7d](https://github.com/remidej/camox/commit/3f57f7da9d4791fd4be2bb0607c23dbe3dd7d940))


### Bug Fixes

* **dev:** isolate servers across checkouts ([4e74e45](https://github.com/remidej/camox/commit/4e74e455d8bc5a46dd0a060afbdb86c9b154e00b))
* **sdk:** navigate the icon picker as a grid ([f987b6d](https://github.com/remidej/camox/commit/f987b6d2c95c52792719e760dea6204ba0359f49))
* **sdk:** pre-optimize dynamically loaded runtime dependencies ([4d31c60](https://github.com/remidej/camox/commit/4d31c608363505a495320d45301f1db58efe5053))
* **sdk:** show feedback across previews and prompt signed-out users ([595a93a](https://github.com/remidej/camox/commit/595a93a9349e98f12f7c4d587869872ef72d6406))
* **sdk:** show only the deepest overlay highlights ([035db7a](https://github.com/remidej/camox/commit/035db7acc698e177506edefa8770e1781c1219e9))
* **sdk:** simplify page picker and command palette UI ([1cdb95c](https://github.com/remidej/camox/commit/1cdb95c8668f00444effa9233347d58214fb3723))
* **sdk:** tighten page picker and preview path layout ([5d70774](https://github.com/remidej/camox/commit/5d707747bab950ad6a3ec42fc83571f564f2d599))


### Performance Improvements

* **dev:** speed up checkout preparation ([f1b1a8c](https://github.com/remidej/camox/commit/f1b1a8c11e735cc0e4ed7ccaa615db5a8b44dcc4))
* **sdk:** virtualize the icon picker grid ([b3cd1bc](https://github.com/remidej/camox/commit/b3cd1bc2f9118cf85a4691ea2e1bea89b5432745))


### Refactoring

* **sdk:** rename comments flag to enableExperimentalFeatures ([fe53fff](https://github.com/remidej/camox/commit/fe53fff36f9586e1240d5623bb9373d1b50fe5a3))


### Documentation

* refine readme ([1a15692](https://github.com/remidej/camox/commit/1a1569266eac460149c4549d818fdbd641b66eaf))
* **sdk:** keep camoxify styling on shadcn and Tailwind ([5dc8099](https://github.com/remidej/camox/commit/5dc8099d6ff6981333817e6eafd2b194f51678fe))
* **sdk:** prefer settings for constrained camoxify choices ([40e7d83](https://github.com/remidej/camox/commit/40e7d83fdfa4652d7b7d73825754d19779380482))


### Miscellaneous

* add direct-to-main landing skill ([211f6aa](https://github.com/remidej/camox/commit/211f6aab9c64fb0395a7aa30cff586aef42a025e))
* **agents:** streamline landing verification ([abcdaf9](https://github.com/remidej/camox/commit/abcdaf915c2b04491950c4649bd9751778982b75))
* set up agents prepare file ([7c7684d](https://github.com/remidej/camox/commit/7c7684d536b9383964f23846a20de437ef9442d8))

## [0.43.0](https://github.com/remidej/camox/compare/camox-v0.42.0...camox-v0.43.0) (2026-09-21)


### Features

* add camoxify skill ([fa2f5bf](https://github.com/remidej/camox/commit/fa2f5bf3ba3f7cf653d8d2d4802009236dcaa42e))
* add getElementContext api ([141965c](https://github.com/remidej/camox/commit/141965cedd307e8c47fd5491c1a66ee4ed885900))
* add singleton layouts ([2dee85d](https://github.com/remidej/camox/commit/2dee85de42600f8095925cc8bc5f18838f4eb8cc))
* **cli:** add --cwd for runtime lookup ([dd84e21](https://github.com/remidej/camox/commit/dd84e21222d56448d6d303a8e891cd6f5a393d71))
* **cli:** add media commands ([349ed6f](https://github.com/remidej/camox/commit/349ed6feeebbbf8126214ad5d95a441c9b2b4557))
* **cli:** replace image source ([e7bcfe8](https://github.com/remidej/camox/commit/e7bcfe8d70b0a638ff701e95ed46b2414a6067e3))
* **cli:** support page SEO metadata updates ([1ca122a](https://github.com/remidej/camox/commit/1ca122aad316b5acc678f811e68d024142eb5b16)), closes [#109](https://github.com/remidej/camox/issues/109)


### Bug Fixes

* **api:** validate images before generating metadata ([6963deb](https://github.com/remidej/camox/commit/6963debd8a66f41c19f2508447ce5a62a00284bc)), closes [#105](https://github.com/remidej/camox/issues/105)
* **cli:** populate empty blocks with default content ([cce66cf](https://github.com/remidej/camox/commit/cce66cfe912dd600a45da2ffcd4234bfe86b8d47))
* **sdk:** generate formatter-compliant layout declarations ([b8883e9](https://github.com/remidej/camox/commit/b8883e95b696ce084e0acc26f41030f126197d88))
* **sdk:** include production server runtime dependencies ([937528c](https://github.com/remidej/camox/commit/937528cb0bd69c65aa617555deb20b454df17307)), closes [#106](https://github.com/remidej/camox/issues/106)


### Miscellaneous

* delete old plan files ([6a72c69](https://github.com/remidej/camox/commit/6a72c69e9ab0be4c0986fdd9228cbe22c1784974))
* less verbose skill contents ([ed62cc9](https://github.com/remidej/camox/commit/ed62cc9e831e8007fe64e21d41a92fa9bc072683))
* more progressive skill discovery ([d837336](https://github.com/remidej/camox/commit/d837336d056b31b651076f7760a6bdf13307f29c))
* **playground:** transform pokedex block into curated selection ([8108fef](https://github.com/remidej/camox/commit/8108fef04980ef7ee8b63cd256d156185acb712f))
* remove CLAUDE.md instructions file ([b9fdc0c](https://github.com/remidej/camox/commit/b9fdc0caf3efb73861b4bb4657baee23ec5f2b92))
* transform gradient marker into highlight ([f11523d](https://github.com/remidej/camox/commit/f11523d4ad57cda07308f536cb5a824625c3bb73))

## [0.42.0](https://github.com/remidej/camox/compare/camox-v0.41.1...camox-v0.42.0) (2026-09-18)


### Features

* add comment ui prototype under flag ([aff4f67](https://github.com/remidej/camox/commit/aff4f6751b2202b0d4922d1224f0f6d74308e2bf))
* add comments sidebar ([a4e8482](https://github.com/remidej/camox/commit/a4e8482c4d8aecc5a2b0802fb6420715043bc2f4))
* page-level comments ui ([2aa557d](https://github.com/remidej/camox/commit/2aa557d80b3bc680e92b7b90613f925d2f941dd6))
* **sdk:** redesign command palette ([1e77ab3](https://github.com/remidej/camox/commit/1e77ab3614826141b9f9881d75e6a01ed0d3588c))


### Bug Fixes

* add new block ui tweaks ([b3085aa](https://github.com/remidej/camox/commit/b3085aa8a7d097dd46dc38c9e1afe3b0c06a838d))
* comments ui tweaks ([b2ed8a2](https://github.com/remidej/camox/commit/b2ed8a297f25f4acd1b3040a7b18b3d7e5b83a83))
* editor editor ui tweaks ([8088b84](https://github.com/remidej/camox/commit/8088b8425577bde01804539a0a017e7c1feaaf2e))
* escape behavior ([73e0cce](https://github.com/remidej/camox/commit/73e0cce528a6fa57ccd4c33b189671238021ac0b))
* **preview:** remove persistent comment bubbles ([6a0c539](https://github.com/remidej/camox/commit/6a0c5397320ba5e59480389cd8e32ee1fef78a30))
* **sdk:** remove form and settings actions from block popover ([80fbf58](https://github.com/remidej/camox/commit/80fbf5801854b7b14a71d73746df9744ea5f2470))
* various ui tweaks ([5baf8d9](https://github.com/remidej/camox/commit/5baf8d9bd1839fe7402b6fa7331fbbeb24679a19))


### Refactoring

* **sdk:** remove obsolete content sheet controls and state ([3c8f2cf](https://github.com/remidej/camox/commit/3c8f2cf4cb3fff293e979126893320b2ee7dc3fd))


### Miscellaneous

* move sdk css output out of dist ([f5ffb40](https://github.com/remidej/camox/commit/f5ffb404172971de3bdf77f110e39e6baec85682))
* refactor comment mode state management ([f32e432](https://github.com/remidej/camox/commit/f32e432eb58ea7f595bed704023cf7a48ee02d44))
* remove telemetry ([9eb6701](https://github.com/remidej/camox/commit/9eb67019d5a4e1fc6a839a07328acb1ae7d5f5d8))
* rewrite conventional commit skill ([5497eab](https://github.com/remidej/camox/commit/5497eabd5cff0945d59df975646a867c0cfa630d))
* simplify template app blocks ([e9f782a](https://github.com/remidej/camox/commit/e9f782a9c2395cd95f99490fbefcbb4463d48ec6))

## [0.41.1](https://github.com/remidej/camox/compare/camox-v0.41.0...camox-v0.41.1) (2026-09-16)


### Bug Fixes

* ci cloudflare auth ([39d06c0](https://github.com/remidej/camox/commit/39d06c0b3e8564eb380d1825358dab8feabeded8))
* link and embed editing in preview ([e735499](https://github.com/remidej/camox/commit/e735499c9c82921a1c8f36b279b69a91e2f20080))
* no explanation why auth fail when email not verified ([473f3db](https://github.com/remidej/camox/commit/473f3dbdc07926b8a0d49782c30dc4bbbea0e7ab))
* preview not reacting to block setting changes ([e518df4](https://github.com/remidej/camox/commit/e518df435785f064c387495399903d0a0198c6a1))
* toggle edit mode shortcut adding line breaks ([85d78fa](https://github.com/remidej/camox/commit/85d78faa14709b6ba984bb3a00264c871a1761c1))
* track generated tanstack route tree file ([9d5fb8f](https://github.com/remidej/camox/commit/9d5fb8f4bf4b0d984b96750dd52f4750175df16f))
* view live page showing draft content ([55ab48d](https://github.com/remidej/camox/commit/55ab48d9824c9adfb0bef7d86a9d60ade1bd1fae))


### Miscellaneous

* refactor previewStore to prevent impossible edit live source state ([431b092](https://github.com/remidej/camox/commit/431b0922a16b2a35f9f7ce8b2c06906d1c5825cd))
* remove cloudflare ci troubleshooting code ([4290fe6](https://github.com/remidej/camox/commit/4290fe65f4605d8ded87694d4fe8df3fe4fb442d))
* set up deployment github action ([a995e74](https://github.com/remidej/camox/commit/a995e74b1c96f7aa37d758257f963534df913c36))
* troubleshoot cloudflare ci errors ([a895cae](https://github.com/remidej/camox/commit/a895caead4ad04ee599511b2f8da16b7309ea03a))

## [0.41.0](https://github.com/remidej/camox/compare/camox-v0.40.0...camox-v0.41.0) (2026-09-15)


### Features

* add derived layouts ([2569639](https://github.com/remidej/camox/commit/25696391bf699d5971b64a8eb8d4e978ccb2f11f))
* add gradient text marker ([4a509f4](https://github.com/remidej/camox/commit/4a509f41c70a070b42e2ca7cac69829f92da76b4))
* add publishing controls to derived layouts ([b655dc6](https://github.com/remidej/camox/commit/b655dc68dc6b30c1b7ca894caf0434bf0d98fc25))
* add synced blocks ([f860852](https://github.com/remidej/camox/commit/f860852cc0773f9fe4efaa0d05dbe8b682a6450f))
* show peeked block thumbnails ([e4f1256](https://github.com/remidej/camox/commit/e4f1256fb13c31e4f7a16d46b91753dceed32c58))


### Bug Fixes

* avoid layout shift on navigation with better ssr ([04086be](https://github.com/remidej/camox/commit/04086beba10c55f1b38345867ea3b7b0fb2fadbc))
* better view published page wording ([3ef10ad](https://github.com/remidej/camox/commit/3ef10adad2e6862f7db76b399a934a0a3ea904c0))
* edit link popover ([8f5903d](https://github.com/remidej/camox/commit/8f5903d0c22d0eda3b4030bbda8d194c5a9ef4b0))
* ensure publish actions available when edit mode off ([5ee196b](https://github.com/remidej/camox/commit/5ee196b969f58857502de7f75d71ec148e6e77cc))
* iframe glitch on hydration ([be44552](https://github.com/remidej/camox/commit/be44552e27ce70fe690c26e6c9c0b5dc1bee5594))
* move add new block back to right sidebar ([32eb053](https://github.com/remidej/camox/commit/32eb0533a9892a7b0d4fa93b43af95cf0871e32a))
* prevent selecting derived layouts on curated pages ([600dd87](https://github.com/remidej/camox/commit/600dd87191488e55f53f6ffc02d3bf8e26319812))
* **preview:** remove automatic page peeking ([27ff827](https://github.com/remidej/camox/commit/27ff827b72dcb37b95922472e1f9bf7e60c0cdb8))


### Documentation

* add derived layouts plan ([4fd999f](https://github.com/remidej/camox/commit/4fd999fa5ffa08c4e009e5be8920d51882d4e34c))


### Miscellaneous

* add derived pokedex pages to playground ([a6dd45f](https://github.com/remidej/camox/commit/a6dd45f5ab6039b3c0950f7328fb1dbfca2576af))
* add right sidebar for derived pages ([49e794d](https://github.com/remidej/camox/commit/49e794dc5362e03f09e72b88c0a1ec858eae097e))

## [0.40.0](https://github.com/remidej/camox/compare/camox-v0.39.0...camox-v0.40.0) (2026-09-11)


### Features

* add mobile preview ui ([56daa0c](https://github.com/remidej/camox/commit/56daa0cd89dc34bec9b5845a349a2ff2d054ddfd))
* hide camox ui in user button popover ([9c603ce](https://github.com/remidej/camox/commit/9c603ce621ee17528301344889ff83e6fb1e2cf2))


### Miscellaneous

* new type safety block ([e757d1f](https://github.com/remidej/camox/commit/e757d1f704b7ac2dc7f913cdc9b8f818463972a0))

## [0.39.0](https://github.com/remidej/camox/compare/camox-v0.38.0...camox-v0.39.0) (2026-09-02)


### Features

* remove in-app agent chat ([f5a8ed1](https://github.com/remidej/camox/commit/f5a8ed1e331e45344b8170e2358d0763475819f9))


### Bug Fixes

* better auth cloudflare emails config ([95bbe07](https://github.com/remidej/camox/commit/95bbe07690b2d493bed1364112b55fba9b6fefaa))
* use title instead of summary in breadcrumbs ([844f51d](https://github.com/remidej/camox/commit/844f51dce5fe0f29654293021e61790dfebe45aa))


### Miscellaneous

* add with without block ([9a74a24](https://github.com/remidej/camox/commit/9a74a24c0fcc4150659ea80d11cb7e737e5d1408))
* delete extreneous camox skill from repo root ([4351ad2](https://github.com/remidej/camox/commit/4351ad282c2ebb33cd02462c927d7345217060e9))
* replace grill-with-docs by grill-me skill ([d5a8e0a](https://github.com/remidej/camox/commit/d5a8e0a295edd5fba9b1e8676ba5295b3f8aa919))
* set initial test suite ([03bad77](https://github.com/remidej/camox/commit/03bad7762d42d483387b04d31a83e0fc5edc4663))

## [0.38.0](https://github.com/remidej/camox/compare/camox-v0.37.0...camox-v0.38.0) (2026-08-25)


### Features

* refactor skills into umbrella symlinked skill ([733acea](https://github.com/remidej/camox/commit/733acea2326ba1ef6525c12bf46a86610a7cfda5))


### Miscellaneous

* remove convex generated from ignore patterns ([f8482d3](https://github.com/remidej/camox/commit/f8482d320a653a454584eb586149c446ccdf036e))

## [0.37.0](https://github.com/remidej/camox/compare/camox-v0.36.3...camox-v0.37.0) (2026-08-21)


### Features

* logged out flow instead of crashing dev server ([b3f6efe](https://github.com/remidej/camox/commit/b3f6efe22b7d97db723982d07fd8262a5a4caad2))
* new camox release command instead of sync secret ([b9776c1](https://github.com/remidej/camox/commit/b9776c1ab8b1acd1f5986d43b34efcc7e00c181c))

## [0.36.3](https://github.com/remidej/camox/compare/camox-v0.36.2...camox-v0.36.3) (2026-08-09)


### Bug Fixes

* virtual modules breaking generated apps ([dd116eb](https://github.com/remidej/camox/commit/dd116eb5e70fd936c7ae205f39d974296dedc6c0))

## [0.36.2](https://github.com/remidej/camox/compare/camox-v0.36.1...camox-v0.36.2) (2026-08-06)


### Bug Fixes

* publish built version of camox ui ([543efff](https://github.com/remidej/camox/commit/543efff2b2b0651773759fed4c1a90a8315e9ef8))

## [0.36.1](https://github.com/remidej/camox/compare/camox-v0.36.0...camox-v0.36.1) (2026-08-05)


### Bug Fixes

* **sdk:** missing runtime module in exports ([68cc40e](https://github.com/remidej/camox/commit/68cc40e85de3d0096ae898969681d8992c3b3c6e))

## [0.36.0](https://github.com/remidej/camox/compare/camox-v0.35.0...camox-v0.36.0) (2026-08-05)


### Features

* add view live page button ([45576d8](https://github.com/remidej/camox/commit/45576d8426db8a1411a6aca4df1a9a0fc56b3bdc))
* display navbar by default ([6a42b90](https://github.com/remidej/camox/commit/6a42b90de343397f5501443a9c67c8d539dd8611))


### Bug Fixes

* navbar displaying wrong theme ([7bb23f7](https://github.com/remidej/camox/commit/7bb23f71cb56e163ccb4a63f56da37d280d27883))
* preview toolbar navigation ([bc49edf](https://github.com/remidej/camox/commit/bc49edfad9cc3e0de893880facab765de87d645d))
* selection breadcrumbs design (metro map style) ([80d68ea](https://github.com/remidej/camox/commit/80d68ea0f487a65f5bb53ced58cb87acb8023ac4))
* toolbar view live site design ([bb5989a](https://github.com/remidej/camox/commit/bb5989abf9c8dfc4bf367829701ed0cea0623dc8))


### Documentation

* rewrite readme presentation ([60b32d9](https://github.com/remidej/camox/commit/60b32d991e87695e5b4ae2d203dd8dc962d95d1d))


### Miscellaneous

* change domain from ai to dev tld ([a008d92](https://github.com/remidej/camox/commit/a008d9205087de7fc450743eb56e37ec9ed827b8))

## [0.35.0](https://github.com/remidej/camox/compare/camox-v0.34.0...camox-v0.35.0) (2026-07-28)


### Features

* display page meta ([a6bdac8](https://github.com/remidej/camox/commit/a6bdac833cf3d3bf0b5853d884ed3c2e442a109f))


### Bug Fixes

* split website and studio bundles ([c93f110](https://github.com/remidej/camox/commit/c93f110e6d3abe7c668c450f171877e62103307d))

## [0.34.0](https://github.com/remidej/camox/compare/camox-v0.33.1...camox-v0.34.0) (2026-07-23)


### Features

* add _future page rendering ([e0fcf09](https://github.com/remidej/camox/commit/e0fcf0976401963f7504e7d25844e5fe86b5832f))
* add defineDocument API ([92552ba](https://github.com/remidej/camox/commit/92552ba2dcae8cf4cdcc51459b083cc69bec936f))
* add hydration to _future runtime ([19c865f](https://github.com/remidej/camox/commit/19c865fd4ae6497c4568120f8d482e8ce16bea2d))
* nitro-first runtime ([ec92df2](https://github.com/remidej/camox/commit/ec92df24bb483e25ca8a486027d8683a3f62b4b0))
* preserve shared layout upon navigation ([99327fa](https://github.com/remidej/camox/commit/99327fade7bae66aac3ce4446521600c0f21317a))
* render camox routes on future runtime ([31250cd](https://github.com/remidej/camox/commit/31250cdf062791b9edb98abdf4247497d7ded3e5))


### Bug Fixes

* display toolbar upon auth ([dc75a4e](https://github.com/remidej/camox/commit/dc75a4e2b7a2a90a3c8cd44b9fa7c21a750f8296))
* **sdk:** css and js not loading ([9936bfa](https://github.com/remidej/camox/commit/9936bfa8cad1988fa2a797c51139a904f438f5e0))
* ssr not rendering blocks html ([6985198](https://github.com/remidej/camox/commit/69851980ba7ad8fad3bfa47163234773db3d3d95))


### Documentation

* document custom framework plan ([5be2390](https://github.com/remidej/camox/commit/5be2390ac0f4d9a46a99155bbe8087e9f493f754))


### Miscellaneous

* add camox provider to future runtime ([6413270](https://github.com/remidej/camox/commit/64132702fa08a7435c5daf9f812be449f8724067))
* **api:** rename SITE_URL to DASHBOARD_URL ([038da3c](https://github.com/remidej/camox/commit/038da3c7f77664b982fb8edabab2defb5832457d))
* client side navigation ([c69ee0d](https://github.com/remidej/camox/commit/c69ee0d889470888000144851dc8f42fdc24a0ca))
* fix main dev script spiking cpu use ([9347c8a](https://github.com/remidej/camox/commit/9347c8a98b75dc29d688741260d852bb29211248))
* promote future runtime to default ([e5a8482](https://github.com/remidej/camox/commit/e5a84823f01b0b5443cc6c0ab83fcf2890e8123a))
* register _future route path ([99b402c](https://github.com/remidej/camox/commit/99b402c5da13a6ef8d6da733120157074196c81b))
* remove tanstack start from playground app ([b5e4e51](https://github.com/remidej/camox/commit/b5e4e51a6ef43c73cbc4dc777a6ca996468a3e38))
* render camox studio routes on future runtime ([63e5e55](https://github.com/remidej/camox/commit/63e5e55cb973670b0c18a5268fe62fb3ed21cbcd))
* split web app into dashboard and landing ([e334ffe](https://github.com/remidej/camox/commit/e334ffe642c66141f670ccbd596c92bf8f7616e0))
* update template app to use new file structure ([3ee340a](https://github.com/remidej/camox/commit/3ee340a23dfffba78473e7cae67e9dd00d1a6bc1))

## [0.33.1](https://github.com/remidej/camox/compare/camox-v0.33.0...camox-v0.33.1) (2026-06-30)


### Bug Fixes

* broken auth gate on studio pages ([2663423](https://github.com/remidej/camox/commit/26634239f33dd5fa196a2d0bdfce6ee5796ab2ab))
* remove preview toolbar transitions ([11fb5a2](https://github.com/remidej/camox/commit/11fb5a23dd68bcf769b966028c825279556b1383))

## [0.33.0](https://github.com/remidej/camox/compare/camox-v0.32.0...camox-v0.33.0) (2026-06-29)


### Features

* add right sidebar ([963a8bb](https://github.com/remidej/camox/commit/963a8bbe3233fe24ec64761453a97f76327649fa))
* add tablet viewport mode ([3b40bfd](https://github.com/remidej/camox/commit/3b40bfde4f66bc7952e093e5771d9bfead6e012c))
* hide toolbar ([0fdf7d7](https://github.com/remidej/camox/commit/0fdf7d7faf4dcc2535f08c97ca62e6860dc6a784))
* move asset picker to a dedicated modal ([12db5f8](https://github.com/remidej/camox/commit/12db5f8ddd562827a4773f83e7e51ea2fdeb2d76))
* new preview toolbar ([ee28363](https://github.com/remidej/camox/commit/ee283632e15d6300b55e3897ba4d8b26b98ef337))
* replace page metadata modal by right sidebar ([2a98bb9](https://github.com/remidej/camox/commit/2a98bb942c2e6bb65e1ced20bb78a2bf6b945b13))
* transform asset field editor into a modal ([cbf4576](https://github.com/remidej/camox/commit/cbf4576d26711739d227d9a74cdb851a37de8fd3))
* vertical selection breadcrumbs in sidebar ([88b1aa9](https://github.com/remidej/camox/commit/88b1aa9f677918ada4aadeeedc702b6f43a9d96a))
* warn before redirecting to sign in ([9b95fe5](https://github.com/remidej/camox/commit/9b95fe51557fe33c624aa7ae596de79e343073d9))


### Bug Fixes

* 404 on camox studio pages ([adc064d](https://github.com/remidej/camox/commit/adc064d3d727943db6133ebeb03c0b3239b14c2d))
* sidebar stealing focus on preview click ([5e87313](https://github.com/remidej/camox/commit/5e8731318920eb002a52fd81641c0b11026a5140))
* ui details ([809fb8b](https://github.com/remidej/camox/commit/809fb8bd600b2ac4c9fd4bb7674f7f545ecaf2d4))
* use existing preview toolbar for unauthenticated localhost visitors ([e1fd2ce](https://github.com/remidej/camox/commit/e1fd2ce50411f710d52731651fd6a2812976c923))


### Miscellaneous

* clean up previewStore ([12f6f07](https://github.com/remidej/camox/commit/12f6f0799a8c5619616e4f88fb9c396e2352e9f2))
* move add block ui to left sidebar ([7ae19ce](https://github.com/remidej/camox/commit/7ae19ce9acb7fddc93fea167e7b515728e17c9b5))
* move ai chat to right sidebar ([28efc91](https://github.com/remidej/camox/commit/28efc91c6ce4b259503f2c9adfe9d94dc6bd66ed))
* organize right sidebar into separate files ([fa83188](https://github.com/remidej/camox/commit/fa8318880c35726e882f3fc527cbbcf131fe05d3))
* remove list of fields from PageTree ([c2c1f60](https://github.com/remidej/camox/commit/c2c1f607b8258d71fe539d4a543523a4a39723c7))
* remove preview side sheet component ([76b0ff5](https://github.com/remidej/camox/commit/76b0ff5ed8c7153a6e73c726b82d19bf7bef2f24))
* rename sidebar files ([2950f1b](https://github.com/remidej/camox/commit/2950f1b754cb994b3e1db5c19c7d58e12bed539a))
* use `/camox` as camox studio path prefix ([c4ea339](https://github.com/remidej/camox/commit/c4ea33955e1456085670974a4d4d66d861be9228))

## [0.32.0](https://github.com/remidej/camox/compare/camox-v0.31.5...camox-v0.32.0) (2026-06-20)


### Features

* add components prop to Field component ([e2d42c4](https://github.com/remidej/camox/commit/e2d42c499a357793d3281a7bf13cf8780ce7fab0))
* add text links support ([1ba98ee](https://github.com/remidej/camox/commit/1ba98eea74c6e4eed5e98eb2ea4fecb9f3791279))


### Bug Fixes

* link popover editor ([edc0f15](https://github.com/remidej/camox/commit/edc0f15fea0a56e5215010fc10541c4a037b02aa))


### Documentation

* add light theme readme banner ([90cf65e](https://github.com/remidej/camox/commit/90cf65e4917803c59dc83b61ae1c8e487df62066))

## [0.31.5](https://github.com/remidej/camox/compare/camox-v0.31.4...camox-v0.31.5) (2026-06-09)


### Documentation

* add mcp server plan ([e794fd3](https://github.com/remidej/camox/commit/e794fd393990ac455d060e7bcd9eafe47144e332))
* revamp readme ([5427fe7](https://github.com/remidej/camox/commit/5427fe7621661238849f7428dcfd48fbc09addef))
* simplify readme ([a54ddab](https://github.com/remidej/camox/commit/a54ddab6685df8fd22ee3881dcf699b5f35b6a0f))


### Miscellaneous

* migrate all but api to mit license ([07e31a2](https://github.com/remidej/camox/commit/07e31a2298d0537bb228246ce9fc7e97cbbc83dd))

## [0.31.4](https://github.com/remidej/camox/compare/camox-v0.31.3...camox-v0.31.4) (2026-05-27)


### Bug Fixes

* server import in client ([294153a](https://github.com/remidej/camox/commit/294153ac437f7377f4824a25056f84dc9de78a54))

## [0.31.3](https://github.com/remidej/camox/compare/camox-v0.31.2...camox-v0.31.3) (2026-05-27)


### Bug Fixes

* remove tanstack router from vite optimizDeps ([987a1d1](https://github.com/remidej/camox/commit/987a1d12b902bd5188c3bfb97432fceb7e943551))

## [0.31.2](https://github.com/remidej/camox/compare/camox-v0.31.1...camox-v0.31.2) (2026-05-27)


### Bug Fixes

* hydration error on created apps ([ff8cd51](https://github.com/remidej/camox/commit/ff8cd5111f7744a002e6f8df021d74781b15412a))

## [0.31.1](https://github.com/remidej/camox/compare/camox-v0.31.0...camox-v0.31.1) (2026-05-26)


### Bug Fixes

* expired cookie triggering 404 ([1005498](https://github.com/remidej/camox/commit/10054985bf4f03c3c597571233aee48b164b0ca4))

## [0.31.0](https://github.com/remidej/camox/compare/camox-v0.30.0...camox-v0.31.0) (2026-05-26)


### Features

* add aliases to command palette actions ([ebdc132](https://github.com/remidej/camox/commit/ebdc1322db6d2a35279f502f72c0033fcfb5ce5d))

## [0.30.0](https://github.com/remidej/camox/compare/camox-v0.29.1...camox-v0.30.0) (2026-05-26)


### Features

* add reasoning to agent chat ([155ad15](https://github.com/remidej/camox/commit/155ad156574c6eddfa81e88b5acb02cba7f9ff2e))
* add stop button to agent chat ([f89b9a2](https://github.com/remidej/camox/commit/f89b9a27e8836b71bb0802b52aaa3cb3b56a38c2))
* add streaming agent endpoint ([1031a4a](https://github.com/remidej/camox/commit/1031a4adec4d4c1b7ab18ff9e8b3497618b68a50))
* add validation ui for agent chat tool calls ([827de84](https://github.com/remidej/camox/commit/827de844c964dd0891a277f2673968ca5033aabb))
* auto-navigate to pages created by agent ([083041c](https://github.com/remidej/camox/commit/083041cc4814e3cbc507fa2369c7989135d5e49f))
* move initial page scaffolding to agent chat ([1dc9f66](https://github.com/remidej/camox/commit/1dc9f6663fc059f4b8e36c7179441987fa8568b9))
* new agent thread button ([3c95bbb](https://github.com/remidej/camox/commit/3c95bbbdc76308747ebcbd73bcf16ddd4fcff810))
* render agent chat markdown with streamdown ([1986bb2](https://github.com/remidej/camox/commit/1986bb298f9580f6e61f6c689090eec7f614e77c))
* richer tool call labels ([a2440e3](https://github.com/remidej/camox/commit/a2440e3a390110004ee66bc42a7ff1cd5b4d763e))
* **sdk:** add rough agent chat ui ([80b150d](https://github.com/remidej/camox/commit/80b150dd2ebc3573d0409497b4a5a9afcff251d5))


### Bug Fixes

* agent chat tool calls ui consistency ([35f5de1](https://github.com/remidej/camox/commit/35f5de1d9bef63690326e470018356347f351a9c))
* align agent chat messages to bottom ([96ff72c](https://github.com/remidej/camox/commit/96ff72ceaa3e4e27484915199a95edf6efb02457))
* don't lose agent chat input focus on submit ([0395b8e](https://github.com/remidej/camox/commit/0395b8e37895e128181cd2a532f7b5855693e344))
* git hook worktree setup ([3c05c92](https://github.com/remidej/camox/commit/3c05c92b4b37dec9bc82bcb4e5277e03be1f8546))
* git hook worktree setup ([5fe21ad](https://github.com/remidej/camox/commit/5fe21adff82335a5d20df6587e25dadb56212d8c))
* isolate database per worktree ([fee3677](https://github.com/remidej/camox/commit/fee3677be66a4182c18a18eaab18cfa11032870f))
* persist agent chat state when toggling sheet ([af1f742](https://github.com/remidej/camox/commit/af1f742d778df26f79744b56977dd70f22cfe3df))
* scroll preview to blocks mutated by agent ([8b3a212](https://github.com/remidej/camox/commit/8b3a2124602782963a00169a71db02f688dd3916))
* tool approval ui ([5ac0762](https://github.com/remidej/camox/commit/5ac076203619f6331f4dd6167716cdd23f208af3))


### Documentation

* prepare agent chat feature ([18cf68f](https://github.com/remidej/camox/commit/18cf68f4e7a1fe8e1b94aa7050cd84447959afb7))


### Miscellaneous

* agent chat ui improvements ([24acf9b](https://github.com/remidej/camox/commit/24acf9b681f9a7030f9d2680f66e0935a586f3e5))
* improve agent chat type safety ([ba5087d](https://github.com/remidej/camox/commit/ba5087d00b38ed475b9d9e45431a57fbc9448cdd))
* prepare ai tools for new agent chat surface ([81e2086](https://github.com/remidej/camox/commit/81e2086e1938e3c996d1e39736f147db062ccdcb))
* use emitCustomEvent for frontend side effects ([21cc759](https://github.com/remidej/camox/commit/21cc759d6f25145b661e3e7b42f8bfaf96231902))

## [0.29.1](https://github.com/remidej/camox/compare/camox-v0.29.0...camox-v0.29.1) (2026-05-22)


### Bug Fixes

* posthog public key ([48dfbe6](https://github.com/remidej/camox/commit/48dfbe6f667136b0b4aaad3ad9bb8c916a3730fa))

## [0.29.0](https://github.com/remidej/camox/compare/camox-v0.28.6...camox-v0.29.0) (2026-05-22)


### Features

* prefill page path on creation using nickname ([cea4d99](https://github.com/remidej/camox/commit/cea4d99619b4c7bd4c88093d317834057943814d))


### Miscellaneous

* bring skills up to date ([642527b](https://github.com/remidej/camox/commit/642527b94c91289b18bb84097cd8415756e0f6e8))
* move page status next to nickname in PagePicker ([4de5067](https://github.com/remidej/camox/commit/4de5067031480f855578f7028d34cc626f831d95))

## [0.28.6](https://github.com/remidej/camox/compare/camox-v0.28.5...camox-v0.28.6) (2026-05-22)


### Bug Fixes

* drop yarn support ([457e2ca](https://github.com/remidej/camox/commit/457e2ca30edbde2f8580109641e6d9c57034389f))

## [0.28.5](https://github.com/remidej/camox/compare/camox-v0.28.4...camox-v0.28.5) (2026-05-22)


### Bug Fixes

* list of optimized vite deps ([8a14bfa](https://github.com/remidej/camox/commit/8a14bfa1938af5fd2d98d839bf6117bf11ec1617))
* vite dependency in app template for yarn ([49e8cb0](https://github.com/remidej/camox/commit/49e8cb09fa94999369e45755f6338e8d76e2a99f))

## [0.28.4](https://github.com/remidej/camox/compare/camox-v0.28.3...camox-v0.28.4) (2026-05-22)


### Bug Fixes

* corepack support for all package managers ([4063d2d](https://github.com/remidej/camox/commit/4063d2db9a83b52dde2729d8ad7ee397df95c1f2))

## [0.28.3](https://github.com/remidej/camox/compare/camox-v0.28.2...camox-v0.28.3) (2026-05-20)


### Bug Fixes

* pnpm 11 security features breaking app creation ([7705647](https://github.com/remidej/camox/commit/7705647ad67beb80f57fb3e23b0b1ad40b6e9423))


### Miscellaneous

* set up grill-with-docs and CONTEXT.md ([f5d7df8](https://github.com/remidej/camox/commit/f5d7df8f9a834d5582026fea9b94177cbb4ad5f6))

## [0.28.2](https://github.com/remidej/camox/compare/camox-v0.28.1...camox-v0.28.2) (2026-05-19)


### Bug Fixes

* prevent unpublishing homepage ([79f7058](https://github.com/remidej/camox/commit/79f70588d19253d18ba72496a74150b776eddc61))


### Miscellaneous

* set pnpm 11 for created apps ([4e8b109](https://github.com/remidej/camox/commit/4e8b109950f61adf8efe28bc5552bb77fd94ea12))

## [0.28.1](https://github.com/remidej/camox/compare/camox-v0.28.0...camox-v0.28.1) (2026-05-19)


### Miscellaneous

* nicer environment compatibility error display ([cf126cf](https://github.com/remidej/camox/commit/cf126cfed37158a9bbc12f1d50d130afbf4b726b))
* upgrade all deps ([fead81a](https://github.com/remidej/camox/commit/fead81ab55a771bf1d75b467e9fa45535a22b883))
* upgrade to pnpm 11 ([219b369](https://github.com/remidej/camox/commit/219b3696b16297e3e16699ae2e4e1562928ed9a1))

## [0.28.0](https://github.com/remidej/camox/compare/camox-v0.27.0...camox-v0.28.0) (2026-05-18)


### Features

* add blocks get-many tool ([83e8c0a](https://github.com/remidej/camox/commit/83e8c0a7c485d50bba764abb9baa6b5d7a3bd073))
* **web:** add feature-video-grid block ([a74cf99](https://github.com/remidej/camox/commit/a74cf990fa11e790c3041884bf19668c9335bd6b))


### Bug Fixes

* caomx-cli skill description too long ([697fac0](https://github.com/remidej/camox/commit/697fac004c5396342b5deab8a3ee36db8a6e346b))
* enable publish button when changes are made ([bd6a7bd](https://github.com/remidej/camox/commit/bd6a7bd2c35d9a0526e5eda1f7828951df5717ea))
* replicate checkpoints when transferring environments ([d2bbaa8](https://github.com/remidej/camox/commit/d2bbaa83f84e9795761e054b6e9022d0397b305f))
* toggle agent chat action ([6b98c86](https://github.com/remidej/camox/commit/6b98c86b69adb95c04d7876b368284e1e81fcb25))

## [0.27.0](https://github.com/remidej/camox/compare/camox-v0.26.0...camox-v0.27.0) (2026-05-18)


### Features

* add page nickname concept ([478b61e](https://github.com/remidej/camox/commit/478b61e24ea9c91b5a1dcf9382882093c46c0853))
* add publish-related actions to command palette ([4139209](https://github.com/remidej/camox/commit/413920972a5a41e842eb38c7ebe863fa4babcea5))
* add unpublish and discard draft cli commands ([c6b15cb](https://github.com/remidej/camox/commit/c6b15cb790f0280790ff181b5f3bc5725a2c3902))
* unpublish and restore drafts ([5a1c6f5](https://github.com/remidej/camox/commit/5a1c6f51814e6eb6e7cfcb89fd8027e27e65e3c1))


### Bug Fixes

* circular dependency preventing api startup ([b439d47](https://github.com/remidej/camox/commit/b439d47fdd20ab2dc3494b3a3b0228a377222ae0))
* draft pages ssr ([1258180](https://github.com/remidej/camox/commit/125818007998a7c57aa24c4b558add3c5e58e3a4))
* preview sidebar ui tweaks ([ff5e8cd](https://github.com/remidej/camox/commit/ff5e8cdf182246459fc7bacc47d96b3b343f2e3d))
* stop triggering updates on lexical selection changes ([78de369](https://github.com/remidej/camox/commit/78de369398f8861ecf0b8634694ae673647db7d5))


### Miscellaneous

* delete implemented plan files ([f4f944c](https://github.com/remidej/camox/commit/f4f944cef2f0f1bf6daea478201764130b606620))
* remove greenish hue from accent colors ([7c02917](https://github.com/remidej/camox/commit/7c02917981265074b5a7258a5f6b8876ee573df2))
* update camox-cli for publishing workflows ([1ba85d9](https://github.com/remidej/camox/commit/1ba85d9e8ce1216dbe599c756de82fe24a818cc1))

## [0.26.0](https://github.com/remidej/camox/compare/camox-v0.25.0...camox-v0.26.0) (2026-05-18)


### Features

* **cli:** add --live flag and default to draft operations ([534e342](https://github.com/remidej/camox/commit/534e342caa095830b7893a22f24ad7cfdf873510))


### Bug Fixes

* publish initial pages on project creation ([c55b04a](https://github.com/remidej/camox/commit/c55b04a7c2a49f672281f299a0cc5ef239da683a))

## [0.25.0](https://github.com/remidej/camox/compare/camox-v0.24.1...camox-v0.25.0) (2026-05-18)


### Features

* add draft-publish status badges and preview toggle (phase 2) ([5cab5bf](https://github.com/remidej/camox/commit/5cab5bf54e328b4508aecb3ecd8b8de2478b1771))
* add publish button ([a609c74](https://github.com/remidej/camox/commit/a609c74b8d85482986b42ae67486ef43b459599a))
* add toggle live/draft content action and shortcut ([eecb5cc](https://github.com/remidej/camox/commit/eecb5cc2643872e558f50cdb388d21c7c50e284d))
* plumb draft-publish snapshots (phase 1) ([fd92d1b](https://github.com/remidej/camox/commit/fd92d1b678807010b701b7c0e7f9adaf618a5661))
* prevent edits when source is live ([8691030](https://github.com/remidej/camox/commit/86910300250f98cdab4dc8754debe772f7fa8f0c))
* publish layout changes ([3f9db46](https://github.com/remidej/camox/commit/3f9db46093f11253091c19d88f06c195da7cc650))


### Bug Fixes

* remove environment name from sidecar file ([d10e7be](https://github.com/remidej/camox/commit/d10e7be4f1521b6088c7624a3c489846da739571))
* scope block-definition lookups by environment ([a788bd1](https://github.com/remidej/camox/commit/a788bd1502036b42a7ad302e890725ae20ec0e1f))
* web app illustrated features double borders ([58be02d](https://github.com/remidej/camox/commit/58be02d8c9553675f163831b5f50a5795690f7aa))


### Miscellaneous

* draft and publish ui tweaks ([62e6ea5](https://github.com/remidej/camox/commit/62e6ea523d402f1060a018bae9599d13566faa12))
* plit up draft-publish plan file ([1b12ef7](https://github.com/remidej/camox/commit/1b12ef75c4c72d76ec5726d2c0a60e85a61d937b))
* replace draft select by live content switch ([bd05ef1](https://github.com/remidej/camox/commit/bd05ef11306d07f2b855dd4ffdc9b68cef34529e))

## [0.24.1](https://github.com/remidej/camox/compare/camox-v0.24.0...camox-v0.24.1) (2026-05-16)


### Bug Fixes

* add get block cli tool ([7f9f7ad](https://github.com/remidej/camox/commit/7f9f7ad97ec508cfe8dc860af003f8293a1e2e36))

## [0.24.0](https://github.com/remidej/camox/compare/camox-v0.23.0...camox-v0.24.0) (2026-05-16)


### Features

* custom per page opengraph image ([67bc8e0](https://github.com/remidej/camox/commit/67bc8e0c94eb8f27f4133425d2e0ed0e1c5c35d1))


### Bug Fixes

* don't optimize files below 50KB ([676b5c2](https://github.com/remidej/camox/commit/676b5c26bc85ac4119d976b44962024789930026))


### Miscellaneous

* nicer rendering of raster images in AssetCard ([d331336](https://github.com/remidej/camox/commit/d3313363e779e0afec1c654bcf14e5235a4685b7))

## [0.23.0](https://github.com/remidej/camox/compare/camox-v0.22.0...camox-v0.23.0) (2026-05-16)


### Features

* add env commands to cli ([449231c](https://github.com/remidej/camox/commit/449231c42b55b129d42df071a9eed545c6deb828))
* automatic image optimization ([0ce6e18](https://github.com/remidej/camox/commit/0ce6e18876792f937a1385e9a99a0ad9ac7723ee))
* serve LLM small version of images for img generation ([392b9a7](https://github.com/remidej/camox/commit/392b9a7e217af262b15877fd0704649e009ec02f))


### Bug Fixes

* make assets grid scrollable ([cce9198](https://github.com/remidej/camox/commit/cce9198e26ff31a4ee8caa7917f4db6cfa4326e2))
* only generate ai metadata for raster images ([8740973](https://github.com/remidej/camox/commit/8740973359012f8825354ecb21336b35b6ca5dcf))


### Miscellaneous

* **sdk:** revamp all Type list APIs for consistency ([181dc77](https://github.com/remidej/camox/commit/181dc7745c3cb5297b64bf3ed41c3f3893bef195))

## [0.22.0](https://github.com/remidej/camox/compare/camox-v0.21.0...camox-v0.22.0) (2026-05-15)


### Features

* favicon upload ([f37ac2f](https://github.com/remidej/camox/commit/f37ac2fdf214a94591a0b39301215deeed2fe6b9))
* render project favicon in camox pages ([b2ec6e5](https://github.com/remidej/camox/commit/b2ec6e5a25fd76e1f328eacbe0e4a44e570aeaf5))


### Bug Fixes

* **dashboard:** land on any org without 401 ([885dbd1](https://github.com/remidej/camox/commit/885dbd1a6b59a6710ed22cb0aa28118c416bb785))
* **web:** hero shader performance ([0147f5e](https://github.com/remidej/camox/commit/0147f5ed272d94601c05e2031d814da6224cac19))

## [0.21.0](https://github.com/remidej/camox/compare/camox-v0.20.0...camox-v0.21.0) (2026-05-13)


### Features

* **sync:** delete orphaned block definitions ([9db8bae](https://github.com/remidej/camox/commit/9db8baee4d506c8b87c93f1a1e11d0a2f7b64c5b))


### Bug Fixes

* takumi on workers using wasm everywhere ([63b915d](https://github.com/remidej/camox/commit/63b915d40ffe129da63171d669d4c8870f97c7f5))


### Miscellaneous

* tell agents not to author commits ([83b0d14](https://github.com/remidej/camox/commit/83b0d1490e52f78ff6b314625b4a4095f4ee92d5))

## [0.20.0](https://github.com/remidej/camox/compare/camox-v0.19.0...camox-v0.20.0) (2026-05-13)


### Features

* **environments:** add push/pull replication between dev and production ([c9a9de3](https://github.com/remidej/camox/commit/c9a9de30b889b1ac523e61257d6828c1d25a3490))


### Bug Fixes

* **sdk:** alias tslib to its ESM build for SSR ([aeaf963](https://github.com/remidej/camox/commit/aeaf9631cfde8328208ca0d56e681bd74c1f9f8e))
* **sdk:** avoid shiki onig.wasm load in SSR builds ([d6a8063](https://github.com/remidej/camox/commit/d6a80635ac72d5ccd2f1219a39ba63c2b0e0c16c))


### Refactoring

* **files:** skip R2 blob delete when a sibling row remains ([690c444](https://github.com/remidej/camox/commit/690c444988c1e5f96cf22ad18e4a4f7e39a9d8d8))


### Miscellaneous

* ui tweaks ([1cb638a](https://github.com/remidej/camox/commit/1cb638a3d481b50086395a8e4e0d442cf97b4e5f))

## [0.19.0](https://github.com/remidej/camox/compare/camox-v0.18.2...camox-v0.19.0) (2026-05-13)


### Features

* add borders to web blocks ([74379a3](https://github.com/remidej/camox/commit/74379a3218877a7c34c211727ce9173dd7f4e2e3))


### Bug Fixes

* asset lightbox and page metadata inputs debouncing ([cf385e6](https://github.com/remidej/camox/commit/cf385e68c1f7ce4a64a1a91aba21f39e833ae20b))
* avoid refetching layout blocks on other block update ([6938832](https://github.com/remidej/camox/commit/69388327741abdac5f20c0ba4f8f69bbef57de75))
* images markdown generation ([94ba7fe](https://github.com/remidej/camox/commit/94ba7fe4dd7ea926fc840c6412a71ad52df53b16))
* make media lib scrollable ([e9754d9](https://github.com/remidej/camox/commit/e9754d94f5d6f346d33117653cc551d78c382623))


### Miscellaneous

* tweak competitor blocks ([0597b5a](https://github.com/remidej/camox/commit/0597b5aba1de76b4c25f86c1b68d0e806317a456))
* tweak web app blocks ([35912a2](https://github.com/remidej/camox/commit/35912a23c1b7df4d2d5cd6fdf49deb72dacb4df8))

## [0.18.2](https://github.com/remidej/camox/compare/camox-v0.18.1...camox-v0.18.2) (2026-05-12)


### Bug Fixes

* create separate tmp vite cache dir during definitions sync ([185d444](https://github.com/remidej/camox/commit/185d44410bafabd8b0227889d0268dcb1e78cd42))


### Miscellaneous

* remove nitro from apps to prevent vite 504 ([fd3cb82](https://github.com/remidej/camox/commit/fd3cb82773fcd4484a8509aab7dfb1b5c0735a8b))
* restore nitro plugin ([48bc894](https://github.com/remidej/camox/commit/48bc894938f78bbc3a8f16e9c1f787d0ea26381e))

## [0.18.1](https://github.com/remidej/camox/compare/camox-v0.18.0...camox-v0.18.1) (2026-05-11)


### Bug Fixes

* posthog telemetry url ([bc77c75](https://github.com/remidej/camox/commit/bc77c75761f6aed55a7d7b4c659362b034e8a8cc))
* vite optimizeDeps 504 breaking hydration ([0befc68](https://github.com/remidej/camox/commit/0befc68fd908a0a7654f3dd5e425f53c52cfef2a))

## [0.18.0](https://github.com/remidej/camox/compare/camox-v0.17.7...camox-v0.18.0) (2026-05-10)


### Features

* **web:** add youtube demo block ([9057270](https://github.com/remidej/camox/commit/90572704b998b1642a109903a5082305b8163d37))


### Bug Fixes

* hydrate nested repeatable items ([909f990](https://github.com/remidej/camox/commit/909f9905e767adb23207f2d179424e7e6e4eaeb2))
* multiple assets bugs and api ([0815a17](https://github.com/remidej/camox/commit/0815a17f1fa6ca4efc7258ff4f6ca9af76a3ec6c))


### Documentation

* expand README with features and links ([3e1c2ef](https://github.com/remidej/camox/commit/3e1c2ef2ae174a3de23ea1024adc304bed9df13f))


### Miscellaneous

* add multiple assets to fieldTypes ([e94b28e](https://github.com/remidej/camox/commit/e94b28ee698b19be9a5140cbd3e8c5c963608958))

## [0.17.7](https://github.com/remidej/camox/compare/camox-v0.17.6...camox-v0.17.7) (2026-05-07)


### Bug Fixes

* template-default outline button style ([e2deb52](https://github.com/remidej/camox/commit/e2deb52b548cdbb310bde3517c33094136ddf503))


### Miscellaneous

* add warp environemnt ([fa50199](https://github.com/remidej/camox/commit/fa50199d7be2f95b3d6891682fb0221adddf39cd))

## [0.17.6](https://github.com/remidej/camox/compare/camox-v0.17.5...camox-v0.17.6) (2026-05-07)


### Bug Fixes

* pin xstate store dep ([ae4daa0](https://github.com/remidej/camox/commit/ae4daa00fb9eb18bf0703d480efd634f41fdb701))

## [0.17.5](https://github.com/remidej/camox/compare/camox-v0.17.4...camox-v0.17.5) (2026-05-07)


### Bug Fixes

* dropping into created dir ([088fffd](https://github.com/remidej/camox/commit/088fffdba25b6fcaa4f9813671c758fb00ff81c4))

## [0.17.4](https://github.com/remidej/camox/compare/camox-v0.17.3...camox-v0.17.4) (2026-05-07)


### Bug Fixes

* process not closing on startup ([23df11e](https://github.com/remidej/camox/commit/23df11e3f2bb5072a83a5e2912a8a795374a76e2))

## [0.17.3](https://github.com/remidej/camox/compare/camox-v0.17.2...camox-v0.17.3) (2026-05-07)


### Bug Fixes

* add esbuild to api-contract ([dd53c4c](https://github.com/remidej/camox/commit/dd53c4cff7dd7b0e2c25b017e4ec07d88d6bff29))

## [0.17.2](https://github.com/remidej/camox/compare/camox-v0.17.1...camox-v0.17.2) (2026-05-07)


### Bug Fixes

* posthog public key not in build ([05353c1](https://github.com/remidej/camox/commit/05353c184d1887e344216610e8ece36ebfb7e348))

## [0.17.1](https://github.com/remidej/camox/compare/camox-v0.17.0...camox-v0.17.1) (2026-05-07)


### Bug Fixes

* generate block summaries on initial content ([0b5d6c0](https://github.com/remidej/camox/commit/0b5d6c0e988320bf01dd16f0b71f71bcc07da07d))


### Miscellaneous

* more tracking events ([69c81ab](https://github.com/remidej/camox/commit/69c81ab36ec65f1f181fe2aeb7203697f3fe28d6))
* rename analytics to telemetry ([cdc7f9d](https://github.com/remidej/camox/commit/cdc7f9d359a9dd979b2f64d1e564717f6429fddb))

## [0.17.0](https://github.com/remidej/camox/compare/camox-v0.16.1...camox-v0.17.0) (2026-05-06)


### Features

* add lexical history plugin ([40cf4f9](https://github.com/remidej/camox/commit/40cf4f9629a0a4ea6aba0ed8964c6cf7a4ca790b))


### Miscellaneous

* refine default template design ([9f219b4](https://github.com/remidej/camox/commit/9f219b4f9b8250207978d01674d0a4c78c004570))

## [0.16.1](https://github.com/remidej/camox/compare/camox-v0.16.0...camox-v0.16.1) (2026-05-05)


### Miscellaneous

* improve template-default ([ab38c73](https://github.com/remidej/camox/commit/ab38c731ba3e28ee639cf6a487252073f61b42ad))
* upgrade to @xstate/store-react dep ([802fb44](https://github.com/remidej/camox/commit/802fb441882f4dc86308fc115e638af3dc14a807))

## [0.16.0](https://github.com/remidej/camox/compare/camox-v0.15.1...camox-v0.16.0) (2026-05-05)


### Features

* add repeatable item buttons to dedicated content sheet view ([b2130af](https://github.com/remidej/camox/commit/b2130af1d4911756e6fc98c3a8c0a473405ad19e))
* add repeatable item buttons to FieldToolbar ([c3ee694](https://github.com/remidej/camox/commit/c3ee694816fdbb4d9581764a75e3dd0b26448741))


### Bug Fixes

* accidental dark theme ([251d139](https://github.com/remidej/camox/commit/251d139ba610bf31421efb10bb528ecd4f8befa2))
* display loader when creating repeatable item ([98437e6](https://github.com/remidej/camox/commit/98437e68a2788ecaa4d84c9eb04bacd0a61bbd50))
* fewer tool calls needed to edit content ([60b9c2f](https://github.com/remidej/camox/commit/60b9c2fbaa5fe3987c78c63b2d926c4ed4f6bef3))
* prevent ai from making up files ([2843f38](https://github.com/remidej/camox/commit/2843f38e313048f650ddd4a67dc4b3722f7e40e4))
* skill formatting issues ([b0d31cf](https://github.com/remidej/camox/commit/b0d31cfa268eaef6bda9915de110c579560efa29))


### Miscellaneous

* add new web app blocks ([44c0b42](https://github.com/remidej/camox/commit/44c0b42d473b02c5ac614f324ef714fd21af72c5))
* fix check script ([dc12bcb](https://github.com/remidej/camox/commit/dc12bcb6113345227032f41419ec57666e1e7862))
* make template app runnable ([deeac4c](https://github.com/remidej/camox/commit/deeac4ccfe4b30dc989083ebe2e901cd2262762e))
* set up vite plus ([bd1d4f1](https://github.com/remidej/camox/commit/bd1d4f1c5a938cf0dde44cb764583bf524aee1af))

## [0.15.1](https://github.com/remidej/camox/compare/camox-v0.15.0...camox-v0.15.1) (2026-04-30)


### Bug Fixes

* remove metadata cli commands ([f63eaca](https://github.com/remidej/camox/commit/f63eacaf71464730e9d97e258eba6d4670a2cdfd))


### Miscellaneous

* promote the cli in-app ([7deb631](https://github.com/remidej/camox/commit/7deb631f7903fff7f30e42d03c6886df9292b683))

## [0.15.0](https://github.com/remidej/camox/compare/camox-v0.14.2...camox-v0.15.0) (2026-04-30)


### Features

* add api tools to cli ([2d96fd1](https://github.com/remidej/camox/commit/2d96fd10ad02d1c326c1c7b338bf7b1ac6641149))
* add camox-cli skill to camox apps ([039dcfe](https://github.com/remidej/camox/commit/039dcfe83b4ef4fc675f28886f49bcd3cd0287fe))
* add path option to get page cli command ([e11ae86](https://github.com/remidej/camox/commit/e11ae864c9fecaf5cd213f2c84b95593a94622e4))
* make cli environment aware ([98f1c40](https://github.com/remidej/camox/commit/98f1c407b4d4e87d91ea11d381832100d118a94a))
* two-step cli block type discovery ([8af588d](https://github.com/remidej/camox/commit/8af588de61d2feb58347aa4121b6bb3c4805768b))


### Bug Fixes

* block-per-block get page cli command ([8a9433f](https://github.com/remidej/camox/commit/8a9433fcf5c87bf6ed4db7a05622d4fdf3fce79c))
* image component not aware of repeater context ([b4743d7](https://github.com/remidej/camox/commit/b4743d7746b41e47a805c3afb1ac0a1073ff5a83))
* page deletion ([7d232f2](https://github.com/remidej/camox/commit/7d232f219b5fbe98bcf9604abddb177272416c84))


### Miscellaneous

* add web favicon ([cc00036](https://github.com/remidej/camox/commit/cc00036003397a4a034ab562ce5d53df17d1a151))
* **api:** extract service layer for pages ([a0cf5b2](https://github.com/remidej/camox/commit/a0cf5b20aba312148e99de6a1faa7e360172a36a))
* extract blocks services ([5c9a1b9](https://github.com/remidej/camox/commit/5c9a1b9fe316131db40a801e91b9b7a67e53479a))
* extract service file for all other api domains ([3972048](https://github.com/remidej/camox/commit/3972048fa0462739a7505749d166ec9bdffffe87))
* misc improvements ([32306e6](https://github.com/remidej/camox/commit/32306e6e724b7974c3d0cd6a03dd993de6b67000))
* set up agentic tools ([a641af4](https://github.com/remidej/camox/commit/a641af4fba7f5fd3b2320ced963b3e07fa74ac1f))

## [0.14.2](https://github.com/remidej/camox/compare/camox-v0.14.1...camox-v0.14.2) (2026-04-28)


### Bug Fixes

* broken css import in template ([be42c5f](https://github.com/remidej/camox/commit/be42c5f72b0a4e96bfc5f8c64fe4e670a98d28ef))

## [0.14.1](https://github.com/remidej/camox/compare/camox-v0.14.0...camox-v0.14.1) (2026-04-28)


### Bug Fixes

* deleting files used in repeatable items ([d609e16](https://github.com/remidej/camox/commit/d609e16988e346a80fdd85a5f152fcd912ac2b56))
* file asset swap ([57ad5ce](https://github.com/remidej/camox/commit/57ad5cebf37aea266588b81bc78b785a1b52abfc))
* sdk papercuts ([28dc8d7](https://github.com/remidej/camox/commit/28dc8d75c47839da5f19c369035d8a83c0b64203))


### Miscellaneous

* **api:** refactor structure to domain directories ([68a957b](https://github.com/remidej/camox/commit/68a957bd6a4b02bf6ad81295e4c086b3a701ae6d))

## [0.14.0](https://github.com/remidej/camox/compare/camox-v0.13.0...camox-v0.14.0) (2026-04-27)


### Features

* conditional toMarkdown based on settings ([544b0e6](https://github.com/remidej/camox/commit/544b0e6b01662ac78da5b28d01ab8f50c90c1c3d))
* repetable item level settings ([5f27cc5](https://github.com/remidej/camox/commit/5f27cc5aef3f2a54a680736528569bd44991da03))
* revamp illustrated features block ([8c843e0](https://github.com/remidej/camox/commit/8c843e0925347a6c61f5111ca1ca375e08459538))


### Bug Fixes

* cli template lsp errors ([593eb0e](https://github.com/remidej/camox/commit/593eb0e8a2ea47596f00937e457acdc5ab0d8fd3))
* inline text overlays ([02de1b5](https://github.com/remidej/camox/commit/02de1b5136b8126d297d21b52a1af638e4507ea6))
* merge settings on update ([a1ca22d](https://github.com/remidej/camox/commit/a1ca22d9fccd6f1d4c615047449e6df5a34017f1))

## [0.13.0](https://github.com/remidej/camox/compare/camox-v0.12.1...camox-v0.13.0) (2026-04-24)


### Features

* add field toolbar ([b9d8612](https://github.com/remidej/camox/commit/b9d8612dbf998e448bd40b06e464ae3580929a65))
* alternate illustrated features layout sides ([04c75a5](https://github.com/remidej/camox/commit/04c75a5b7dfb828f26bfe3a5aa728132740e47dc))
* support line breaks ([c24ed66](https://github.com/remidej/camox/commit/c24ed667fa74921a2d42c1bbd87a08ac3e44b1e3))
* **web:** add new blocks ([cf90a11](https://github.com/remidej/camox/commit/cf90a11c51f4b9a20e9dbe54278b415f8484f5d5))


### Bug Fixes

* ai jobs in production ([8924d22](https://github.com/remidej/camox/commit/8924d22455c875b027a8684db78ee5289e43a5b3))
* dev server leaking into prod deployments ([92fc8b4](https://github.com/remidej/camox/commit/92fc8b48e2e2b3404932b93d63da105cb4a7fd3c))
* remove backdrop blur for performance ([8897627](https://github.com/remidej/camox/commit/8897627235b9bc9c70048aae93b60965f6f7c3e1))


### Miscellaneous

* **web:** add large-paragraphs-group block ([20b6ab2](https://github.com/remidej/camox/commit/20b6ab28313577c744d70e6d74467ea86863dee9))

## [0.12.1](https://github.com/remidej/camox/compare/camox-v0.12.0...camox-v0.12.1) (2026-04-23)


### Miscellaneous

* set up nx groups ([2e2128a](https://github.com/remidej/camox/commit/2e2128a80133c7c9e599d85ef855223aefb64d4c))

## [0.12.0](https://github.com/remidej/camox/compare/camox-v0.11.0...camox-v0.12.0) (2026-04-23)


### Features

* add faq block ([0daa3d6](https://github.com/remidej/camox/commit/0daa3d6f42dd3e3c28bf59500dc2d39531709602))
* add selling points grid ([af1d869](https://github.com/remidej/camox/commit/af1d869e32562e391ddde958329eb382e1c4cbce))
* add terminal command to hero component ([f5d754b](https://github.com/remidej/camox/commit/f5d754b8678e8ebf6f443bd016509ae1f562ff2a))
* **web:** add cool blocks and shaders ([7a020ad](https://github.com/remidej/camox/commit/7a020ad0d071749e086d5df0d97172e82ad227d9))


### Bug Fixes

* stop assuming the build camox environment ([b99b2e8](https://github.com/remidej/camox/commit/b99b2e856d748200c3a13c1f5827d3390aefcb81))


### Miscellaneous

* merge Type.RepeatableItem params ([42c418e](https://github.com/remidej/camox/commit/42c418e0f726ceedd27050f7c873648ca634dc78))
* remove cmd+escape shortcut in favor of cmd+enter ([eb9de35](https://github.com/remidej/camox/commit/eb9de350e5c20c8e9215991c356c4f3b5beb228b))
* **web:** init camox app ([d32518c](https://github.com/remidej/camox/commit/d32518c43ab8dd5e7e361a3514e3079328e8e03d))
* **web:** ui tweaks ([7c16f65](https://github.com/remidej/camox/commit/7c16f65af2432c01da2c1334976ce2da48b6e3d9))

## [0.11.0](https://github.com/remidej/camox/compare/camox-v0.10.1...camox-v0.11.0) (2026-04-20)


### Features

* **camox:** new toMarkdown type safe builder api ([5b0f18e](https://github.com/remidej/camox/commit/5b0f18e55850ae685eab0a1f633560fbab9017b8))


### Bug Fixes

* race condition breaking partykit in prod ([6ea3dfa](https://github.com/remidej/camox/commit/6ea3dfaf7569180239a90640f87960c72e2c4682))
* sidebar lexical editor losing focus ([420264d](https://github.com/remidej/camox/commit/420264de34ea8b530ed0f27bbe5ca05a69464888))

## [0.10.1](https://github.com/remidej/camox/compare/camox-v0.10.0...camox-v0.10.1) (2026-04-20)


### Bug Fixes

* remaining hydration issues ([4432899](https://github.com/remidej/camox/commit/4432899f846491607cbbadeb4fce0485cdd6796c))
* ssr Link href ([3015859](https://github.com/remidej/camox/commit/3015859946421702fe44d12c0f6a507433415c31))


### Miscellaneous

* remove concurrently ([4c94d95](https://github.com/remidej/camox/commit/4c94d95c1efa3301a8ce81c29de4c24e5d89785e))

## [0.10.0](https://github.com/remidej/camox/compare/camox-v0.9.1...camox-v0.10.0) (2026-04-19)


### Features

* **sdk:** add error boundary for each block ([48f04a8](https://github.com/remidej/camox/commit/48f04a81f5ce02095c1afbdf8c739478eeb2c2db))


### Bug Fixes

* debounced LinkFieldEditor url ([465db76](https://github.com/remidej/camox/commit/465db76647c9983bd33c183694c80a858e8c0c03))
* various bugs ([86e66ba](https://github.com/remidej/camox/commit/86e66badfc79030e49513d5403fe7089b12814fd))
* vite optimizer causing page reloads in dev ([6b62b5c](https://github.com/remidej/camox/commit/6b62b5c476b29b468c402440592c02f43fb22637))
* websocket authentication ([d6f6ccc](https://github.com/remidej/camox/commit/d6f6ccc48ff0e21d6071736c5298a246fdd996f5))


### Miscellaneous

* add BeforeBlocks and AfterBlocks to createLayout instead of individual references ([7c44700](https://github.com/remidej/camox/commit/7c447001397052958240ce33b9efdec57023da43))
* clean up api surface of createBlock and createLayout using _internal in return value ([71f8d8f](https://github.com/remidej/camox/commit/71f8d8f5a0987d4e00b7c793b1f57a1b97f7d6df))
* convert create page sheet to modal ([40463a3](https://github.com/remidej/camox/commit/40463a3143cd16a4b0e2bed99668a2733dd847e8))
* convert edit page sheet to modal ([487b0a5](https://github.com/remidej/camox/commit/487b0a5a664fcfe821289a877f3c66156067dd05))
* misc fixes ([6fced4b](https://github.com/remidej/camox/commit/6fced4bf0ff5b56cd58bb8ed3098638daf7fd7fb))
* move createLayout initial blocks to blocks object ([c4b6d96](https://github.com/remidej/camox/commit/c4b6d96dfa2566d9841928bfbd747ca4402454a0))
* remove PageTree prop drilling ([1e1e6fd](https://github.com/remidej/camox/commit/1e1e6fdf4a3aab7b15d8c5ebdb2979f632f047f9))
* scope partykit rooms by environment instead of project ([a316561](https://github.com/remidej/camox/commit/a31656130032fe206bc9758022b6ac5a9f501098))
* store ids as numbers in selection state ([7892ff0](https://github.com/remidej/camox/commit/7892ff0dc19c986238fb5d774352d37c093fcf65))

## [0.9.1](https://github.com/remidej/camox/compare/camox-v0.9.0...camox-v0.9.1) (2026-04-18)


### Bug Fixes

* broken websocket in production ([b19d70b](https://github.com/remidej/camox/commit/b19d70b94790e225bdeb8617bf5972ba211514f0))
* cascading deletes on block deletion ([6df62c2](https://github.com/remidej/camox/commit/6df62c26b583a70d76d2ca28a9a9e045e70e08f6))
* create missing layout blocks on sync ([dc1373a](https://github.com/remidej/camox/commit/dc1373af592956d6835eaabcae217dc7c86b404d))
* layout block creation ([4e8a481](https://github.com/remidej/camox/commit/4e8a481bab937e8d58e457ac64a765e10ad9abc6))
* peeked page not clearing on popover close ([2019751](https://github.com/remidej/camox/commit/20197515b36b31fba7074afb5753777df83ebb38))
* show sign in toast to unauthenticated users in dev ([d64549e](https://github.com/remidej/camox/commit/d64549eaf1261d4b5664d4d23c8b26546d5ae3f2))


### Miscellaneous

* extract pathless authorize layout ([f2ff4a1](https://github.com/remidej/camox/commit/f2ff4a108f73a159e19aea9f523a245a77ac7b80))
* fix auth client type safety ([0084668](https://github.com/remidej/camox/commit/0084668e48137f49ec9024468758437c741209cf))
* run studio in api dev script via concurrently ([fe92458](https://github.com/remidej/camox/commit/fe92458391522e8cf67a9a5f8d71fe38b46f4ae7))
* **web:** organize route files in folders ([ee93ee8](https://github.com/remidej/camox/commit/ee93ee8450ebfcee8b2b8aa2cc574c7041ae0980))

## [0.9.0](https://github.com/remidej/camox/compare/camox-v0.8.0...camox-v0.9.0) (2026-04-17)


### Features

* custom created project slug ([94ace3a](https://github.com/remidej/camox/commit/94ace3af04d92412e7c1324237bbe47033a8ccaf))


### Bug Fixes

* cors auth issues ([300d54e](https://github.com/remidej/camox/commit/300d54ed16767370514450626c6b4a6cdd5f7988))
* web app ui issues ([88f1454](https://github.com/remidej/camox/commit/88f1454e604878dfb802ac94da8dea1e7df90600))

## [0.8.0](https://github.com/remidej/camox/compare/camox-v0.7.3...camox-v0.8.0) (2026-04-16)


### Features

* add studio-authorize consent page ([48176ee](https://github.com/remidej/camox/commit/48176ee3123f3b5675ec3b1fa7a7acdb0aa60cc6))


### Miscellaneous

* refactor dashboard ui ([7064401](https://github.com/remidej/camox/commit/70644017a8b58552822233a37c14a77dd92fa39d))
* rename web app routes project param ([00c08c7](https://github.com/remidej/camox/commit/00c08c76126e212bf3e396b888c39c40ed502be2))
* use ui package tabs on web app ([5dee4e9](https://github.com/remidej/camox/commit/5dee4e94f434913d056922acb3f687c7f47e7266))
* various improvements ([5fbdb6a](https://github.com/remidej/camox/commit/5fbdb6a12d1423b2c5921c5a044603616ce1877d))

## [0.7.3](https://github.com/remidej/camox/compare/camox-v0.7.2...camox-v0.7.3) (2026-04-16)


### Bug Fixes

* css build error on created apps ([f5fb662](https://github.com/remidej/camox/commit/f5fb6624f007658bb8caea56653cebb396964b9d))

## [0.7.2](https://github.com/remidej/camox/compare/camox-v0.7.1...camox-v0.7.2) (2026-04-16)


### Miscellaneous

* build css with tailwindcss cli ([6fb99c6](https://github.com/remidej/camox/commit/6fb99c6691505e675275d27609d3a33d9beeed89))
* migrate sdk to tsdown build pipeline ([ef339c6](https://github.com/remidej/camox/commit/ef339c68b9ab5f5dbd456d8a23812da04a8ccd7d))

## [0.7.1](https://github.com/remidej/camox/compare/camox-v0.7.0...camox-v0.7.1) (2026-04-16)


### Miscellaneous

* add api contract package ([491ef44](https://github.com/remidej/camox/commit/491ef44c119f28a2f3ccecb34b8cdbcf632849e1))

## [0.7.0](https://github.com/remidej/camox/compare/camox-v0.6.1...camox-v0.7.0) (2026-04-16)


### Features

* add disabeCodeGen _internal option to vite ([c2a96c3](https://github.com/remidej/camox/commit/c2a96c3dd0b93896b8a66ebfbcf2337cfb2faf91))


### Bug Fixes

* post base ui migration tweaks ([0d72dee](https://github.com/remidej/camox/commit/0d72dee380b304770769d54bb6c0770a3c73e654))
* remaining asChild in blocks ([f7e7d82](https://github.com/remidej/camox/commit/f7e7d82f0cf8302f2249c7cc8d0e8f1774495927))
* some cli template issues ([359f00f](https://github.com/remidej/camox/commit/359f00f4f83f618d35ae09f64adf6df1f7011b35))


### Miscellaneous

* delete unused ui components ([d49eb32](https://github.com/remidej/camox/commit/d49eb32aa8f40d467ed10767bbfa194c6f8ec2a6))
* migrate app template to base ui ([4f470a4](https://github.com/remidej/camox/commit/4f470a40f77a100dc65ea8a07f13123202f2782e))
* migrate popover to base ui ([826aae6](https://github.com/remidej/camox/commit/826aae69222c4906b932514d2512160e524197ae))
* migrate ui package to base ui ([24439ee](https://github.com/remidej/camox/commit/24439eecc426b72f8136d4217792847c3a0ace34))
* **ui:** migrate avatar component to base ui ([e7316b1](https://github.com/remidej/camox/commit/e7316b1ac69c71240818109410f1df1698013933))
* use css for overlay styles instead of inline style tags ([827dbf4](https://github.com/remidej/camox/commit/827dbf4cece76fc3f403f2f366678541abe5dbf4))
* use render prop based api for editable components instead of radix slot ([33ae569](https://github.com/remidej/camox/commit/33ae5698307333dbec9b9e4c1ab78b339be3f889))

## [0.6.1](https://github.com/remidej/camox/compare/camox-v0.6.0...camox-v0.6.1) (2026-04-14)


### Bug Fixes

* definitions sync nitro support ([84021d9](https://github.com/remidej/camox/commit/84021d9d3ef4edb69b462a8096041f1505e5124a))

## [0.6.0](https://github.com/remidej/camox/compare/camox-v0.5.2...camox-v0.6.0) (2026-04-14)


### Features

* manage multiple auth providers in auth.json file ([3528ea5](https://github.com/remidej/camox/commit/3528ea5f75b08edf61bfa16d5d19cffc8505e51e))


### Bug Fixes

* force useSyncExternalStore via react and not shim package ([cd1b72c](https://github.com/remidej/camox/commit/cd1b72cbee73da41602b579e7b328b4d92a07ba0))
* sign up when running init cli ([5777dfa](https://github.com/remidej/camox/commit/5777dfa58fb0cc89ae7ed342f56e90757047125e))

## [0.5.2](https://github.com/remidej/camox/compare/camox-v0.5.1...camox-v0.5.2) (2026-04-14)


### Bug Fixes

* set up nitro for generated apps ([711a5cd](https://github.com/remidej/camox/commit/711a5cd06e602ad81b8ea7095c25437d1875a624))

## [0.5.1](https://github.com/remidej/camox/compare/camox-v0.5.0...camox-v0.5.1) (2026-04-14)


### Bug Fixes

* cli package export ([752d983](https://github.com/remidej/camox/commit/752d983cc42108b09885eec26f82b4b64a71577a))

## [0.5.0](https://github.com/remidej/camox/compare/camox-v0.4.2...camox-v0.5.0) (2026-04-14)


### Features

* set up vite plus in created apps ([97ee8f1](https://github.com/remidej/camox/commit/97ee8f1d1eb7f7bbe958170a1651c667525acdb1))


### Bug Fixes

* **cli:** broken init command ([4737da3](https://github.com/remidej/camox/commit/4737da36cc5b5e4733532486bad1554bb2997870))
* ensure cli-authorize is authenticated ([a541ef3](https://github.com/remidej/camox/commit/a541ef37e4b1cac48475a5bef1325e95823f6651))
* error on cli init control+c ([5f1ab77](https://github.com/remidej/camox/commit/5f1ab774fc22f0b856a7f5938f95e3473ceb04fe))


### Miscellaneous

* **cli:** migrate to tsdown ([3ce10f6](https://github.com/remidej/camox/commit/3ce10f6f2e281eada74a29ae5482b4ecbe5beb54))

## [0.4.2](https://github.com/remidej/camox/compare/camox-v0.4.1...camox-v0.4.2) (2026-04-13)


### Bug Fixes

* add create-camox to release-please config ([45212d1](https://github.com/remidej/camox/commit/45212d140ef1952ac69d4fbe30489ede1a64f587))

## [0.4.1](https://github.com/remidej/camox/compare/camox-v0.4.0...camox-v0.4.1) (2026-04-13)


### Bug Fixes

* cli template ([6e7147d](https://github.com/remidej/camox/commit/6e7147dc2a175c79dd4e225f7d09f1e826436fc7))


### Miscellaneous

* add create-camox alias package ([c3e9cd0](https://github.com/remidej/camox/commit/c3e9cd0222c19ceb6a1bd6e35eec99cf317a6638))

## [0.4.0](https://github.com/remidej/camox/compare/camox-v0.3.1...camox-v0.4.0) (2026-04-13)


### Features

* **sdk:** add powered by camox link ([7fb2e8a](https://github.com/remidej/camox/commit/7fb2e8a2b28fb43de041d4dfce1d4b5ea9df574f))
* **web:** project deletion ([f84688a](https://github.com/remidej/camox/commit/f84688a579c82bb67b0cf07b87e780ec5f088459))


### Bug Fixes

* add query client to cli template ([5e7bf26](https://github.com/remidej/camox/commit/5e7bf2623cd864b550155251dc9ee5b8561869fa))
* **cli:** remove broken package manager detection ([8d1a8b7](https://github.com/remidej/camox/commit/8d1a8b74717e53e3d7d8cd57e7d5cdc2ff649fd2))
* **cli:** write camox sync secret to gitignored .env file ([440653d](https://github.com/remidej/camox/commit/440653d860899234551e016d7be24de76f89110e))


### Miscellaneous

* remove definitionsSync from camox vite options ([7c3411f](https://github.com/remidej/camox/commit/7c3411fce9519807d4c7a3a1149580306bea621a))

## [0.3.1](https://github.com/remidej/camox/compare/camox-v0.3.0...camox-v0.3.1) (2026-04-13)


### Bug Fixes

* **web:** project settings ui tweaks ([e96c2b3](https://github.com/remidej/camox/commit/e96c2b39af3459c2960b3a168323c0baf24057e9))


### Miscellaneous

* drop extraneous typescript dependency ([4189347](https://github.com/remidej/camox/commit/41893478954f0cc4baaf9de61d41e997394f1eb3))
* set up rolldown react compiler ([ec250f6](https://github.com/remidej/camox/commit/ec250f6dbf2f8b2e33f34ded8c2183adb3090eef))
* upgrade all deps ([7155d86](https://github.com/remidej/camox/commit/7155d863e1fd617db6a4312b33daad4d047b5fc8))
* use react stable version ([2414936](https://github.com/remidej/camox/commit/24149362afa636eadb9c3eda0d15815cd0b2cb90))

## [0.3.0](https://github.com/remidej/camox/compare/camox-v0.2.0...camox-v0.3.0) (2026-04-12)


### Features

* add authentication to create-camox cli ([093ede4](https://github.com/remidej/camox/commit/093ede4dbdfa0017cd9b5977e1a2179a49b4a248))
* add dedicated environment menu to navbar ([9d0fffa](https://github.com/remidej/camox/commit/9d0fffa3577819e95430fe1d8238121fd5994d87))
* add environments concept to scope db per-user in dev ([40f1b11](https://github.com/remidej/camox/commit/40f1b113f473ca1af9468bfce5a711e7c906a8de))
* add itialBlocks to createLayout for declarative initial content generation ([27ded94](https://github.com/remidej/camox/commit/27ded94210d958d02a9bb5a7cb822b381ff04a1b))
* add org switcher to dashboard navbar ([4ad6d29](https://github.com/remidej/camox/commit/4ad6d29388e6385750e0718b53f8635c3da2f3f6))
* add page metadata button to sidebar ([622ed83](https://github.com/remidej/camox/commit/622ed83197d171a44812eb464b541736a6a876a7))
* add project creation guide to web app ([aaadcb0](https://github.com/remidej/camox/commit/aaadcb03c6c2454f96206f31e3205050c8227555))
* add sitemap util ([7fbf740](https://github.com/remidej/camox/commit/7fbf740b2a19d6762c03044dcd59217049a6b811))
* ai features in api with durable object alarms ([eb66c75](https://github.com/remidej/camox/commit/eb66c758b789e5b46f50e6e35d998ec971ca6753))
* auto create org on signup ([4acb6ca](https://github.com/remidej/camox/commit/4acb6cabcd3cdc6e563d10c5cc5a130119c3971d))
* auto generate project initial content in vite plugin ([18d0599](https://github.com/remidej/camox/commit/18d059981e1e629d64dc1fc6891d284eefcbe8da))
* auto select first project ([47e166a](https://github.com/remidej/camox/commit/47e166ae929df895e7c300498aea903547ec22c6))
* **cli:** add login and logout commands ([3461d76](https://github.com/remidej/camox/commit/3461d76796a0219e9a286bff3754fa2e8dae2510))
* create org in org picker ([b5a0fb1](https://github.com/remidej/camox/commit/b5a0fb13b8d2db6a1119599996acc7eb2ad3e47b))
* introduce sync secret to authenticate definition routes ([70251f2](https://github.com/remidej/camox/commit/70251f262c8f19961f1b7c50470f3977ab1eacb7))
* make create-camox auto run app ([ede571b](https://github.com/remidej/camox/commit/ede571b8b8eda3fc931409d6ae6997ae1702d1fd))
* **sdk:** add partykit query invalidation ([7828774](https://github.com/remidej/camox/commit/7828774666f4e07cfa19071eb69b4bc2dcb0450c))
* server project creation in cli ([5a5138a](https://github.com/remidej/camox/commit/5a5138ae2a169de1e486e719a4471f1374f424e6))
* set up cli package and sdk reexport ([b5c0493](https://github.com/remidej/camox/commit/b5c0493464ab0e9ec8b02d159573f43111033c43))
* show sync secret in project dashboard ([3675495](https://github.com/remidej/camox/commit/36754951775553a0ad2b4f1edf89facd8e99c1af))
* store default content in block definitions ([b1d8657](https://github.com/remidej/camox/commit/b1d865716a4569c2334b9f1731fc306b83c8292f))


### Bug Fixes

* add org-based permission checks ([3a032cc](https://github.com/remidej/camox/commit/3a032cc36c14982d9e4352f057a4a9d10e3abda3))
* **api:** ai image metadata generation ([08da599](https://github.com/remidej/camox/commit/08da599803fc73f1a54d2407117bb8f14c75d4a0))
* **api:** corrupt data in seeded blocks ([df0b9ca](https://github.com/remidej/camox/commit/df0b9cab7ffda800a2df110764cee675e719ad39))
* authenticate seed route ([92ce5a1](https://github.com/remidej/camox/commit/92ce5a183f431ce86796f685543c7db8e64cd3e7))
* block reordering and upload ([7ba5534](https://github.com/remidej/camox/commit/7ba5534d5ffdf536b9616ca0007ae9d29f1af9d5))
* blocks reordering ([61a9f71](https://github.com/remidej/camox/commit/61a9f71a857e0c3f87b04d8e7f02fac89c5003fa))
* breadcrumbs performance ([e4fbdde](https://github.com/remidej/camox/commit/e4fbdde2d1db37e09cf6fd877ed35113cd73749e))
* broken cli when auth session expires ([c9ef4a8](https://github.com/remidej/camox/commit/c9ef4a88b8fdf1825c2584a44f1e24ef6124c35f))
* bulk delete files ([4001898](https://github.com/remidej/camox/commit/4001898911e14e6352a4e748c7d841cba7909a8c))
* clean up references on file delete ([1954831](https://github.com/remidej/camox/commit/19548313dd4dc1d179444ccf322487f4ed475d84))
* cli auth ([2f70ab0](https://github.com/remidej/camox/commit/2f70ab0f604e5e98af73ca29324b71a953476327))
* convex _id to d1 id ([c4654c7](https://github.com/remidej/camox/commit/c4654c700aa72c3d39db4397c6d4244fa898ee32))
* definitions sync failing ([b2b2638](https://github.com/remidej/camox/commit/b2b2638d8d53087c4f1f3c6fce3ceebacdc40bc3))
* multiple file fields corrupt data ([24ef219](https://github.com/remidej/camox/commit/24ef2196d4b6029dc9a758d5247ebab7e60d2332))
* nested repeatable items not resolving ([4110d71](https://github.com/remidej/camox/commit/4110d71332d446d58f9204104ceac82fbaf878cf))
* playground css breaking build ([fbf28a5](https://github.com/remidej/camox/commit/fbf28a5063e693658773145857666f9536519cc1))
* release ci ([ee13241](https://github.com/remidej/camox/commit/ee132414d0b302238439511f0744171a56e28286))
* release ci ([f44eff1](https://github.com/remidej/camox/commit/f44eff17c23a9ea0d10314ae0340f6a93f8c831f))
* release ci ([85646ce](https://github.com/remidej/camox/commit/85646ce85b73997fdc7d2dab861aa683cc6cd0ef))
* release please drop alpha tag ([9d4ce8a](https://github.com/remidej/camox/commit/9d4ce8aaa6a1a42f2f445738ff5d8297916da2a9))
* release-please setup ([e59c2d3](https://github.com/remidej/camox/commit/e59c2d38705f2f2c73086de681229069929b33a7))
* remove SEED_SECRET ([11dc727](https://github.com/remidej/camox/commit/11dc7274603aab05fcf0e85dc5964715fd12bb46))
* repeatable item creation and ghost items ([8a08118](https://github.com/remidej/camox/commit/8a08118c8173cff102c11cfa3033c3f8dd80c13d))
* **sdk:** editing repeatable item fields in sidebar ([9bb5ae9](https://github.com/remidej/camox/commit/9bb5ae99bcea33b654aec83042c7cd99c3e61990))
* **sdk:** repeatable items not detected ([155964d](https://github.com/remidej/camox/commit/155964d1670876eaf887a3f887da1aa4313babd2))
* **sdk:** retrieve project by slug ([fe37eea](https://github.com/remidej/camox/commit/fe37eea83f7ae2f4d3788a1830a7d43643b82cf4))
* server side rendering ([5d33f2c](https://github.com/remidej/camox/commit/5d33f2c61fb2012c32ad105523ce2713f801ec51))
* simplify web auth ([c5fcb37](https://github.com/remidej/camox/commit/c5fcb375689021660e0824b4976c8a64f3dae256))
* sync definitions during build ([2b93bad](https://github.com/remidej/camox/commit/2b93bada3758c4e62e001249d638efa191fa9bae))
* use 32 character better auth secret in dev ([8bde6c0](https://github.com/remidej/camox/commit/8bde6c0e68c8f4d72e45038f4565a0663597631f))
* use project specific sync secret ([3e5748a](https://github.com/remidej/camox/commit/3e5748a3662945470b9d919fc03099d181683dfd))
* various issues ([7d3d89f](https://github.com/remidej/camox/commit/7d3d89f45a1b9d46500cdbac544f7d65d71e7560))
* various ui tweaks ([4fe6adb](https://github.com/remidej/camox/commit/4fe6adb64668846d4898e5f023ee647720ac22d3))
* **web:** cross domain auth ([79ef5be](https://github.com/remidej/camox/commit/79ef5be2a09ce30a157656403fc14cff703f5a4c))
* **web:** race condition when switching org ([f789a14](https://github.com/remidej/camox/commit/f789a14da71575984113856235ad9f62d3683368))
* **web:** ssr not getting session ([040ba9d](https://github.com/remidej/camox/commit/040ba9d72bc5baa36dd5522e9307830cdae43426))


### Refactoring

* fetch ssr data through tanstack query ([1b58709](https://github.com/remidej/camox/commit/1b5870998da00812415d5fa99111eb058abc1d70))
* move query key definition and invalidation to backend ([a4d6dbc](https://github.com/remidej/camox/commit/a4d6dbc295543862759a153a7e1e96affaba7e3c))
* normalize images in page response ([3bf3e01](https://github.com/remidej/camox/commit/3bf3e017a7329ad7c8a6d92f49231dc30bf3ba03))
* **sdk:** centralize all API mutations into tanstack query mutation factories ([ec30ff8](https://github.com/remidej/camox/commit/ec30ff8d1b9ffba6174c8c55512de9cd61d5da59))
* **sdk:** extract camox dev options to _config vite options ([22a6c78](https://github.com/remidej/camox/commit/22a6c78c3c5e6e8e5e3e223ced04488f7b10ca05))
* **sdk:** make components subscribe to granular cache items ([fa9b771](https://github.com/remidej/camox/commit/fa9b771da39876082ace1af98edd550be177bb29))
* **sdk:** rework breadcrumbs system (wip) ([1bb2be4](https://github.com/remidej/camox/commit/1bb2be4d85ed237bdc6c8652db4df29d38b9cc63))
* store markdown and move lexical conversion to editor level ([741e57f](https://github.com/remidej/camox/commit/741e57f614f19b3407e2b1ec643d280de64cda47))


### Documentation

* add cli architecture plan ([1c6012f](https://github.com/remidej/camox/commit/1c6012fcdc09e1b69cd3dec7dfe6e9c1e9c0196f))


### Miscellaneous

* add camox business logic to api ([d3f5ffc](https://github.com/remidej/camox/commit/d3f5ffc1a2bb81343d20bfd2e010be903239c997))
* add queryClient to router context on createRouter ([6bfb7f8](https://github.com/remidej/camox/commit/6bfb7f85ba23ebe8dc0224b73becf7b2a6fd9111))
* add readme image ([fb9b6d8](https://github.com/remidej/camox/commit/fb9b6d86171e3fb40cd8a0481d9e38ff691cad0f))
* added oxlint to api ([a7a2400](https://github.com/remidej/camox/commit/a7a24007b872f292761e8af539edf79d530167a9))
* **api:** add .env.example ([8bb7d33](https://github.com/remidej/camox/commit/8bb7d3396dcba9cce1bef2d9fafe41661cac610a))
* **api:** migrate file upload and serve ([054ee02](https://github.com/remidej/camox/commit/054ee0295b08f419d6af21ceebb03d03f608af65))
* **api:** move requireAuth middleware to route basis ([dd790e8](https://github.com/remidej/camox/commit/dd790e8aa8aeede3b7b60fd498fcd2bccd6e74be))
* batch github releases per version ([565afa0](https://github.com/remidej/camox/commit/565afa080720fd1993423eb5fe059b1ad8d101c7))
* clean up remainingrepeatable object references ([302ad60](https://github.com/remidej/camox/commit/302ad60c96e8fed24f8bfa43aa50828ff89e4dd9))
* **cli:** migrate to oblique ([1375381](https://github.com/remidej/camox/commit/1375381f53ec2bfdb43328151bdbad2443f551c0))
* declutter oxlint configs ([9a89597](https://github.com/remidej/camox/commit/9a89597310a97606894f59c76e4881ee1d281f69))
* delete legacy convex backends ([d7dd53f](https://github.com/remidej/camox/commit/d7dd53fcb4427a682747bdf08b7f897b1c5c872a))
* delete project domain and description ([8a1ee2d](https://github.com/remidej/camox/commit/8a1ee2d9597fced845ee47c1c917401ae70a0388))
* delete remaining convex code in sdk ([c390d8c](https://github.com/remidej/camox/commit/c390d8cdeaa44285874403724e96997d291a2cc9))
* delete unused create-camox package ([b85b85c](https://github.com/remidej/camox/commit/b85b85c28a4ab4ea4cd908e8cf1ef3a7fd1f7e70))
* don't rely on better auth activeOrg for permission checks ([4782674](https://github.com/remidej/camox/commit/47826741849674986447e7881b71bcf0709ada7a))
* enforce conventional commits ([d396b4c](https://github.com/remidej/camox/commit/d396b4c109aa71aeec00036b3faba143f085b0d9))
* ignore generated files in linter and formatter ([a87ff5f](https://github.com/remidej/camox/commit/a87ff5f0a6f7ba1eba39a70956a81152c11617bf))
* implement better-auth cross domain plugin internally ([080603d](https://github.com/remidej/camox/commit/080603df0970e359b80d631c917adce0e8c4c0f7))
* init hono app ([e442467](https://github.com/remidej/camox/commit/e442467809df7cb05ba7df7ae7688ab1e6aed048))
* make web app query new hono api ([ed5e638](https://github.com/remidej/camox/commit/ed5e6388e54df1ee5fc1a18402b8ed71c6a4798e))
* migrate definitions sync to orpc ([dfa6b90](https://github.com/remidej/camox/commit/dfa6b90013ad1e0efcfb460d1fd8c50af48c4024))
* migrate from hono rpc to orpc ([08d8c77](https://github.com/remidej/camox/commit/08d8c772446a33029026dd4e2fa7e1ec539a47eb))
* migrate sdk auth actions to hono api ([0754ad4](https://github.com/remidej/camox/commit/0754ad43546920272e0d33e7b0ccb6cffdba0161))
* mitigate layout shift on block reorder ([a907b33](https://github.com/remidej/camox/commit/a907b33f8503def20590de9d835a2ead119527f0))
* move hono api client out of react context ([b583157](https://github.com/remidej/camox/commit/b58315785035df2e9263d28ce3b975c8bbb29fc5))
* move seed out of api and into script file ([17b66ae](https://github.com/remidej/camox/commit/17b66ae4e7685066c5c8edcbaedd523c5c445a8e))
* normalize page response ([9bc2516](https://github.com/remidej/camox/commit/9bc25164f9dab8f8536a36202451fb771e5e7765))
* normalize peeked block repeatable items ([71a2dbd](https://github.com/remidej/camox/commit/71a2dbd208c1f4ee372bcdb0ab5472fad9dc9f3d))
* prefix all query keys with camox ([9801630](https://github.com/remidej/camox/commit/9801630df2e2123c7b4a2ed53b7190ae5e79c804))
* prepare for release ([9fb2efa](https://github.com/remidej/camox/commit/9fb2efac1b96e715704be8a31ebbc4d23aa63e1a))
* release as stable instead of alpha ([ef9fde9](https://github.com/remidej/camox/commit/ef9fde97379f7e891012c847a5f539184745d41e))
* release main ([10f2404](https://github.com/remidej/camox/commit/10f24049b5d4797fdb825efb831b9591f5c85973))
* release main ([c70b4a8](https://github.com/remidej/camox/commit/c70b4a850a5ad69e3effec04116277398cf9def2))
* release main ([7161c8e](https://github.com/remidej/camox/commit/7161c8ef08f144d6f7997bc8cd605b6cc26f669d))
* release main ([62dcf04](https://github.com/remidej/camox/commit/62dcf04f72a911c383f14f1f445726a2ebd756f9))
* release main ([#3](https://github.com/remidej/camox/issues/3)) ([daa00dd](https://github.com/remidej/camox/commit/daa00dd18a5c2784b58f6374f93a8cc8caddcb52))
* release main ([#3](https://github.com/remidej/camox/issues/3)) ([f589aaa](https://github.com/remidej/camox/commit/f589aaadc6f98c2921a5c51445d31229c5be4bc4))
* release main ([#4](https://github.com/remidej/camox/issues/4)) ([23e5f3e](https://github.com/remidej/camox/commit/23e5f3e3d8894e14d57904992c57a8bb1456c5de))
* release main ([#5](https://github.com/remidej/camox/issues/5)) ([532d93d](https://github.com/remidej/camox/commit/532d93d763523f77e8f70e47721a6c133e437f39))
* release main ([#6](https://github.com/remidej/camox/issues/6)) ([e2d023c](https://github.com/remidej/camox/commit/e2d023c660d56710b6a65f7bc664652755e6fbd8))
* remove BETTER_AUTH_URL en var ([af1dd17](https://github.com/remidej/camox/commit/af1dd17161357ca1b2a384bbbd5fcf0a14680cf0))
* remove dynamic contenteditable tag on lexical inputs ([41fdf5f](https://github.com/remidej/camox/commit/41fdf5fe6fd9033b2eebedf1f4eb803f5b9bccb1))
* remove git initialization from cli init command ([365835f](https://github.com/remidej/camox/commit/365835f96b3379c1e802f07b781935f8e89dc8dc))
* rename repeatable object to repeatable item ([6f8c054](https://github.com/remidej/camox/commit/6f8c0545cc22dda7469c654a9d50d65450093e59))
* rewrite api routes to full rpc style ([dc87be9](https://github.com/remidej/camox/commit/dc87be9fa37b42543122c4fbd1d8cd5c21c08a98))
* **sdk:** migrate mutations to new api ([76b6aae](https://github.com/remidej/camox/commit/76b6aaeb1d3a0e105219cfa39ce31797ac4c011d))
* **sdk:** migrate read operations to hono api ([b588e8e](https://github.com/remidej/camox/commit/b588e8e9769e172ff743ea982a850c8adfc9c6cf))
* seed individual tanstack cache queries ([d89ab96](https://github.com/remidej/camox/commit/d89ab96f47273efa1f62584447719948093b66ea))
* set up release-please ([b77b064](https://github.com/remidej/camox/commit/b77b064ab6f80e87fa22e70fbb9cac01505ff336))
* set up web app for cloudflare workers ([86a8eeb](https://github.com/remidej/camox/commit/86a8eeb8c9088d4310c4f5bd8bfa24e5e292822c))
* specify css source only once ([7fa0d78](https://github.com/remidej/camox/commit/7fa0d78555bc7ab58a965f63f2c45c8e6a49ff57))
* use org id instead of slug ([648f80e](https://github.com/remidej/camox/commit/648f80eb588468ce1c85c381bfab7a0b6bf7d5c7))
* **web:** add org to dashboard url path ([92c3b83](https://github.com/remidej/camox/commit/92c3b8348d7066c22ab668669a643b0c01dfae80))

## [0.2.0-alpha.5](https://github.com/remidej/camox/compare/camox-v0.2.0-alpha.4...camox-v0.2.0-alpha.5) (2026-04-10)


### Bug Fixes

* release ci ([ee13241](https://github.com/remidej/camox/commit/ee132414d0b302238439511f0744171a56e28286))

## [0.2.0-alpha.4](https://github.com/remidej/camox/compare/camox-v0.2.0-alpha.3...camox-v0.2.0-alpha.4) (2026-04-10)


### Bug Fixes

* release ci ([f44eff1](https://github.com/remidej/camox/commit/f44eff17c23a9ea0d10314ae0340f6a93f8c831f))

## [0.2.0-alpha.3](https://github.com/remidej/camox/compare/camox-v0.2.0-alpha.2...camox-v0.2.0-alpha.3) (2026-04-10)


### Bug Fixes

* release ci ([85646ce](https://github.com/remidej/camox/commit/85646ce85b73997fdc7d2dab861aa683cc6cd0ef))

## [0.2.0-alpha.2](https://github.com/remidej/camox/compare/camox-v0.1.2-alpha.2...camox-v0.2.0-alpha.2) (2026-04-10)


### Features

* add authentication to create-camox cli ([093ede4](https://github.com/remidej/camox/commit/093ede4dbdfa0017cd9b5977e1a2179a49b4a248))
* add dedicated environment menu to navbar ([9d0fffa](https://github.com/remidej/camox/commit/9d0fffa3577819e95430fe1d8238121fd5994d87))
* add environments concept to scope db per-user in dev ([40f1b11](https://github.com/remidej/camox/commit/40f1b113f473ca1af9468bfce5a711e7c906a8de))
* add itialBlocks to createLayout for declarative initial content generation ([27ded94](https://github.com/remidej/camox/commit/27ded94210d958d02a9bb5a7cb822b381ff04a1b))
* add org switcher to dashboard navbar ([4ad6d29](https://github.com/remidej/camox/commit/4ad6d29388e6385750e0718b53f8635c3da2f3f6))
* add page metadata button to sidebar ([622ed83](https://github.com/remidej/camox/commit/622ed83197d171a44812eb464b541736a6a876a7))
* add project creation guide to web app ([aaadcb0](https://github.com/remidej/camox/commit/aaadcb03c6c2454f96206f31e3205050c8227555))
* ai features in api with durable object alarms ([eb66c75](https://github.com/remidej/camox/commit/eb66c758b789e5b46f50e6e35d998ec971ca6753))
* auto create org on signup ([4acb6ca](https://github.com/remidej/camox/commit/4acb6cabcd3cdc6e563d10c5cc5a130119c3971d))
* auto generate project initial content in vite plugin ([18d0599](https://github.com/remidej/camox/commit/18d059981e1e629d64dc1fc6891d284eefcbe8da))
* auto select first project ([47e166a](https://github.com/remidej/camox/commit/47e166ae929df895e7c300498aea903547ec22c6))
* **cli:** add login and logout commands ([3461d76](https://github.com/remidej/camox/commit/3461d76796a0219e9a286bff3754fa2e8dae2510))
* create org in org picker ([b5a0fb1](https://github.com/remidej/camox/commit/b5a0fb13b8d2db6a1119599996acc7eb2ad3e47b))
* introduce sync secret to authenticate definition routes ([70251f2](https://github.com/remidej/camox/commit/70251f262c8f19961f1b7c50470f3977ab1eacb7))
* **sdk:** add partykit query invalidation ([7828774](https://github.com/remidej/camox/commit/7828774666f4e07cfa19071eb69b4bc2dcb0450c))
* server project creation in cli ([5a5138a](https://github.com/remidej/camox/commit/5a5138ae2a169de1e486e719a4471f1374f424e6))
* set up cli package and sdk reexport ([b5c0493](https://github.com/remidej/camox/commit/b5c0493464ab0e9ec8b02d159573f43111033c43))
* show sync secret in project dashboard ([3675495](https://github.com/remidej/camox/commit/36754951775553a0ad2b4f1edf89facd8e99c1af))
* store default content in block definitions ([b1d8657](https://github.com/remidej/camox/commit/b1d865716a4569c2334b9f1731fc306b83c8292f))


### Bug Fixes

* add org-based permission checks ([3a032cc](https://github.com/remidej/camox/commit/3a032cc36c14982d9e4352f057a4a9d10e3abda3))
* **api:** ai image metadata generation ([08da599](https://github.com/remidej/camox/commit/08da599803fc73f1a54d2407117bb8f14c75d4a0))
* **api:** corrupt data in seeded blocks ([df0b9ca](https://github.com/remidej/camox/commit/df0b9cab7ffda800a2df110764cee675e719ad39))
* authenticate seed route ([92ce5a1](https://github.com/remidej/camox/commit/92ce5a183f431ce86796f685543c7db8e64cd3e7))
* block reordering and upload ([7ba5534](https://github.com/remidej/camox/commit/7ba5534d5ffdf536b9616ca0007ae9d29f1af9d5))
* blocks reordering ([61a9f71](https://github.com/remidej/camox/commit/61a9f71a857e0c3f87b04d8e7f02fac89c5003fa))
* breadcrumbs performance ([e4fbdde](https://github.com/remidej/camox/commit/e4fbdde2d1db37e09cf6fd877ed35113cd73749e))
* broken cli when auth session expires ([c9ef4a8](https://github.com/remidej/camox/commit/c9ef4a88b8fdf1825c2584a44f1e24ef6124c35f))
* bulk delete files ([4001898](https://github.com/remidej/camox/commit/4001898911e14e6352a4e748c7d841cba7909a8c))
* clean up references on file delete ([1954831](https://github.com/remidej/camox/commit/19548313dd4dc1d179444ccf322487f4ed475d84))
* cli auth ([2f70ab0](https://github.com/remidej/camox/commit/2f70ab0f604e5e98af73ca29324b71a953476327))
* convex _id to d1 id ([c4654c7](https://github.com/remidej/camox/commit/c4654c700aa72c3d39db4397c6d4244fa898ee32))
* definitions sync failing ([b2b2638](https://github.com/remidej/camox/commit/b2b2638d8d53087c4f1f3c6fce3ceebacdc40bc3))
* multiple file fields corrupt data ([24ef219](https://github.com/remidej/camox/commit/24ef2196d4b6029dc9a758d5247ebab7e60d2332))
* nested repeatable items not resolving ([4110d71](https://github.com/remidej/camox/commit/4110d71332d446d58f9204104ceac82fbaf878cf))
* remove SEED_SECRET ([11dc727](https://github.com/remidej/camox/commit/11dc7274603aab05fcf0e85dc5964715fd12bb46))
* repeatable item creation and ghost items ([8a08118](https://github.com/remidej/camox/commit/8a08118c8173cff102c11cfa3033c3f8dd80c13d))
* **sdk:** editing repeatable item fields in sidebar ([9bb5ae9](https://github.com/remidej/camox/commit/9bb5ae99bcea33b654aec83042c7cd99c3e61990))
* **sdk:** repeatable items not detected ([155964d](https://github.com/remidej/camox/commit/155964d1670876eaf887a3f887da1aa4313babd2))
* **sdk:** retrieve project by slug ([fe37eea](https://github.com/remidej/camox/commit/fe37eea83f7ae2f4d3788a1830a7d43643b82cf4))
* server side rendering ([5d33f2c](https://github.com/remidej/camox/commit/5d33f2c61fb2012c32ad105523ce2713f801ec51))
* sync definitions during build ([2b93bad](https://github.com/remidej/camox/commit/2b93bada3758c4e62e001249d638efa191fa9bae))
* various issues ([7d3d89f](https://github.com/remidej/camox/commit/7d3d89f45a1b9d46500cdbac544f7d65d71e7560))
* various ui tweaks ([4fe6adb](https://github.com/remidej/camox/commit/4fe6adb64668846d4898e5f023ee647720ac22d3))
* **web:** race condition when switching org ([f789a14](https://github.com/remidej/camox/commit/f789a14da71575984113856235ad9f62d3683368))
* **web:** ssr not getting session ([040ba9d](https://github.com/remidej/camox/commit/040ba9d72bc5baa36dd5522e9307830cdae43426))


### Refactoring

* fetch ssr data through tanstack query ([1b58709](https://github.com/remidej/camox/commit/1b5870998da00812415d5fa99111eb058abc1d70))
* move query key definition and invalidation to backend ([a4d6dbc](https://github.com/remidej/camox/commit/a4d6dbc295543862759a153a7e1e96affaba7e3c))
* normalize images in page response ([3bf3e01](https://github.com/remidej/camox/commit/3bf3e017a7329ad7c8a6d92f49231dc30bf3ba03))
* **sdk:** centralize all API mutations into tanstack query mutation factories ([ec30ff8](https://github.com/remidej/camox/commit/ec30ff8d1b9ffba6174c8c55512de9cd61d5da59))
* **sdk:** extract camox dev options to _config vite options ([22a6c78](https://github.com/remidej/camox/commit/22a6c78c3c5e6e8e5e3e223ced04488f7b10ca05))
* **sdk:** make components subscribe to granular cache items ([fa9b771](https://github.com/remidej/camox/commit/fa9b771da39876082ace1af98edd550be177bb29))
* **sdk:** rework breadcrumbs system (wip) ([1bb2be4](https://github.com/remidej/camox/commit/1bb2be4d85ed237bdc6c8652db4df29d38b9cc63))
* store markdown and move lexical conversion to editor level ([741e57f](https://github.com/remidej/camox/commit/741e57f614f19b3407e2b1ec643d280de64cda47))


### Documentation

* add cli architecture plan ([1c6012f](https://github.com/remidej/camox/commit/1c6012fcdc09e1b69cd3dec7dfe6e9c1e9c0196f))


### Miscellaneous

* add camox business logic to api ([d3f5ffc](https://github.com/remidej/camox/commit/d3f5ffc1a2bb81343d20bfd2e010be903239c997))
* add queryClient to router context on createRouter ([6bfb7f8](https://github.com/remidej/camox/commit/6bfb7f85ba23ebe8dc0224b73becf7b2a6fd9111))
* added oxlint to api ([a7a2400](https://github.com/remidej/camox/commit/a7a24007b872f292761e8af539edf79d530167a9))
* **api:** add .env.example ([8bb7d33](https://github.com/remidej/camox/commit/8bb7d3396dcba9cce1bef2d9fafe41661cac610a))
* **api:** migrate file upload and serve ([054ee02](https://github.com/remidej/camox/commit/054ee0295b08f419d6af21ceebb03d03f608af65))
* **api:** move requireAuth middleware to route basis ([dd790e8](https://github.com/remidej/camox/commit/dd790e8aa8aeede3b7b60fd498fcd2bccd6e74be))
* clean up remainingrepeatable object references ([302ad60](https://github.com/remidej/camox/commit/302ad60c96e8fed24f8bfa43aa50828ff89e4dd9))
* **cli:** migrate to oblique ([1375381](https://github.com/remidej/camox/commit/1375381f53ec2bfdb43328151bdbad2443f551c0))
* declutter oxlint configs ([9a89597](https://github.com/remidej/camox/commit/9a89597310a97606894f59c76e4881ee1d281f69))
* delete legacy convex backends ([d7dd53f](https://github.com/remidej/camox/commit/d7dd53fcb4427a682747bdf08b7f897b1c5c872a))
* delete project domain and description ([8a1ee2d](https://github.com/remidej/camox/commit/8a1ee2d9597fced845ee47c1c917401ae70a0388))
* delete remaining convex code in sdk ([c390d8c](https://github.com/remidej/camox/commit/c390d8cdeaa44285874403724e96997d291a2cc9))
* delete unused create-camox package ([b85b85c](https://github.com/remidej/camox/commit/b85b85c28a4ab4ea4cd908e8cf1ef3a7fd1f7e70))
* don't rely on better auth activeOrg for permission checks ([4782674](https://github.com/remidej/camox/commit/47826741849674986447e7881b71bcf0709ada7a))
* implement better-auth cross domain plugin internally ([080603d](https://github.com/remidej/camox/commit/080603df0970e359b80d631c917adce0e8c4c0f7))
* init hono app ([e442467](https://github.com/remidej/camox/commit/e442467809df7cb05ba7df7ae7688ab1e6aed048))
* make web app query new hono api ([ed5e638](https://github.com/remidej/camox/commit/ed5e6388e54df1ee5fc1a18402b8ed71c6a4798e))
* migrate definitions sync to orpc ([dfa6b90](https://github.com/remidej/camox/commit/dfa6b90013ad1e0efcfb460d1fd8c50af48c4024))
* migrate from hono rpc to orpc ([08d8c77](https://github.com/remidej/camox/commit/08d8c772446a33029026dd4e2fa7e1ec539a47eb))
* migrate sdk auth actions to hono api ([0754ad4](https://github.com/remidej/camox/commit/0754ad43546920272e0d33e7b0ccb6cffdba0161))
* mitigate layout shift on block reorder ([a907b33](https://github.com/remidej/camox/commit/a907b33f8503def20590de9d835a2ead119527f0))
* move hono api client out of react context ([b583157](https://github.com/remidej/camox/commit/b58315785035df2e9263d28ce3b975c8bbb29fc5))
* move seed out of api and into script file ([17b66ae](https://github.com/remidej/camox/commit/17b66ae4e7685066c5c8edcbaedd523c5c445a8e))
* normalize page response ([9bc2516](https://github.com/remidej/camox/commit/9bc25164f9dab8f8536a36202451fb771e5e7765))
* normalize peeked block repeatable items ([71a2dbd](https://github.com/remidej/camox/commit/71a2dbd208c1f4ee372bcdb0ab5472fad9dc9f3d))
* prefix all query keys with camox ([9801630](https://github.com/remidej/camox/commit/9801630df2e2123c7b4a2ed53b7190ae5e79c804))
* prepare for release ([9fb2efa](https://github.com/remidej/camox/commit/9fb2efac1b96e715704be8a31ebbc4d23aa63e1a))
* remove dynamic contenteditable tag on lexical inputs ([41fdf5f](https://github.com/remidej/camox/commit/41fdf5fe6fd9033b2eebedf1f4eb803f5b9bccb1))
* rename repeatable object to repeatable item ([6f8c054](https://github.com/remidej/camox/commit/6f8c0545cc22dda7469c654a9d50d65450093e59))
* rewrite api routes to full rpc style ([dc87be9](https://github.com/remidej/camox/commit/dc87be9fa37b42543122c4fbd1d8cd5c21c08a98))
* **sdk:** migrate mutations to new api ([76b6aae](https://github.com/remidej/camox/commit/76b6aaeb1d3a0e105219cfa39ce31797ac4c011d))
* **sdk:** migrate read operations to hono api ([b588e8e](https://github.com/remidej/camox/commit/b588e8e9769e172ff743ea982a850c8adfc9c6cf))
* seed individual tanstack cache queries ([d89ab96](https://github.com/remidej/camox/commit/d89ab96f47273efa1f62584447719948093b66ea))
* specify css source only once ([7fa0d78](https://github.com/remidej/camox/commit/7fa0d78555bc7ab58a965f63f2c45c8e6a49ff57))
* **web:** add org to dashboard url path ([92c3b83](https://github.com/remidej/camox/commit/92c3b8348d7066c22ab668669a643b0c01dfae80))

## [0.1.2-alpha.2](https://github.com/remidej/camox/compare/camox-v0.1.2-alpha.1...camox-v0.1.2-alpha.2) (2026-03-25)


### Bug Fixes

* playground css breaking build ([fbf28a5](https://github.com/remidej/camox/commit/fbf28a5063e693658773145857666f9536519cc1))


### Miscellaneous

* ignore generated files in linter and formatter ([a87ff5f](https://github.com/remidej/camox/commit/a87ff5f0a6f7ba1eba39a70956a81152c11617bf))

## [0.1.2-alpha.1](https://github.com/remidej/camox/compare/camox-v0.1.2-alpha.0...camox-v0.1.2-alpha.1) (2026-03-25)


### Bug Fixes

* release-please setup ([e59c2d3](https://github.com/remidej/camox/commit/e59c2d38705f2f2c73086de681229069929b33a7))

## [0.1.2-alpha.0](https://github.com/remidej/camox/compare/camox-v0.1.1-alpha.0...camox-v0.1.2-alpha.0) (2026-03-25)

### Features

- make create-camox auto run app ([ede571b](https://github.com/remidej/camox/commit/ede571b8b8eda3fc931409d6ae6997ae1702d1fd))

### Miscellaneous

- add readme image ([fb9b6d8](https://github.com/remidej/camox/commit/fb9b6d86171e3fb40cd8a0481d9e38ff691cad0f))
- batch github releases per version ([565afa0](https://github.com/remidej/camox/commit/565afa080720fd1993423eb5fe059b1ad8d101c7))
