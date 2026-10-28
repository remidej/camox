# Changelog

## [0.60.1](https://github.com/remidej/camox/compare/camox-v0.60.0...@camox/api-contract-v0.60.1) (2026-10-28)


### Miscellaneous

* **@camox/api-contract:** Synchronize camox versions

## [0.60.0](https://github.com/remidej/camox/compare/camox-v0.59.0...@camox/api-contract-v0.60.0) (2026-10-28)


### Features

* say what the agent does beside its squareling, with a face for each activity ([#686](https://github.com/remidej/camox/issues/686)) ([9760946](https://github.com/remidej/camox/commit/97609460e279d3dcb68ea2ea94ccd263837d4d6b))
* show the selection in the agent composer and tell the agent about it ([#687](https://github.com/remidej/camox/issues/687)) ([6456d5e](https://github.com/remidej/camox/commit/6456d5edef50cf1595de877b567f5676c1f19403))
* tell the agent which page the editor is looking at ([#668](https://github.com/remidej/camox/issues/668)) ([f1a2ca7](https://github.com/remidej/camox/commit/f1a2ca7ec0641e2a960a40ff412aca292d8becaf))

## [0.59.0](https://github.com/remidej/camox/compare/camox-v0.58.1...@camox/api-contract-v0.59.0) (2026-10-28)


### ⚠ BREAKING CHANGES

* `vite dev` refuses to start unless `_internal.apiUrl` is a local API and `_internal.localDeployToken` is set: a hosted project's code reaches Camox through drafts and Upgrades.

### Features

* host camox.ai like any project (pushing code to drafts, no development drafts, Custom Domains) ([#664](https://github.com/remidej/camox/issues/664)) ([147ab16](https://github.com/remidej/camox/commit/147ab16efda8fa75049e9b5e08eb25f7f94e5f88))

## [0.58.1](https://github.com/remidej/camox/compare/camox-v0.58.0...@camox/api-contract-v0.58.1) (2026-10-27)


### Miscellaneous

* **@camox/api-contract:** Synchronize camox versions

## [0.58.0](https://github.com/remidej/camox/compare/camox-v0.57.0...@camox/api-contract-v0.58.0) (2026-10-27)


### Features

* public pages load artifacts by URL ([#643](https://github.com/remidej/camox/issues/643)) ([8cb2fa5](https://github.com/remidej/camox/commit/8cb2fa57176d9407604f1df8f0c19422e935baff))

## [0.57.0](https://github.com/remidej/camox/compare/camox-v0.56.0...@camox/api-contract-v0.57.0) (2026-10-27)


### Features

* Live threads hand requests off to drafts ([#632](https://github.com/remidej/camox/issues/632)) ([371d044](https://github.com/remidej/camox/commit/371d0442515f299744ab985f68ad01f2115feacb))
* the Patrol shows the work Camox does without being asked ([#624](https://github.com/remidej/camox/issues/624)) ([6bc46f5](https://github.com/remidej/camox/commit/6bc46f5e01a8607f38321634710961feffb6a362))

## [0.56.0](https://github.com/remidej/camox/compare/camox-v0.55.0...@camox/api-contract-v0.56.0) (2026-10-27)


### ⚠ BREAKING CHANGES

* the API's `drafts.discard` procedure is now `drafts.delete`, an ended draft's outcome is `deleted` instead of `discarded`, and the CLI's `discard` command is now `delete`. A migration rewrites stored outcomes.

### Refactoring

* delete drafts instead of discarding them ([#615](https://github.com/remidej/camox/issues/615)) ([bc5ccce](https://github.com/remidej/camox/commit/bc5ccce7a2a61389cbd8d834ec1cf7aeea60663f))

## [0.55.0](https://github.com/remidej/camox/compare/camox-v0.54.0...@camox/api-contract-v0.55.0) (2026-10-26)


### Miscellaneous

* **@camox/api-contract:** Synchronize camox versions

## [0.54.0](https://github.com/remidej/camox/compare/camox-v0.53.1...@camox/api-contract-v0.54.0) (2026-10-26)


### Features

* **sdk:** give the agent a squareling avatar that shows what it's doing ([#605](https://github.com/remidej/camox/issues/605)) ([231adc3](https://github.com/remidej/camox/commit/231adc3022172761803f116ac87d9c918ce78f56))

## [0.53.1](https://github.com/remidej/camox/compare/camox-v0.53.0...@camox/api-contract-v0.53.1) (2026-10-26)


### Miscellaneous

* **@camox/api-contract:** Synchronize camox versions

## [0.53.0](https://github.com/remidej/camox/compare/camox-v0.52.3...@camox/api-contract-v0.53.0) (2026-10-26)


### Miscellaneous

* **@camox/api-contract:** Synchronize camox versions

## [0.52.3](https://github.com/remidej/camox/compare/camox-v0.52.2...@camox/api-contract-v0.52.3) (2026-10-25)


### Miscellaneous

* **@camox/api-contract:** Synchronize camox versions

## [0.52.2](https://github.com/remidej/camox/compare/camox-v0.52.1...@camox/api-contract-v0.52.2) (2026-10-25)


### Miscellaneous

* **@camox/api-contract:** Synchronize camox versions

## [0.52.1](https://github.com/remidej/camox/compare/camox-v0.52.0...@camox/api-contract-v0.52.1) (2026-10-24)


### Miscellaneous

* **@camox/api-contract:** Synchronize camox versions

## [0.52.0](https://github.com/remidej/camox/compare/camox-v0.51.0...@camox/api-contract-v0.52.0) (2026-10-24)


### Features

* the agent changes a website's code in a draft ([#584](https://github.com/remidej/camox/issues/584)) ([b129ef3](https://github.com/remidej/camox/commit/b129ef321870cfc755df95bdcb0fe754d085d598))

## [0.51.0](https://github.com/remidej/camox/compare/camox-v0.50.0...@camox/api-contract-v0.51.0) (2026-10-23)


### Features

* move Project Settings into the studio and make dashboard cards open the website ([#549](https://github.com/remidej/camox/issues/549)) ([58d24b8](https://github.com/remidej/camox/commit/58d24b80bfa04324de4a8b309d68b5ca6cd65ae3))


### Performance Improvements

* **api-contract:** move the router types to a router entry ([#559](https://github.com/remidej/camox/issues/559)) ([a829969](https://github.com/remidej/camox/commit/a829969b3ed2d02074d53892389d74054527c276))

## [0.50.0](https://github.com/remidej/camox/compare/camox-v0.49.0...@camox/api-contract-v0.50.0) (2026-10-23)


### Performance Improvements

* fewer sequential API calls and D1 round trips for public page reads ([#539](https://github.com/remidej/camox/issues/539)) ([48dabe2](https://github.com/remidej/camox/commit/48dabe2023c18f8962062efbb09bc1d94e192c37))

## [0.49.0](https://github.com/remidej/camox/compare/camox-v0.48.0...@camox/api-contract-v0.49.0) (2026-10-23)


### Miscellaneous

* **@camox/api-contract:** Synchronize camox versions

## [0.48.0](https://github.com/remidej/camox/compare/camox-v0.47.0...@camox/api-contract-v0.48.0) (2026-10-22)


### ⚠ BREAKING CHANGES

* the old option names are type errors with no runtime path left, and definitions without the required titles fail to type-check.

### Features

* structured data and the to* definition API ([#509](https://github.com/remidej/camox/issues/509)) ([20be067](https://github.com/remidej/camox/commit/20be0673e8490c190c6b4037f610c86115dd2153))

## [0.47.0](https://github.com/remidej/camox/compare/camox-v0.46.0...@camox/api-contract-v0.47.0) (2026-10-22)


### Miscellaneous

* **@camox/api-contract:** Synchronize camox versions

## [0.46.0](https://github.com/remidej/camox/compare/camox-v0.45.0...@camox/api-contract-v0.46.0) (2026-10-22)


### Miscellaneous

* **@camox/api-contract:** Synchronize camox versions

## [0.45.0](https://github.com/remidej/camox/compare/camox-v0.44.0...@camox/api-contract-v0.45.0) (2026-10-22)


### ⚠ BREAKING CHANGES

* camox({ projectSlug }) must become camox({ projectId }) with the Project ID shown in the Camox dashboard. Requires the API from #457.
* SDKs calling the six removed procedures stop syncing definitions. Deploy the API before publishing the SDK that calls definitions.sync.
* remove comments ([#298](https://github.com/remidej/camox/issues/298))

### Features

* **api:** add and remove locales ([#366](https://github.com/remidej/camox/issues/366)) ([3c94915](https://github.com/remidej/camox/commit/3c94915db27c12cbc8145c7baafb4f2b59bfe6b1))
* **api:** end threads with their drafts ([#424](https://github.com/remidej/camox/issues/424)) ([801955c](https://github.com/remidej/camox/commit/801955ce27418a2a1bafcc4525182b8aa2430741))
* **api:** let localizations diverge in structure ([#388](https://github.com/remidej/camox/issues/388)) ([c9e1ece](https://github.com/remidej/camox/commit/c9e1ece3a8d4e9fb47955c05c967dbf51a65dabc))
* artifacts in the studio and AI features ([#178](https://github.com/remidej/camox/issues/178)) ([27c789d](https://github.com/remidej/camox/commit/27c789d6a07c019790d2e68ba46d6f9ff9698087))
* **canvas:** show block usage in the Block Catalog ([#167](https://github.com/remidej/camox/issues/167)) ([a0e3d78](https://github.com/remidej/camox/commit/a0e3d786124f5ada7e19f61b5302456e16e77bc6)), closes [#152](https://github.com/remidej/camox/issues/152)
* **canvas:** show Synced Blocks' shared content in the Block Catalog ([#170](https://github.com/remidej/camox/issues/170)) ([ce154f5](https://github.com/remidej/camox/commit/ce154f5e5496d7b4fea3f6c5def6a7a4c999006c))
* chat with the agent on Live ([#414](https://github.com/remidej/camox/issues/414)) ([5575471](https://github.com/remidej/camox/commit/557547172f46c9a85a51ac6d94d65717eef71d9b))
* **collections:** add item authoring with media library assets ([0017fcc](https://github.com/remidej/camox/commit/0017fccc67a3870df4405a560cc99490c3d0cee2))
* **collections:** make collection records plain content ([#257](https://github.com/remidej/camox/issues/257)) ([58a629a](https://github.com/remidej/camox/commit/58a629a20dfdda91116a6a8ef7d2668e98ea3e18))
* comments in drafts ([#267](https://github.com/remidej/camox/issues/267)) ([cdf6327](https://github.com/remidej/camox/commit/cdf6327c1105331b9b8a1715ff042867eb060879)), closes [#241](https://github.com/remidej/camox/issues/241)
* **content:** add experimental collection browsing and item forms ([6c211bb](https://github.com/remidej/camox/commit/6c211bb51ed661b16202c93b751c6185730298d6))
* development drafts replace development environments ([#274](https://github.com/remidej/camox/issues/274)) ([e1f8a07](https://github.com/remidej/camox/commit/e1f8a07c69b594d7b9ccb455e8e20d615c015ba6)), closes [#246](https://github.com/remidej/camox/issues/246)
* drafts v1 ([e6473b2](https://github.com/remidej/camox/commit/e6473b2ffd21e7ba3a404a03c6a73dccae136876))
* edit blocks in a draft while Live stays unchanged ([#262](https://github.com/remidej/camox/issues/262)) ([4ea5fcd](https://github.com/remidej/camox/commit/4ea5fcda4eef980a6e43f1f133370618d783ce84))
* follow the agent's changes on the Canvas ([#433](https://github.com/remidej/camox/issues/433)) ([94940c2](https://github.com/remidej/camox/commit/94940c27828524273e76fa18d87909ae80df95ac))
* hosted projects for marketing teams (rest of [#444](https://github.com/remidej/camox/issues/444)) ([#469](https://github.com/remidej/camox/issues/469)) ([f33cc9c](https://github.com/remidej/camox/commit/f33cc9c28bc88531277db3d7ed12dd5e48bed471))
* identify files, collection records and comments by UUIDv7 ([#253](https://github.com/remidej/camox/issues/253)) ([2efc5da](https://github.com/remidej/camox/commit/2efc5da7a6c56e6bc3428d954684fb23f36d1b80))
* identify pages, blocks and repeatable items by UUIDv7 ([#260](https://github.com/remidej/camox/issues/260)) ([ee3a8c9](https://github.com/remidej/camox/commit/ee3a8c90af9bd5d79803c53cc5c4dc8b17fe56cb))
* identify projects by a permanent Project ID instead of their slug ([#461](https://github.com/remidej/camox/issues/461)) ([d83992a](https://github.com/remidej/camox/commit/d83992afa7e73a2b8cbfb55255e107d7b1b0e44a))
* make Live read-only ([#273](https://github.com/remidej/camox/issues/273)) ([4ff0e5e](https://github.com/remidej/camox/commit/4ff0e5ec4f1475daf0eff8a7e170c9aba9e8c0e9)), closes [#245](https://github.com/remidej/camox/issues/245)
* navigation and realtime follow the selected draft ([#263](https://github.com/remidej/camox/issues/263)) ([4cbf39f](https://github.com/remidej/camox/commit/4cbf39feedda355995e10b177468f5a868f7c1b0)), closes [#237](https://github.com/remidej/camox/issues/237)
* PostHog as a second analytics provider ([#391](https://github.com/remidej/camox/issues/391)) ([c55dcfe](https://github.com/remidej/camox/commit/c55dcfe6793427a1c20b5d1d8b8dbadde19c036a))
* publish every locale together ([#387](https://github.com/remidej/camox/issues/387)) ([d0ea50f](https://github.com/remidej/camox/commit/d0ea50fc324f86fd6fe558d9ef36b63686e83913))
* publish from the CLI and AI tools, and remove environments ([#275](https://github.com/remidej/camox/issues/275)) ([eb8369b](https://github.com/remidej/camox/commit/eb8369bd433b32cd31ad5f283aed691871e6b395)), closes [#248](https://github.com/remidej/camox/issues/248)
* publish or discard a draft ([#264](https://github.com/remidej/camox/issues/264)) ([1698b1f](https://github.com/remidej/camox/commit/1698b1f53fe2dc8d19cde57fd9c5a6ff9b01c387)), closes [#236](https://github.com/remidej/camox/issues/236)
* query-backed reference lists ([#145](https://github.com/remidej/camox/issues/145)) ([d4aefd9](https://github.com/remidej/camox/commit/d4aefd99e580d58b1df7d449eb92f9cd2ad14ab1))
* remove comments ([#298](https://github.com/remidej/camox/issues/298)) ([400b1d9](https://github.com/remidej/camox/commit/400b1d995f4bf88cea175a3684e11c3f3a89fc5d))
* **sdk:** count visitors in Google Analytics 4 on the first page load ([#379](https://github.com/remidej/camox/issues/379)) ([76a61c5](https://github.com/remidej/camox/commit/76a61c556c5b90d0427a319c1bb89b6627a58a5b))
* start a draft from a Live thread ([#425](https://github.com/remidej/camox/issues/425)) ([1cf351e](https://github.com/remidej/camox/commit/1cf351e1cb7ae2aacfd7088ab6191b89d506d6f4))
* steer and stop runs, and show failed turns ([#417](https://github.com/remidej/camox/issues/417)) ([24e4072](https://github.com/remidej/camox/commit/24e4072bd0d8cbbf127931d71da7b326f50b3780))
* sync each website's Definition Set from one app module, atomically ([#435](https://github.com/remidej/camox/issues/435)) ([7e149ff](https://github.com/remidej/camox/commit/7e149ffde6f79f7aae88688c3362f60e21291387))
* the drafts control ([#266](https://github.com/remidej/camox/issues/266)) ([59a3597](https://github.com/remidej/camox/commit/59a3597e77404748ad3c339edff396c3bfb9ee64)), closes [#242](https://github.com/remidej/camox/issues/242)


### Bug Fixes

* **drafts:** address the feat/drafts review findings ([#277](https://github.com/remidej/camox/issues/277)) ([1e46291](https://github.com/remidej/camox/commit/1e462917c3a258dba5e1134c9de3f8ed4fb4104f)), closes [#226](https://github.com/remidej/camox/issues/226)
* **sdk:** keep @iconify/utils out of client bundles ([#290](https://github.com/remidej/camox/issues/290)) ([c0f0500](https://github.com/remidej/camox/commit/c0f05001bbf7683ff886942e77f0d4e4556f7ff9))


### Performance Improvements

* **sdk:** stop shipping Studio code and wasted requests to anonymous visitors ([#305](https://github.com/remidej/camox/issues/305)) ([71379a8](https://github.com/remidej/camox/commit/71379a80e87c6d798b8f5a6affec5d644ee692b5))


### Refactoring

* drop page and layout checkpoints and per-item publishing ([#256](https://github.com/remidej/camox/issues/256)) ([989cb75](https://github.com/remidej/camox/commit/989cb75c8f20cec2e7f69be00871c2dec34d7adb))
* **sdk:** one draft scope per render and one catalog of studio reads ([#309](https://github.com/remidej/camox/issues/309)) ([eb91eb6](https://github.com/remidej/camox/commit/eb91eb6d00c181e9101a8e114d12c7ae6d79358d))


### Miscellaneous

* merge main into canvas landing ([6eb58c6](https://github.com/remidej/camox/commit/6eb58c6b36332a982b0330c45c26c0795c5e1112))

## [0.44.0](https://github.com/remidej/camox/compare/camox-v0.43.0...@camox/api-contract-v0.44.0) (2026-09-24)


### Features

* **feedback:** mark comments as done ([28954ae](https://github.com/remidej/camox/commit/28954ae99ef6adfa07ba4f7dc7821d51349224d9))
* **feedback:** persist object comments across environments ([816d09a](https://github.com/remidej/camox/commit/816d09acded7d1fab1efbf791e7f3c55b14393c0))
* **icons:** add typed icon fields and searchable picker ([f7ad47f](https://github.com/remidej/camox/commit/f7ad47f19b92446cda38ebf1a1f6247f7e29b46b))

## [0.43.0](https://github.com/remidej/camox/compare/camox-v0.42.0...@camox/api-contract-v0.43.0) (2026-09-21)


### Miscellaneous

* **@camox/api-contract:** Synchronize camox versions

## [0.42.0](https://github.com/remidej/camox/compare/camox-v0.41.1...@camox/api-contract-v0.42.0) (2026-09-18)


### Miscellaneous

* remove telemetry ([9eb6701](https://github.com/remidej/camox/commit/9eb67019d5a4e1fc6a839a07328acb1ae7d5f5d8))

## [0.41.1](https://github.com/remidej/camox/compare/camox-v0.41.0...@camox/api-contract-v0.41.1) (2026-09-16)


### Miscellaneous

* **@camox/api-contract:** Synchronize camox versions

## [0.41.0](https://github.com/remidej/camox/compare/camox-v0.40.0...@camox/api-contract-v0.41.0) (2026-09-15)


### Miscellaneous

* **@camox/api-contract:** Synchronize camox versions

## [0.40.0](https://github.com/remidej/camox/compare/camox-v0.39.0...@camox/api-contract-v0.40.0) (2026-09-11)


### Miscellaneous

* **@camox/api-contract:** Synchronize camox versions

## [0.39.0](https://github.com/remidej/camox/compare/camox-v0.38.0...@camox/api-contract-v0.39.0) (2026-09-02)


### Features

* remove in-app agent chat ([f5a8ed1](https://github.com/remidej/camox/commit/f5a8ed1e331e45344b8170e2358d0763475819f9))

## [0.38.0](https://github.com/remidej/camox/compare/camox-v0.37.0...@camox/api-contract-v0.38.0) (2026-08-25)


### Miscellaneous

* **@camox/api-contract:** Synchronize camox versions

## [0.37.0](https://github.com/remidej/camox/compare/camox-v0.36.3...@camox/api-contract-v0.37.0) (2026-08-21)


### Miscellaneous

* **@camox/api-contract:** Synchronize camox versions

## [0.36.3](https://github.com/remidej/camox/compare/camox-v0.36.2...@camox/api-contract-v0.36.3) (2026-08-09)


### Miscellaneous

* **@camox/api-contract:** Synchronize camox versions

## [0.36.2](https://github.com/remidej/camox/compare/camox-v0.36.1...@camox/api-contract-v0.36.2) (2026-08-06)


### Miscellaneous

* **@camox/api-contract:** Synchronize camox versions

## [0.36.1](https://github.com/remidej/camox/compare/camox-v0.36.0...@camox/api-contract-v0.36.1) (2026-08-05)


### Miscellaneous

* **@camox/api-contract:** Synchronize camox versions

## [0.36.0](https://github.com/remidej/camox/compare/camox-v0.35.0...@camox/api-contract-v0.36.0) (2026-08-05)


### Documentation

* rewrite readme presentation ([60b32d9](https://github.com/remidej/camox/commit/60b32d991e87695e5b4ae2d203dd8dc962d95d1d))

## [0.35.0](https://github.com/remidej/camox/compare/camox-v0.34.0...@camox/api-contract-v0.35.0) (2026-07-28)


### Miscellaneous

* **@camox/api-contract:** Synchronize camox versions

## [0.34.0](https://github.com/remidej/camox/compare/camox-v0.33.1...@camox/api-contract-v0.34.0) (2026-07-23)


### Miscellaneous

* **@camox/api-contract:** Synchronize camox versions

## [0.33.1](https://github.com/remidej/camox/compare/camox-v0.33.0...@camox/api-contract-v0.33.1) (2026-06-30)


### Miscellaneous

* **@camox/api-contract:** Synchronize camox versions

## [0.33.0](https://github.com/remidej/camox/compare/camox-v0.32.0...@camox/api-contract-v0.33.0) (2026-06-29)


### Miscellaneous

* **@camox/api-contract:** Synchronize camox versions

## [0.32.0](https://github.com/remidej/camox/compare/camox-v0.31.5...@camox/api-contract-v0.32.0) (2026-06-20)


### Miscellaneous

* **@camox/api-contract:** Synchronize camox versions

## [0.31.5](https://github.com/remidej/camox/compare/camox-v0.31.4...@camox/api-contract-v0.31.5) (2026-06-09)


### Miscellaneous

* migrate all but api to mit license ([07e31a2](https://github.com/remidej/camox/commit/07e31a2298d0537bb228246ce9fc7e97cbbc83dd))

## [0.31.4](https://github.com/remidej/camox/compare/camox-v0.31.3...@camox/api-contract-v0.31.4) (2026-05-27)


### Miscellaneous

* **@camox/api-contract:** Synchronize camox versions

## [0.31.3](https://github.com/remidej/camox/compare/camox-v0.31.2...@camox/api-contract-v0.31.3) (2026-05-27)


### Miscellaneous

* **@camox/api-contract:** Synchronize camox versions

## [0.31.2](https://github.com/remidej/camox/compare/camox-v0.31.1...@camox/api-contract-v0.31.2) (2026-05-27)


### Miscellaneous

* **@camox/api-contract:** Synchronize camox versions

## [0.31.1](https://github.com/remidej/camox/compare/camox-v0.31.0...@camox/api-contract-v0.31.1) (2026-05-26)


### Miscellaneous

* **@camox/api-contract:** Synchronize camox versions

## [0.31.0](https://github.com/remidej/camox/compare/camox-v0.30.0...@camox/api-contract-v0.31.0) (2026-05-26)


### Miscellaneous

* **@camox/api-contract:** Synchronize camox versions

## [0.30.0](https://github.com/remidej/camox/compare/camox-v0.29.1...@camox/api-contract-v0.30.0) (2026-05-26)


### Features

* add streaming agent endpoint ([1031a4a](https://github.com/remidej/camox/commit/1031a4adec4d4c1b7ab18ff9e8b3497618b68a50))
* **sdk:** add rough agent chat ui ([80b150d](https://github.com/remidej/camox/commit/80b150dd2ebc3573d0409497b4a5a9afcff251d5))

## [0.29.1](https://github.com/remidej/camox/compare/camox-v0.29.0...@camox/api-contract-v0.29.1) (2026-05-22)


### Bug Fixes

* posthog public key ([48dfbe6](https://github.com/remidej/camox/commit/48dfbe6f667136b0b4aaad3ad9bb8c916a3730fa))

## [0.29.0](https://github.com/remidej/camox/compare/camox-v0.28.6...@camox/api-contract-v0.29.0) (2026-05-22)


### Miscellaneous

* **@camox/api-contract:** Synchronize camox versions

## [0.28.6](https://github.com/remidej/camox/compare/camox-v0.28.5...@camox/api-contract-v0.28.6) (2026-05-22)


### Miscellaneous

* **@camox/api-contract:** Synchronize camox versions

## [0.28.5](https://github.com/remidej/camox/compare/camox-v0.28.4...@camox/api-contract-v0.28.5) (2026-05-22)


### Miscellaneous

* **@camox/api-contract:** Synchronize camox versions

## [0.28.4](https://github.com/remidej/camox/compare/camox-v0.28.3...@camox/api-contract-v0.28.4) (2026-05-22)


### Miscellaneous

* **@camox/api-contract:** Synchronize camox versions

## [0.28.3](https://github.com/remidej/camox/compare/camox-v0.28.2...@camox/api-contract-v0.28.3) (2026-05-20)


### Bug Fixes

* pnpm 11 security features breaking app creation ([7705647](https://github.com/remidej/camox/commit/7705647ad67beb80f57fb3e23b0b1ad40b6e9423))

## [0.28.2](https://github.com/remidej/camox/compare/camox-v0.28.1...@camox/api-contract-v0.28.2) (2026-05-19)


### Miscellaneous

* **@camox/api-contract:** Synchronize camox versions

## [0.28.1](https://github.com/remidej/camox/compare/camox-v0.28.0...@camox/api-contract-v0.28.1) (2026-05-19)


### Miscellaneous

* upgrade all deps ([fead81a](https://github.com/remidej/camox/commit/fead81ab55a771bf1d75b467e9fa45535a22b883))

## [0.28.0](https://github.com/remidej/camox/compare/camox-v0.27.0...@camox/api-contract-v0.28.0) (2026-05-18)


### Miscellaneous

* **@camox/api-contract:** Synchronize camox versions

## [0.27.0](https://github.com/remidej/camox/compare/camox-v0.26.0...@camox/api-contract-v0.27.0) (2026-05-18)


### Miscellaneous

* **@camox/api-contract:** Synchronize camox versions

## [0.26.0](https://github.com/remidej/camox/compare/camox-v0.25.0...@camox/api-contract-v0.26.0) (2026-05-18)


### Miscellaneous

* **@camox/api-contract:** Synchronize camox versions

## [0.25.0](https://github.com/remidej/camox/compare/camox-v0.24.1...@camox/api-contract-v0.25.0) (2026-05-18)


### Features

* add draft-publish status badges and preview toggle (phase 2) ([5cab5bf](https://github.com/remidej/camox/commit/5cab5bf54e328b4508aecb3ecd8b8de2478b1771))

## [0.24.1](https://github.com/remidej/camox/compare/camox-v0.24.0...@camox/api-contract-v0.24.1) (2026-05-16)


### Miscellaneous

* **@camox/api-contract:** Synchronize camox versions

## [0.24.0](https://github.com/remidej/camox/compare/camox-v0.23.0...@camox/api-contract-v0.24.0) (2026-05-16)


### Miscellaneous

* **@camox/api-contract:** Synchronize camox versions

## [0.23.0](https://github.com/remidej/camox/compare/camox-v0.22.0...@camox/api-contract-v0.23.0) (2026-05-16)


### Miscellaneous

* **@camox/api-contract:** Synchronize camox versions

## [0.22.0](https://github.com/remidej/camox/compare/camox-v0.21.0...@camox/api-contract-v0.22.0) (2026-05-15)


### Miscellaneous

* **@camox/api-contract:** Synchronize camox versions

## [0.21.0](https://github.com/remidej/camox/compare/camox-v0.20.0...@camox/api-contract-v0.21.0) (2026-05-13)


### Miscellaneous

* **@camox/api-contract:** Synchronize camox versions

## [0.20.0](https://github.com/remidej/camox/compare/camox-v0.19.0...@camox/api-contract-v0.20.0) (2026-05-13)


### Features

* **environments:** add push/pull replication between dev and production ([c9a9de3](https://github.com/remidej/camox/commit/c9a9de30b889b1ac523e61257d6828c1d25a3490))

## [0.19.0](https://github.com/remidej/camox/compare/camox-v0.18.2...@camox/api-contract-v0.19.0) (2026-05-13)


### Miscellaneous

* **@camox/api-contract:** Synchronize camox versions

## [0.18.2](https://github.com/remidej/camox/compare/camox-v0.18.1...@camox/api-contract-v0.18.2) (2026-05-12)


### Miscellaneous

* **@camox/api-contract:** Synchronize camox versions

## [0.18.1](https://github.com/remidej/camox/compare/camox-v0.18.0...@camox/api-contract-v0.18.1) (2026-05-11)


### Miscellaneous

* **@camox/api-contract:** Synchronize camox versions

## [0.18.0](https://github.com/remidej/camox/compare/camox-v0.17.7...@camox/api-contract-v0.18.0) (2026-05-10)


### Features

* **web:** add youtube demo block ([9057270](https://github.com/remidej/camox/commit/90572704b998b1642a109903a5082305b8163d37))

## [0.17.7](https://github.com/remidej/camox/compare/camox-v0.17.6...@camox/api-contract-v0.17.7) (2026-05-07)


### Miscellaneous

* **@camox/api-contract:** Synchronize camox versions

## [0.17.6](https://github.com/remidej/camox/compare/camox-v0.17.5...@camox/api-contract-v0.17.6) (2026-05-07)


### Miscellaneous

* **@camox/api-contract:** Synchronize camox versions

## [0.17.5](https://github.com/remidej/camox/compare/camox-v0.17.4...@camox/api-contract-v0.17.5) (2026-05-07)


### Miscellaneous

* **@camox/api-contract:** Synchronize camox versions

## [0.17.4](https://github.com/remidej/camox/compare/camox-v0.17.3...@camox/api-contract-v0.17.4) (2026-05-07)


### Miscellaneous

* **@camox/api-contract:** Synchronize camox versions

## [0.17.3](https://github.com/remidej/camox/compare/camox-v0.17.2...@camox/api-contract-v0.17.3) (2026-05-07)


### Bug Fixes

* add esbuild to api-contract ([dd53c4c](https://github.com/remidej/camox/commit/dd53c4cff7dd7b0e2c25b017e4ec07d88d6bff29))

## [0.17.2](https://github.com/remidej/camox/compare/camox-v0.17.1...@camox/api-contract-v0.17.2) (2026-05-07)


### Bug Fixes

* posthog public key not in build ([05353c1](https://github.com/remidej/camox/commit/05353c184d1887e344216610e8ece36ebfb7e348))

## [0.17.1](https://github.com/remidej/camox/compare/camox-v0.17.0...@camox/api-contract-v0.17.1) (2026-05-07)


### Miscellaneous

* more tracking events ([69c81ab](https://github.com/remidej/camox/commit/69c81ab36ec65f1f181fe2aeb7203697f3fe28d6))

## [0.17.0](https://github.com/remidej/camox/compare/camox-v0.16.1...@camox/api-contract-v0.17.0) (2026-05-06)


### Miscellaneous

* **@camox/api-contract:** Synchronize camox versions

## [0.16.1](https://github.com/remidej/camox/compare/camox-v0.16.0...@camox/api-contract-v0.16.1) (2026-05-05)


### Miscellaneous

* **@camox/api-contract:** Synchronize camox versions

## [0.16.0](https://github.com/remidej/camox/compare/camox-v0.15.1...@camox/api-contract-v0.16.0) (2026-05-05)


### Miscellaneous

* **@camox/api-contract:** Synchronize camox versions

## [0.15.1](https://github.com/remidej/camox/compare/camox-v0.15.0...@camox/api-contract-v0.15.1) (2026-04-30)


### Bug Fixes

* remove metadata cli commands ([f63eaca](https://github.com/remidej/camox/commit/f63eacaf71464730e9d97e258eba6d4670a2cdfd))

## [0.15.0](https://github.com/remidej/camox/compare/camox-v0.14.2...@camox/api-contract-v0.15.0) (2026-04-30)


### Miscellaneous

* **@camox/api-contract:** Synchronize camox versions

## [0.14.2](https://github.com/remidej/camox/compare/camox-v0.14.1...@camox/api-contract-v0.14.2) (2026-04-28)


### Miscellaneous

* **@camox/api-contract:** Synchronize camox versions

## [0.14.1](https://github.com/remidej/camox/compare/camox-v0.14.0...@camox/api-contract-v0.14.1) (2026-04-28)


### Miscellaneous

* **@camox/api-contract:** Synchronize camox versions

## [0.14.0](https://github.com/remidej/camox/compare/camox-v0.13.0...@camox/api-contract-v0.14.0) (2026-04-27)


### Miscellaneous

* **@camox/api-contract:** Synchronize camox versions

## [0.13.0](https://github.com/remidej/camox/compare/camox-v0.12.1...@camox/api-contract-v0.13.0) (2026-04-24)


### Miscellaneous

* **@camox/api-contract:** Synchronize camox versions

## [0.12.1](https://github.com/remidej/camox/compare/camox-v0.12.0...@camox/api-contract-v0.12.1) (2026-04-23)


### Miscellaneous

* set up nx groups ([2e2128a](https://github.com/remidej/camox/commit/2e2128a80133c7c9e599d85ef855223aefb64d4c))

## [0.12.0](https://github.com/remidej/camox/compare/camox-v0.11.0...@camox/api-contract-v0.12.0) (2026-04-23)


### Miscellaneous

* **@camox/api-contract:** Synchronize camox versions

## [0.11.0](https://github.com/remidej/camox/compare/camox-v0.10.1...@camox/api-contract-v0.11.0) (2026-04-20)


### Miscellaneous

* **@camox/api-contract:** Synchronize camox versions

## [0.10.1](https://github.com/remidej/camox/compare/camox-v0.10.0...@camox/api-contract-v0.10.1) (2026-04-20)


### Miscellaneous

* **@camox/api-contract:** Synchronize camox versions

## [0.10.0](https://github.com/remidej/camox/compare/camox-v0.9.1...@camox/api-contract-v0.10.0) (2026-04-19)


### Miscellaneous

* **@camox/api-contract:** Synchronize camox versions

## [0.9.1](https://github.com/remidej/camox/compare/camox-v0.9.0...@camox/api-contract-v0.9.1) (2026-04-18)


### Miscellaneous

* **@camox/api-contract:** Synchronize camox versions

## [0.9.0](https://github.com/remidej/camox/compare/camox-v0.8.0...@camox/api-contract-v0.9.0) (2026-04-17)


### Miscellaneous

* **@camox/api-contract:** Synchronize camox versions

## [0.8.0](https://github.com/remidej/camox/compare/camox-v0.7.3...@camox/api-contract-v0.8.0) (2026-04-16)


### Miscellaneous

* **@camox/api-contract:** Synchronize camox versions

## [0.7.3](https://github.com/remidej/camox/compare/camox-v0.7.2...@camox/api-contract-v0.7.3) (2026-04-16)


### Miscellaneous

* **@camox/api-contract:** Synchronize camox versions

## [0.7.2](https://github.com/remidej/camox/compare/camox-v0.7.1...@camox/api-contract-v0.7.2) (2026-04-16)


### Miscellaneous

* **@camox/api-contract:** Synchronize camox versions

## [0.7.1](https://github.com/remidej/camox/compare/camox-v0.7.0...@camox/api-contract-v0.7.1) (2026-04-16)


### Miscellaneous

* add api contract package ([491ef44](https://github.com/remidej/camox/commit/491ef44c119f28a2f3ccecb34b8cdbcf632849e1))
