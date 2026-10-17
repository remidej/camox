# Changelog

## [1.0.0](https://github.com/remidej/camox/compare/camox-v0.44.0...@camox/api-contract-v1.0.0) (2026-10-17)


### ⚠ BREAKING CHANGES

* remove comments ([#298](https://github.com/remidej/camox/issues/298))

### Features

* artifacts in the studio and AI features ([#178](https://github.com/remidej/camox/issues/178)) ([27c789d](https://github.com/remidej/camox/commit/27c789d6a07c019790d2e68ba46d6f9ff9698087))
* **canvas:** show block usage in the Block Catalog ([#167](https://github.com/remidej/camox/issues/167)) ([a0e3d78](https://github.com/remidej/camox/commit/a0e3d786124f5ada7e19f61b5302456e16e77bc6)), closes [#152](https://github.com/remidej/camox/issues/152)
* **canvas:** show Synced Blocks' shared content in the Block Catalog ([#170](https://github.com/remidej/camox/issues/170)) ([ce154f5](https://github.com/remidej/camox/commit/ce154f5e5496d7b4fea3f6c5def6a7a4c999006c))
* **collections:** add item authoring with media library assets ([0017fcc](https://github.com/remidej/camox/commit/0017fccc67a3870df4405a560cc99490c3d0cee2))
* **collections:** make collection records plain content ([#257](https://github.com/remidej/camox/issues/257)) ([58a629a](https://github.com/remidej/camox/commit/58a629a20dfdda91116a6a8ef7d2668e98ea3e18))
* comments in drafts ([#267](https://github.com/remidej/camox/issues/267)) ([cdf6327](https://github.com/remidej/camox/commit/cdf6327c1105331b9b8a1715ff042867eb060879)), closes [#241](https://github.com/remidej/camox/issues/241)
* **content:** add experimental collection browsing and item forms ([6c211bb](https://github.com/remidej/camox/commit/6c211bb51ed661b16202c93b751c6185730298d6))
* development drafts replace development environments ([#274](https://github.com/remidej/camox/issues/274)) ([e1f8a07](https://github.com/remidej/camox/commit/e1f8a07c69b594d7b9ccb455e8e20d615c015ba6)), closes [#246](https://github.com/remidej/camox/issues/246)
* drafts v1 ([e6473b2](https://github.com/remidej/camox/commit/e6473b2ffd21e7ba3a404a03c6a73dccae136876))
* edit blocks in a draft while Live stays unchanged ([#262](https://github.com/remidej/camox/issues/262)) ([4ea5fcd](https://github.com/remidej/camox/commit/4ea5fcda4eef980a6e43f1f133370618d783ce84))
* identify files, collection records and comments by UUIDv7 ([#253](https://github.com/remidej/camox/issues/253)) ([2efc5da](https://github.com/remidej/camox/commit/2efc5da7a6c56e6bc3428d954684fb23f36d1b80))
* identify pages, blocks and repeatable items by UUIDv7 ([#260](https://github.com/remidej/camox/issues/260)) ([ee3a8c9](https://github.com/remidej/camox/commit/ee3a8c90af9bd5d79803c53cc5c4dc8b17fe56cb))
* make Live read-only ([#273](https://github.com/remidej/camox/issues/273)) ([4ff0e5e](https://github.com/remidej/camox/commit/4ff0e5ec4f1475daf0eff8a7e170c9aba9e8c0e9)), closes [#245](https://github.com/remidej/camox/issues/245)
* navigation and realtime follow the selected draft ([#263](https://github.com/remidej/camox/issues/263)) ([4cbf39f](https://github.com/remidej/camox/commit/4cbf39feedda355995e10b177468f5a868f7c1b0)), closes [#237](https://github.com/remidej/camox/issues/237)
* publish from the CLI and AI tools, and remove environments ([#275](https://github.com/remidej/camox/issues/275)) ([eb8369b](https://github.com/remidej/camox/commit/eb8369bd433b32cd31ad5f283aed691871e6b395)), closes [#248](https://github.com/remidej/camox/issues/248)
* publish or discard a draft ([#264](https://github.com/remidej/camox/issues/264)) ([1698b1f](https://github.com/remidej/camox/commit/1698b1f53fe2dc8d19cde57fd9c5a6ff9b01c387)), closes [#236](https://github.com/remidej/camox/issues/236)
* query-backed reference lists ([#145](https://github.com/remidej/camox/issues/145)) ([d4aefd9](https://github.com/remidej/camox/commit/d4aefd99e580d58b1df7d449eb92f9cd2ad14ab1))
* remove comments ([#298](https://github.com/remidej/camox/issues/298)) ([400b1d9](https://github.com/remidej/camox/commit/400b1d995f4bf88cea175a3684e11c3f3a89fc5d))
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
