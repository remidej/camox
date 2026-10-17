:robot: I have created a release *beep* *boop*
---


<details><summary>camox: 1.0.0</summary>

## [1.0.0](https://github.com/remidej/camox/compare/camox-v0.44.0...camox-v1.0.0) (2026-10-17)


###   BREAKING CHANGES

* remove comments ([#298](https://github.com/remidej/camox/issues/298))

### Features

* **api:** conform content to its definitions on read ([#254](https://github.com/remidej/camox/issues/254)) ([e0b47e1](https://github.com/remidej/camox/commit/e0b47e1604ab494eae8c9b3e6d8e30045443ef3e))
* **api:** identify definitions by their names ([#255](https://github.com/remidej/camox/issues/255)) ([0024c88](https://github.com/remidej/camox/commit/0024c8870a64fd2f67b5cb461bd9fdd6c7ad021b))
* **api:** optimize short videos at source resolution ([2436b6a](https://github.com/remidej/camox/commit/2436b6a0d96a15af72633897ec8a3204705d9ffb))
* **api:** store a synced block's shared content as one entity ([#261](https://github.com/remidej/camox/issues/261)) ([4f48652](https://github.com/remidej/camox/commit/4f4865294750069177f94b54887aca0d347cac53))
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
* **cli:** expose layout-owned block discovery ([975bf9a](https://github.com/remidej/camox/commit/975bf9a8056810272f24864ade2b87fbaf148418))
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
* drafts v1 ([e6473b2](https://github.com/remidej/camox/commit/e6473b2ffd21e7ba3a404a03c6a73dccae136876))
* edit a record in place on its record page ([#210](https://github.com/remidej/camox/issues/210)) ([3671b73](https://github.com/remidej/camox/commit/3671b738da03e43494355533e78388544df2f5d0)), closes [#190](https://github.com/remidej/camox/issues/190)
* edit blocks in a draft while Live stays unchanged ([#262](https://github.com/remidej/camox/issues/262)) ([4ea5fcd](https://github.com/remidej/camox/commit/4ea5fcda4eef980a6e43f1f133370618d783ce84))
* files in drafts ([#271](https://github.com/remidej/camox/issues/271)) ([b38b21f](https://github.com/remidej/camox/commit/b38b21f56b67451f69237e8b92f1e8cc5590b550)), closes [#240](https://github.com/remidej/camox/issues/240)
* generated values sit beside content ([#272](https://github.com/remidej/camox/issues/272)) ([81cb4da](https://github.com/remidej/camox/commit/81cb4da1330ccb25784e3ec3587d8feaba7cd130)), closes [#244](https://github.com/remidej/camox/issues/244)
* identify files, collection records and comments by UUIDv7 ([#253](https://github.com/remidej/camox/issues/253)) ([2efc5da](https://github.com/remidej/camox/commit/2efc5da7a6c56e6bc3428d954684fb23f36d1b80))
* identify pages, blocks and repeatable items by UUIDv7 ([#260](https://github.com/remidej/camox/issues/260)) ([ee3a8c9](https://github.com/remidej/camox/commit/ee3a8c90af9bd5d79803c53cc5c4dc8b17fe56cb))
* **landing:** illustrate features with artifacts and pause motion in the Canvas ([#284](https://github.com/remidej/camox/issues/284)) ([2d4d1f6](https://github.com/remidej/camox/commit/2d4d1f621a811ecd578e80b690e80645b3a6bfe1))
* layout Markdown and metadata for singleton and derived pages ([#179](https://github.com/remidej/camox/issues/179)) ([eb4a89c](https://github.com/remidej/camox/commit/eb4a89c0e5e6fec2334c97e577442030e5031e4b))
* make Live read-only ([#273](https://github.com/remidej/camox/issues/273)) ([4ff0e5e](https://github.com/remidej/camox/commit/4ff0e5ec4f1475daf0eff8a7e170c9aba9e8c0e9)), closes [#245](https://github.com/remidej/camox/issues/245)
* manual reference lists ([#137](https://github.com/remidej/camox/issues/137)) ([9b4714d](https://github.com/remidej/camox/commit/9b4714d02a675bef97f2c831a3ae4b259277fc43))
* migrate landing's Live with a rehearsed script ([#276](https://github.com/remidej/camox/issues/276)) ([e560dd5](https://github.com/remidej/camox/commit/e560dd5a38a3481a21a4697d06fb75898fd8bd3e)), closes [#249](https://github.com/remidej/camox/issues/249)
* navigation and realtime follow the selected draft ([#263](https://github.com/remidej/camox/issues/263)) ([4cbf39f](https://github.com/remidej/camox/commit/4cbf39feedda355995e10b177468f5a868f7c1b0)), closes [#237](https://github.com/remidej/camox/issues/237)
* pages, repeatable items and synced content in drafts ([#269](https://github.com/remidej/camox/issues/269)) ([af252a6](https://github.com/remidej/camox/commit/af252a6603ebdde401a23b071e5f7aec1f7f37c4)), closes [#238](https://github.com/remidej/camox/issues/238)
* **playground:** seed demo articles automatically in dev ([#146](https://github.com/remidej/camox/issues/146)) ([37cc0e0](https://github.com/remidej/camox/commit/37cc0e0aa3b834b3ffabe4bb9aeb9508fd55c28a))
* **playground:** show a dotted globe artifact in the hero ([11b9cce](https://github.com/remidej/camox/commit/11b9cce4e0802637b3de17e14519dbc48f14e596))
* publish a record from its record page ([#207](https://github.com/remidej/camox/issues/207)) ([bdb28e0](https://github.com/remidej/camox/commit/bdb28e03907d69b74dafa4b0888b750afb3a07b9)), closes [#189](https://github.com/remidej/camox/issues/189)
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
* **sdk:** collapse a selected page's blocks in the canvas sidebar ([#291](https://github.com/remidej/camox/issues/291)) ([4cb5a18](https://github.com/remidej/camox/commit/4cb5a18ca09be950b880c4c98b7885922d43b642))
* **sdk:** dedicate the right sidebar to chat and feedback ([#283](https://github.com/remidej/camox/issues/283)) ([8fe5f43](https://github.com/remidej/camox/commit/8fe5f43c0a7752950af97cebcf27f55ac3816e53))
* **sdk:** delete and create pages from the canvas sidebars ([#294](https://github.com/remidej/camox/issues/294)) ([f477a94](https://github.com/remidej/camox/commit/f477a948a50ca905eb833de1e4ddbf58e94e9d0f))
* **sdk:** edit collection items in modals ([de60791](https://github.com/remidej/camox/commit/de607911d1913a82ff7d83dbc0d499aa9fe79d16))
* **sdk:** edit referenced collection records in the sidebar and preview ([#131](https://github.com/remidej/camox/issues/131)) ([04dba27](https://github.com/remidej/camox/commit/04dba2711ae10c2fda387d052e245823d993f1a2))
* **sdk:** enable feedback by default ([26ee749](https://github.com/remidej/camox/commit/26ee749f00e51cf57b1e4dabd13b38850a57825e))
* **sdk:** enable interactive canvas editing ([9496b27](https://github.com/remidej/camox/commit/9496b273154f2743dadf4c8bc2f932435433c770))
* **sdk:** extend canvas comment indicators to all page targets ([b8f0bbc](https://github.com/remidej/camox/commit/b8f0bbc294e458c737d1fd6bc8069069ec394200))
* **sdk:** give artifacts scroll progress, content height and navigation ([#180](https://github.com/remidej/camox/issues/180)) ([bbbd515](https://github.com/remidej/camox/commit/bbbd515e7988834b30d5aea49290dd5efaf17f22))
* **sdk:** inject the camox runtime into artifacts and expose camox.studio ([#177](https://github.com/remidej/camox/issues/177)) ([d8df07c](https://github.com/remidej/camox/commit/d8df07ccee7ad4cc1e98d14208ee7d0ba80c31f5))
* **sdk:** keep the page mounted across Edit Mode, and speed up the Canvas ([#293](https://github.com/remidej/camox/issues/293)) ([7a263c7](https://github.com/remidej/camox/commit/7a263c781a61698f79fc1d180eae1abd83932a6e))
* **sdk:** link and serve each page's Markdown Representation at a .md URL ([#285](https://github.com/remidej/camox/issues/285)) ([593a684](https://github.com/remidej/camox/commit/593a6843a49a1c7111442c6de98a4341e2659aab))
* **sdk:** move live site control to navbar ([621fb2c](https://github.com/remidej/camox/commit/621fb2c7b88bcb8822a7457edcb2bb94e0ee71e7))
* **sdk:** move preview overlays into the canvas ([284579d](https://github.com/remidej/camox/commit/284579d0c303265423979942d2ae4bc3b77fa160))
* **sdk:** offer drafts actions in the command palette ([#289](https://github.com/remidej/camox/issues/289)) ([8f87986](https://github.com/remidej/camox/commit/8f879861bdc1e37d30669f268c4ecd93fae2a7a6))
* **sdk:** open canvas comments in inline popovers ([50a3b79](https://github.com/remidej/camox/commit/50a3b795884ce6bc6768e30f0de2b79a9d2417cb))
* **sdk:** pass the request's source to loaders and route discovery ([#191](https://github.com/remidej/camox/issues/191)) ([18836be](https://github.com/remidej/camox/commit/18836be48944375bf2fc52fb5527fd6c3c0822ee))
* **sdk:** print authenticated development links ([20cbdb8](https://github.com/remidej/camox/commit/20cbdb8b77fd948dc5531fe7986a9240fc453f57))
* **sdk:** render an artifact field ([#172](https://github.com/remidej/camox/issues/172)) ([122e7a6](https://github.com/remidej/camox/commit/122e7a62f0be64b60d407a48b1661351caa37594))
* **sdk:** render themed mountain image placeholders ([ad8cb8f](https://github.com/remidej/camox/commit/ad8cb8f5804a1a365ea4eb05d8224efcb04d238f))
* **sdk:** replace add-block sidebar with a searchable grid dialog ([93ce362](https://github.com/remidej/camox/commit/93ce3624a7b78ea11c8edac749fe13449a38ccbb))
* **sdk:** replace editable preview with canvas ([b0eda62](https://github.com/remidej/camox/commit/b0eda628823a1d8dbbfd1116fe3ab09fa2b6011d))
* **sdk:** set the favicon from the studio's project menu ([#287](https://github.com/remidej/camox/issues/287)) ([ba000b9](https://github.com/remidej/camox/commit/ba000b9820d62152819865aa69f19951e09cd03d))
* **sdk:** share sibling fields and settings with artifacts as Artifact Data ([#182](https://github.com/remidej/camox/issues/182)) ([bd765b5](https://github.com/remidej/camox/commit/bd765b5ab73bf87d34e94c9d1da3f0397356df79))
* **sdk:** show field comments on canvas ([a3c2f4b](https://github.com/remidej/camox/commit/a3c2f4bfbe9f0ddd5b802e650e52ecffbe127af9))
* **sdk:** show insertion seam guides ([6772f39](https://github.com/remidej/camox/commit/6772f39b9833f64125cc0a64a95cf13e8c501f02))
* **sdk:** show page status badges in canvas ([ac983da](https://github.com/remidej/camox/commit/ac983da6360662f93cb62eb0a6a9ac0391680e48))
* **sdk:** show site publication status in navbar ([8919e3e](https://github.com/remidej/camox/commit/8919e3e358fc749d84ade3032b6599fd60f99209))
* **sdk:** show the chat sidebar on every Studio page but the preview ([#301](https://github.com/remidej/camox/issues/301)) ([4d812d5](https://github.com/remidej/camox/commit/4d812d57b507cd4f5f81e32c2c17145c83a8d86c))
* **sdk:** show whole canvas action with Cmd+Escape shortcut ([#312](https://github.com/remidej/camox/issues/312)) ([c63108b](https://github.com/remidej/camox/commit/c63108bbfeb3cd594c2e0b6654d3d9590cd37584))
* **sdk:** snap canvas zoom to visible pages and assist vertical scrolling ([c1eaffd](https://github.com/remidej/camox/commit/c1eaffdb2b2d487879dfb51143289867d4065756))
* **sdk:** stabilize canvas slots and enable inline page renaming ([35c8b2b](https://github.com/remidej/camox/commit/35c8b2bfc5174fc3282a6a3c9c3cc64496f927c2))
* **sdk:** theme artifacts with the website's tokens and fonts ([#181](https://github.com/remidej/camox/issues/181)) ([eb23606](https://github.com/remidej/camox/commit/eb23606aaa1ffe1ba345758a9e226cbfb00e4b8f))
* **sdk:** track repeatable items with Fragment refs instead of a wrapper div ([#175](https://github.com/remidej/camox/issues/175)) ([b34d7d2](https://github.com/remidej/camox/commit/b34d7d28edf92f5fbaec066a8e18848a33ecd869)), closes [#119](https://github.com/remidej/camox/issues/119)
* **sdk:** tuck page settings behind a checkbox in the page sidebar ([912dc24](https://github.com/remidej/camox/commit/912dc247a676e6da2505719cbd4a716c9f2be731))
* the drafts control ([#266](https://github.com/remidej/camox/issues/266)) ([59a3597](https://github.com/remidej/camox/commit/59a3597e77404748ad3c339edff396c3bfb9ee64)), closes [#242](https://github.com/remidej/camox/issues/242)
* use the new chamois logo in the dashboard and landing, and a ridgeline footer ([#224](https://github.com/remidej/camox/issues/224)) ([267e826](https://github.com/remidej/camox/commit/267e826e8972fe5025bb8d7ede6b3b4312ff5540))


### Bug Fixes

* add colletions instructions to camoxify skill ([9636d74](https://github.com/remidej/camox/commit/9636d7484c2717c9e216b372d8f5398db167d3f0))
* **api:** enforce JSON schemas before content writes ([d65f58c](https://github.com/remidej/camox/commit/d65f58cfe49ae3ef36615cb458815561f2f786d2)), closes [#122](https://github.com/remidej/camox/issues/122)
* **api:** locate wrangler bin through its package.json ([f655d49](https://github.com/remidej/camox/commit/f655d499707510df2f53f7858ccdd4f1a06293c3))
* **api:** retry AI jobs instead of dropping them on failure ([db4f0c2](https://github.com/remidej/camox/commit/db4f0c252b82f34ab7a93311c3a5f62d85f9b225))
* **api:** validate embed content before writes ([da08a1a](https://github.com/remidej/camox/commit/da08a1a715c4608cd7d5ecac1d75948db3b363a7)), closes [#113](https://github.com/remidej/camox/issues/113)
* **canvas:** change comments count rendering ([c575753](https://github.com/remidej/camox/commit/c57575394f6f2adbf0c2829ce88f11d1a7717ec8))
* **ci:** deploy the dashboard from its built wrangler config ([#282](https://github.com/remidej/camox/issues/282)) ([7965bea](https://github.com/remidej/camox/commit/7965beabf6a2d11679ee0e9d3907ecd724c0c8ea))
* **ci:** type-check workspace packages from source ([#139](https://github.com/remidej/camox/issues/139)) ([40a82d9](https://github.com/remidej/camox/commit/40a82d95005650b016f02e899c1ae08281e54b5f))
* **content:** move assets to a dedicated route ([0b11a62](https://github.com/remidej/camox/commit/0b11a6208f43077c71e93f6584052df5f8dd5928))
* **drafts:** address the feat/drafts review findings ([#277](https://github.com/remidej/camox/issues/277)) ([1e46291](https://github.com/remidej/camox/commit/1e462917c3a258dba5e1134c9de3f8ed4fb4104f)), closes [#226](https://github.com/remidej/camox/issues/226)
* keep drafts out of public Markdown and the sitemap ([#173](https://github.com/remidej/camox/issues/173)) ([9c00554](https://github.com/remidej/camox/commit/9c005540fa8ea65dcff885cc045292900eae7898))
* **landing:** keep footer ridgeline proportions on mobile, remove type-safe block demo ([#259](https://github.com/remidej/camox/issues/259)) ([728a037](https://github.com/remidej/camox/commit/728a037dc1290b6a564cadc294879029d860205c))
* lint errors ([8ca7cee](https://github.com/remidej/camox/commit/8ca7cee221965a4cd2090c69da863d15163fde09))
* **scripts:** run worktree preparation non-interactively ([94c19ac](https://github.com/remidej/camox/commit/94c19ac0453a3d943f8393e8d20b996f803fc6dc))
* **sdk:** Canvas regressions from keeping the page mounted across Edit Mode ([#302](https://github.com/remidej/camox/issues/302)) ([e2443dd](https://github.com/remidej/camox/commit/e2443dd956f69d29643d2553447074fc9c7171fb))
* **sdk:** correct repeater and breadcrumb hover highlights ([424b641](https://github.com/remidej/camox/commit/424b64100c4795f390935b1c3c3f040c21defab8))
* **sdk:** improve canvas zoom and horizontal snapping ([0879aed](https://github.com/remidej/camox/commit/0879aed2a0caf094a741b409a1c89dbb40efa1a0))
* **sdk:** keep @iconify/utils out of client bundles ([#290](https://github.com/remidej/camox/issues/290)) ([c0f0500](https://github.com/remidej/camox/commit/c0f05001bbf7683ff886942e77f0d4e4556f7ff9))
* **sdk:** position preview toolbar beside selected text ([a42b898](https://github.com/remidej/camox/commit/a42b89895673c165bbd3381c540c837d04744b3f))
* **sdk:** preserve viewport context across mode switches ([bdd0f8d](https://github.com/remidej/camox/commit/bdd0f8d5389fb2f404e919b96aca3f02c7a0a4a2))
* **sdk:** prevent placeholder label selection ([40a450b](https://github.com/remidej/camox/commit/40a450bc385fb2cfff9eb22346db287126f09397))
* **sdk:** refine preview layout and live-site availability ([a348724](https://github.com/remidej/camox/commit/a348724f7632e9a0818bb9b9c0c037fa507d8590))
* **sdk:** render a page in a draft on the server ([#281](https://github.com/remidej/camox/issues/281)) ([623922a](https://github.com/remidej/camox/commit/623922a18fa4d857580fb4d08ca4de8e875a2d11))
* **sdk:** reset preview state when leaving the preview ([92d6373](https://github.com/remidej/camox/commit/92d6373b6a24c5f4151d93a5427d6b78d006539d))
* **sdk:** restore realtime preview updates ([bcb6988](https://github.com/remidej/camox/commit/bcb6988e05f9c99363edb90c3d9f1c46c63ccee9))
* **sdk:** stop string field editors at the field's maxLength ([#304](https://github.com/remidej/camox/issues/304)) ([2fd55fe](https://github.com/remidej/camox/commit/2fd55fe1fe75da390a9dce7c47970a08beef5698))
* **ui:** merge credential buttons into inputs and steady menu trigger colors ([#252](https://github.com/remidej/camox/issues/252)) ([e8b31c9](https://github.com/remidej/camox/commit/e8b31c929dbe8bedaa872e7bf22a45be52950051))


### Performance Improvements

* **canvas:** only run the Canvas frames someone is looking at ([#212](https://github.com/remidej/camox/issues/212)) ([94e7c99](https://github.com/remidej/camox/commit/94e7c99aa39864ad6d5873d6af4288ad4d3dc21b))
* **sdk:** load blocks on demand in the browser and preload a page's blocks ([#258](https://github.com/remidej/camox/issues/258)) ([df49cb8](https://github.com/remidej/camox/commit/df49cb84a6aac86bf5057ce0c7963fd475cbf98b))
* **sdk:** promote canvas page headers ([2aa1535](https://github.com/remidej/camox/commit/2aa153545d7da2c36a5d94f85297fb72fdff4b2f))
* **sdk:** slim the HTML of pages with artifacts ([#286](https://github.com/remidej/camox/issues/286)) ([b45c226](https://github.com/remidej/camox/commit/b45c226aa9c147724328a2baddd7f252f91e7094))
* **sdk:** stop shipping Studio code and wasted requests to anonymous visitors ([#305](https://github.com/remidej/camox/issues/305)) ([71379a8](https://github.com/remidej/camox/commit/71379a80e87c6d798b8f5a6affec5d644ee692b5))


### Refactoring

* align terminology across the platform ([5c68704](https://github.com/remidej/camox/commit/5c687042a3fe9892c9faaaa560d567fabd9acdfa))
* **api:** drafts overlay as the only writer, and one content access module ([#306](https://github.com/remidej/camox/issues/306)) ([fd2e7f0](https://github.com/remidej/camox/commit/fd2e7f0aea34bc9bc7be078cd9a9d50046896b9d))
* **api:** migrate services to Effect ([3786cd2](https://github.com/remidej/camox/commit/3786cd29156bc51ce25da0f3498c9276b4991806))
* **api:** one content reader, the only way content leaves the API ([#310](https://github.com/remidej/camox/issues/310)) ([df78584](https://github.com/remidej/camox/commit/df785842e3444fad6729ccadb1fa1f4ece325695))
* **api:** read stored field schemas through one field-kinds module ([#308](https://github.com/remidej/camox/issues/308)) ([f961bc3](https://github.com/remidej/camox/commit/f961bc3b983bde648a2dfcaf2a8504024ac9fe87))
* **api:** replace the migrations with one baseline ([#251](https://github.com/remidej/camox/issues/251)) ([cf5d2cd](https://github.com/remidej/camox/commit/cf5d2cdab1afe8834a1da67d0617be2465cdb8f6))
* drop page and layout checkpoints and per-item publishing ([#256](https://github.com/remidej/camox/issues/256)) ([989cb75](https://github.com/remidej/camox/commit/989cb75c8f20cec2e7f69be00871c2dec34d7adb))
* **sdk:** let a layout own a record placement ([#200](https://github.com/remidej/camox/issues/200)) ([a6d4653](https://github.com/remidej/camox/commit/a6d4653ec2a88cf28bdc3037c879f988f17a4f25))
* **sdk:** migrate layout loaders to result envelopes ([6a9ec27](https://github.com/remidej/camox/commit/6a9ec271b2e1de4108a1310d5c4acc284a926680))
* **sdk:** one draft scope per render and one catalog of studio reads ([#309](https://github.com/remidej/camox/issues/309)) ([eb91eb6](https://github.com/remidej/camox/commit/eb91eb6d00c181e9101a8e114d12c7ae6d79358d))
* **sdk:** one editing frame module for the Preview and the Canvas ([#307](https://github.com/remidej/camox/issues/307)) ([364aedb](https://github.com/remidej/camox/commit/364aedbb3f73824a467f2e75f8fea4b7605f56f0))
* **sdk:** scope preview selection to its page or layout ([5a6e493](https://github.com/remidej/camox/commit/5a6e493519a1e600e828f3d5234d52368dafc0a9))
* **sdk:** tidy record pages after review ([#211](https://github.com/remidej/camox/issues/211)) ([a26a3f6](https://github.com/remidej/camox/commit/a26a3f6059f5d9cc58d91a5da202f9ec55853421))


### Documentation

* add artifact ADR and glossary terms ([c7cc3c2](https://github.com/remidej/camox/commit/c7cc3c2329401074a2bb4d8593185bb955631503))
* add drafts ADR and rewrite publishing glossary ([b0d3132](https://github.com/remidej/camox/commit/b0d3132b37cb18d820c92e46f077b53ae75780a1))
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
* drop obsolete plans and add sandbox-free block changes research ([#223](https://github.com/remidej/camox/issues/223)) ([ca2e659](https://github.com/remidej/camox/commit/ca2e659036ad3f02936837445012fda726f8a894))
* glossary updates and ADRs for drafts refactor ([#225](https://github.com/remidej/camox/issues/225)) ([7b25bbd](https://github.com/remidej/camox/commit/7b25bbdac113ed060d09d7255b4821fb4d7c3a2f))
* **land:** prevent Nx socket path length errors ([248773a](https://github.com/remidej/camox/commit/248773aac6e61f582453fe8a4393dda83b957896))
* link drafts research from the ADR ([9955fa0](https://github.com/remidej/camox/commit/9955fa0a745aa0677dfe3a709728ab593612b337))
* point drafts research at the ADR with relative links ([6a06349](https://github.com/remidej/camox/commit/6a0634918b042a8f42663740b86685707fdf5c22))
* record in-site AI editing platform RFC ([1b092f5](https://github.com/remidej/camox/commit/1b092f5d563a3fd25b21283e8ab14068de6f39e6))
* research D1 limits for publishing ([5cf1685](https://github.com/remidej/camox/commit/5cf168530126b724a0442f5bd2a80ba660628fa2))
* research prior art for parallel content changes ([a20e3da](https://github.com/remidej/camox/commit/a20e3dac53b03b4073092d746e886032c35f631a))
* **sdk:** document repeater callback index ([f2affa9](https://github.com/remidej/camox/commit/f2affa9ae245ae8f800954311cb0d55ec7e58b32))
* specify collections v1 API and behavior ([7440062](https://github.com/remidej/camox/commit/744006248c2d356e05e2fab8aba651938aee1367))


### Miscellaneous

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
</details>

<details><summary>camox-sdk: 1.0.0</summary>

## [1.0.0](https://github.com/remidej/camox/compare/camox-v0.44.0...camox-sdk-v1.0.0) (2026-10-17)


###   BREAKING CHANGES

* remove comments ([#298](https://github.com/remidej/camox/issues/298))

### Features

* **api:** conform content to its definitions on read ([#254](https://github.com/remidej/camox/issues/254)) ([e0b47e1](https://github.com/remidej/camox/commit/e0b47e1604ab494eae8c9b3e6d8e30045443ef3e))
* **api:** identify definitions by their names ([#255](https://github.com/remidej/camox/issues/255)) ([0024c88](https://github.com/remidej/camox/commit/0024c8870a64fd2f67b5cb461bd9fdd6c7ad021b))
* **api:** optimize short videos at source resolution ([2436b6a](https://github.com/remidej/camox/commit/2436b6a0d96a15af72633897ec8a3204705d9ffb))
* **api:** store a synced block's shared content as one entity ([#261](https://github.com/remidej/camox/issues/261)) ([4f48652](https://github.com/remidej/camox/commit/4f4865294750069177f94b54887aca0d347cac53))
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
* **cli:** expose layout-owned block discovery ([975bf9a](https://github.com/remidej/camox/commit/975bf9a8056810272f24864ade2b87fbaf148418))
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
* drafts v1 ([e6473b2](https://github.com/remidej/camox/commit/e6473b2ffd21e7ba3a404a03c6a73dccae136876))
* edit a record in place on its record page ([#210](https://github.com/remidej/camox/issues/210)) ([3671b73](https://github.com/remidej/camox/commit/3671b738da03e43494355533e78388544df2f5d0)), closes [#190](https://github.com/remidej/camox/issues/190)
* edit blocks in a draft while Live stays unchanged ([#262](https://github.com/remidej/camox/issues/262)) ([4ea5fcd](https://github.com/remidej/camox/commit/4ea5fcda4eef980a6e43f1f133370618d783ce84))
* files in drafts ([#271](https://github.com/remidej/camox/issues/271)) ([b38b21f](https://github.com/remidej/camox/commit/b38b21f56b67451f69237e8b92f1e8cc5590b550)), closes [#240](https://github.com/remidej/camox/issues/240)
* generated values sit beside content ([#272](https://github.com/remidej/camox/issues/272)) ([81cb4da](https://github.com/remidej/camox/commit/81cb4da1330ccb25784e3ec3587d8feaba7cd130)), closes [#244](https://github.com/remidej/camox/issues/244)
* identify files, collection records and comments by UUIDv7 ([#253](https://github.com/remidej/camox/issues/253)) ([2efc5da](https://github.com/remidej/camox/commit/2efc5da7a6c56e6bc3428d954684fb23f36d1b80))
* identify pages, blocks and repeatable items by UUIDv7 ([#260](https://github.com/remidej/camox/issues/260)) ([ee3a8c9](https://github.com/remidej/camox/commit/ee3a8c90af9bd5d79803c53cc5c4dc8b17fe56cb))
* **landing:** illustrate features with artifacts and pause motion in the Canvas ([#284](https://github.com/remidej/camox/issues/284)) ([2d4d1f6](https://github.com/remidej/camox/commit/2d4d1f621a811ecd578e80b690e80645b3a6bfe1))
* layout Markdown and metadata for singleton and derived pages ([#179](https://github.com/remidej/camox/issues/179)) ([eb4a89c](https://github.com/remidej/camox/commit/eb4a89c0e5e6fec2334c97e577442030e5031e4b))
* make Live read-only ([#273](https://github.com/remidej/camox/issues/273)) ([4ff0e5e](https://github.com/remidej/camox/commit/4ff0e5ec4f1475daf0eff8a7e170c9aba9e8c0e9)), closes [#245](https://github.com/remidej/camox/issues/245)
* manual reference lists ([#137](https://github.com/remidej/camox/issues/137)) ([9b4714d](https://github.com/remidej/camox/commit/9b4714d02a675bef97f2c831a3ae4b259277fc43))
* navigation and realtime follow the selected draft ([#263](https://github.com/remidej/camox/issues/263)) ([4cbf39f](https://github.com/remidej/camox/commit/4cbf39feedda355995e10b177468f5a868f7c1b0)), closes [#237](https://github.com/remidej/camox/issues/237)
* pages, repeatable items and synced content in drafts ([#269](https://github.com/remidej/camox/issues/269)) ([af252a6](https://github.com/remidej/camox/commit/af252a6603ebdde401a23b071e5f7aec1f7f37c4)), closes [#238](https://github.com/remidej/camox/issues/238)
* **playground:** seed demo articles automatically in dev ([#146](https://github.com/remidej/camox/issues/146)) ([37cc0e0](https://github.com/remidej/camox/commit/37cc0e0aa3b834b3ffabe4bb9aeb9508fd55c28a))
* publish a record from its record page ([#207](https://github.com/remidej/camox/issues/207)) ([bdb28e0](https://github.com/remidej/camox/commit/bdb28e03907d69b74dafa4b0888b750afb3a07b9)), closes [#189](https://github.com/remidej/camox/issues/189)
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
* **sdk:** collapse a selected page's blocks in the canvas sidebar ([#291](https://github.com/remidej/camox/issues/291)) ([4cb5a18](https://github.com/remidej/camox/commit/4cb5a18ca09be950b880c4c98b7885922d43b642))
* **sdk:** dedicate the right sidebar to chat and feedback ([#283](https://github.com/remidej/camox/issues/283)) ([8fe5f43](https://github.com/remidej/camox/commit/8fe5f43c0a7752950af97cebcf27f55ac3816e53))
* **sdk:** delete and create pages from the canvas sidebars ([#294](https://github.com/remidej/camox/issues/294)) ([f477a94](https://github.com/remidej/camox/commit/f477a948a50ca905eb833de1e4ddbf58e94e9d0f))
* **sdk:** edit collection items in modals ([de60791](https://github.com/remidej/camox/commit/de607911d1913a82ff7d83dbc0d499aa9fe79d16))
* **sdk:** edit referenced collection records in the sidebar and preview ([#131](https://github.com/remidej/camox/issues/131)) ([04dba27](https://github.com/remidej/camox/commit/04dba2711ae10c2fda387d052e245823d993f1a2))
* **sdk:** enable feedback by default ([26ee749](https://github.com/remidej/camox/commit/26ee749f00e51cf57b1e4dabd13b38850a57825e))
* **sdk:** enable interactive canvas editing ([9496b27](https://github.com/remidej/camox/commit/9496b273154f2743dadf4c8bc2f932435433c770))
* **sdk:** extend canvas comment indicators to all page targets ([b8f0bbc](https://github.com/remidej/camox/commit/b8f0bbc294e458c737d1fd6bc8069069ec394200))
* **sdk:** give artifacts scroll progress, content height and navigation ([#180](https://github.com/remidej/camox/issues/180)) ([bbbd515](https://github.com/remidej/camox/commit/bbbd515e7988834b30d5aea49290dd5efaf17f22))
* **sdk:** inject the camox runtime into artifacts and expose camox.studio ([#177](https://github.com/remidej/camox/issues/177)) ([d8df07c](https://github.com/remidej/camox/commit/d8df07ccee7ad4cc1e98d14208ee7d0ba80c31f5))
* **sdk:** keep the page mounted across Edit Mode, and speed up the Canvas ([#293](https://github.com/remidej/camox/issues/293)) ([7a263c7](https://github.com/remidej/camox/commit/7a263c781a61698f79fc1d180eae1abd83932a6e))
* **sdk:** link and serve each page's Markdown Representation at a .md URL ([#285](https://github.com/remidej/camox/issues/285)) ([593a684](https://github.com/remidej/camox/commit/593a6843a49a1c7111442c6de98a4341e2659aab))
* **sdk:** move live site control to navbar ([621fb2c](https://github.com/remidej/camox/commit/621fb2c7b88bcb8822a7457edcb2bb94e0ee71e7))
* **sdk:** move preview overlays into the canvas ([284579d](https://github.com/remidej/camox/commit/284579d0c303265423979942d2ae4bc3b77fa160))
* **sdk:** offer drafts actions in the command palette ([#289](https://github.com/remidej/camox/issues/289)) ([8f87986](https://github.com/remidej/camox/commit/8f879861bdc1e37d30669f268c4ecd93fae2a7a6))
* **sdk:** open canvas comments in inline popovers ([50a3b79](https://github.com/remidej/camox/commit/50a3b795884ce6bc6768e30f0de2b79a9d2417cb))
* **sdk:** pass the request's source to loaders and route discovery ([#191](https://github.com/remidej/camox/issues/191)) ([18836be](https://github.com/remidej/camox/commit/18836be48944375bf2fc52fb5527fd6c3c0822ee))
* **sdk:** print authenticated development links ([20cbdb8](https://github.com/remidej/camox/commit/20cbdb8b77fd948dc5531fe7986a9240fc453f57))
* **sdk:** render an artifact field ([#172](https://github.com/remidej/camox/issues/172)) ([122e7a6](https://github.com/remidej/camox/commit/122e7a62f0be64b60d407a48b1661351caa37594))
* **sdk:** render themed mountain image placeholders ([ad8cb8f](https://github.com/remidej/camox/commit/ad8cb8f5804a1a365ea4eb05d8224efcb04d238f))
* **sdk:** replace add-block sidebar with a searchable grid dialog ([93ce362](https://github.com/remidej/camox/commit/93ce3624a7b78ea11c8edac749fe13449a38ccbb))
* **sdk:** replace editable preview with canvas ([b0eda62](https://github.com/remidej/camox/commit/b0eda628823a1d8dbbfd1116fe3ab09fa2b6011d))
* **sdk:** set the favicon from the studio's project menu ([#287](https://github.com/remidej/camox/issues/287)) ([ba000b9](https://github.com/remidej/camox/commit/ba000b9820d62152819865aa69f19951e09cd03d))
* **sdk:** share sibling fields and settings with artifacts as Artifact Data ([#182](https://github.com/remidej/camox/issues/182)) ([bd765b5](https://github.com/remidej/camox/commit/bd765b5ab73bf87d34e94c9d1da3f0397356df79))
* **sdk:** show field comments on canvas ([a3c2f4b](https://github.com/remidej/camox/commit/a3c2f4bfbe9f0ddd5b802e650e52ecffbe127af9))
* **sdk:** show insertion seam guides ([6772f39](https://github.com/remidej/camox/commit/6772f39b9833f64125cc0a64a95cf13e8c501f02))
* **sdk:** show page status badges in canvas ([ac983da](https://github.com/remidej/camox/commit/ac983da6360662f93cb62eb0a6a9ac0391680e48))
* **sdk:** show site publication status in navbar ([8919e3e](https://github.com/remidej/camox/commit/8919e3e358fc749d84ade3032b6599fd60f99209))
* **sdk:** show the chat sidebar on every Studio page but the preview ([#301](https://github.com/remidej/camox/issues/301)) ([4d812d5](https://github.com/remidej/camox/commit/4d812d57b507cd4f5f81e32c2c17145c83a8d86c))
* **sdk:** show whole canvas action with Cmd+Escape shortcut ([#312](https://github.com/remidej/camox/issues/312)) ([c63108b](https://github.com/remidej/camox/commit/c63108bbfeb3cd594c2e0b6654d3d9590cd37584))
* **sdk:** snap canvas zoom to visible pages and assist vertical scrolling ([c1eaffd](https://github.com/remidej/camox/commit/c1eaffdb2b2d487879dfb51143289867d4065756))
* **sdk:** stabilize canvas slots and enable inline page renaming ([35c8b2b](https://github.com/remidej/camox/commit/35c8b2bfc5174fc3282a6a3c9c3cc64496f927c2))
* **sdk:** theme artifacts with the website's tokens and fonts ([#181](https://github.com/remidej/camox/issues/181)) ([eb23606](https://github.com/remidej/camox/commit/eb23606aaa1ffe1ba345758a9e226cbfb00e4b8f))
* **sdk:** track repeatable items with Fragment refs instead of a wrapper div ([#175](https://github.com/remidej/camox/issues/175)) ([b34d7d2](https://github.com/remidej/camox/commit/b34d7d28edf92f5fbaec066a8e18848a33ecd869)), closes [#119](https://github.com/remidej/camox/issues/119)
* **sdk:** tuck page settings behind a checkbox in the page sidebar ([912dc24](https://github.com/remidej/camox/commit/912dc247a676e6da2505719cbd4a716c9f2be731))
* the drafts control ([#266](https://github.com/remidej/camox/issues/266)) ([59a3597](https://github.com/remidej/camox/commit/59a3597e77404748ad3c339edff396c3bfb9ee64)), closes [#242](https://github.com/remidej/camox/issues/242)


### Bug Fixes

* add colletions instructions to camoxify skill ([9636d74](https://github.com/remidej/camox/commit/9636d7484c2717c9e216b372d8f5398db167d3f0))
* **api:** enforce JSON schemas before content writes ([d65f58c](https://github.com/remidej/camox/commit/d65f58cfe49ae3ef36615cb458815561f2f786d2)), closes [#122](https://github.com/remidej/camox/issues/122)
* **canvas:** change comments count rendering ([c575753](https://github.com/remidej/camox/commit/c57575394f6f2adbf0c2829ce88f11d1a7717ec8))
* **ci:** type-check workspace packages from source ([#139](https://github.com/remidej/camox/issues/139)) ([40a82d9](https://github.com/remidej/camox/commit/40a82d95005650b016f02e899c1ae08281e54b5f))
* **content:** move assets to a dedicated route ([0b11a62](https://github.com/remidej/camox/commit/0b11a6208f43077c71e93f6584052df5f8dd5928))
* **drafts:** address the feat/drafts review findings ([#277](https://github.com/remidej/camox/issues/277)) ([1e46291](https://github.com/remidej/camox/commit/1e462917c3a258dba5e1134c9de3f8ed4fb4104f)), closes [#226](https://github.com/remidej/camox/issues/226)
* keep drafts out of public Markdown and the sitemap ([#173](https://github.com/remidej/camox/issues/173)) ([9c00554](https://github.com/remidej/camox/commit/9c005540fa8ea65dcff885cc045292900eae7898))
* lint errors ([8ca7cee](https://github.com/remidej/camox/commit/8ca7cee221965a4cd2090c69da863d15163fde09))
* **sdk:** Canvas regressions from keeping the page mounted across Edit Mode ([#302](https://github.com/remidej/camox/issues/302)) ([e2443dd](https://github.com/remidej/camox/commit/e2443dd956f69d29643d2553447074fc9c7171fb))
* **sdk:** correct repeater and breadcrumb hover highlights ([424b641](https://github.com/remidej/camox/commit/424b64100c4795f390935b1c3c3f040c21defab8))
* **sdk:** improve canvas zoom and horizontal snapping ([0879aed](https://github.com/remidej/camox/commit/0879aed2a0caf094a741b409a1c89dbb40efa1a0))
* **sdk:** keep @iconify/utils out of client bundles ([#290](https://github.com/remidej/camox/issues/290)) ([c0f0500](https://github.com/remidej/camox/commit/c0f05001bbf7683ff886942e77f0d4e4556f7ff9))
* **sdk:** position preview toolbar beside selected text ([a42b898](https://github.com/remidej/camox/commit/a42b89895673c165bbd3381c540c837d04744b3f))
* **sdk:** preserve viewport context across mode switches ([bdd0f8d](https://github.com/remidej/camox/commit/bdd0f8d5389fb2f404e919b96aca3f02c7a0a4a2))
* **sdk:** prevent placeholder label selection ([40a450b](https://github.com/remidej/camox/commit/40a450bc385fb2cfff9eb22346db287126f09397))
* **sdk:** refine preview layout and live-site availability ([a348724](https://github.com/remidej/camox/commit/a348724f7632e9a0818bb9b9c0c037fa507d8590))
* **sdk:** render a page in a draft on the server ([#281](https://github.com/remidej/camox/issues/281)) ([623922a](https://github.com/remidej/camox/commit/623922a18fa4d857580fb4d08ca4de8e875a2d11))
* **sdk:** reset preview state when leaving the preview ([92d6373](https://github.com/remidej/camox/commit/92d6373b6a24c5f4151d93a5427d6b78d006539d))
* **sdk:** restore realtime preview updates ([bcb6988](https://github.com/remidej/camox/commit/bcb6988e05f9c99363edb90c3d9f1c46c63ccee9))
* **sdk:** stop string field editors at the field's maxLength ([#304](https://github.com/remidej/camox/issues/304)) ([2fd55fe](https://github.com/remidej/camox/commit/2fd55fe1fe75da390a9dce7c47970a08beef5698))
* **ui:** merge credential buttons into inputs and steady menu trigger colors ([#252](https://github.com/remidej/camox/issues/252)) ([e8b31c9](https://github.com/remidej/camox/commit/e8b31c929dbe8bedaa872e7bf22a45be52950051))


### Performance Improvements

* **canvas:** only run the Canvas frames someone is looking at ([#212](https://github.com/remidej/camox/issues/212)) ([94e7c99](https://github.com/remidej/camox/commit/94e7c99aa39864ad6d5873d6af4288ad4d3dc21b))
* **sdk:** load blocks on demand in the browser and preload a page's blocks ([#258](https://github.com/remidej/camox/issues/258)) ([df49cb8](https://github.com/remidej/camox/commit/df49cb84a6aac86bf5057ce0c7963fd475cbf98b))
* **sdk:** promote canvas page headers ([2aa1535](https://github.com/remidej/camox/commit/2aa153545d7da2c36a5d94f85297fb72fdff4b2f))
* **sdk:** slim the HTML of pages with artifacts ([#286](https://github.com/remidej/camox/issues/286)) ([b45c226](https://github.com/remidej/camox/commit/b45c226aa9c147724328a2baddd7f252f91e7094))
* **sdk:** stop shipping Studio code and wasted requests to anonymous visitors ([#305](https://github.com/remidej/camox/issues/305)) ([71379a8](https://github.com/remidej/camox/commit/71379a80e87c6d798b8f5a6affec5d644ee692b5))


### Refactoring

* align terminology across the platform ([5c68704](https://github.com/remidej/camox/commit/5c687042a3fe9892c9faaaa560d567fabd9acdfa))
* drop page and layout checkpoints and per-item publishing ([#256](https://github.com/remidej/camox/issues/256)) ([989cb75](https://github.com/remidej/camox/commit/989cb75c8f20cec2e7f69be00871c2dec34d7adb))
* **sdk:** let a layout own a record placement ([#200](https://github.com/remidej/camox/issues/200)) ([a6d4653](https://github.com/remidej/camox/commit/a6d4653ec2a88cf28bdc3037c879f988f17a4f25))
* **sdk:** migrate layout loaders to result envelopes ([6a9ec27](https://github.com/remidej/camox/commit/6a9ec271b2e1de4108a1310d5c4acc284a926680))
* **sdk:** one draft scope per render and one catalog of studio reads ([#309](https://github.com/remidej/camox/issues/309)) ([eb91eb6](https://github.com/remidej/camox/commit/eb91eb6d00c181e9101a8e114d12c7ae6d79358d))
* **sdk:** one editing frame module for the Preview and the Canvas ([#307](https://github.com/remidej/camox/issues/307)) ([364aedb](https://github.com/remidej/camox/commit/364aedbb3f73824a467f2e75f8fea4b7605f56f0))
* **sdk:** scope preview selection to its page or layout ([5a6e493](https://github.com/remidej/camox/commit/5a6e493519a1e600e828f3d5234d52368dafc0a9))
* **sdk:** tidy record pages after review ([#211](https://github.com/remidej/camox/issues/211)) ([a26a3f6](https://github.com/remidej/camox/commit/a26a3f6059f5d9cc58d91a5da202f9ec55853421))


### Documentation

* **sdk:** document repeater callback index ([f2affa9](https://github.com/remidej/camox/commit/f2affa9ae245ae8f800954311cb0d55ec7e58b32))


### Miscellaneous

* clean up warnings and tooling quirks after vite-plus 1.3.0 ([#299](https://github.com/remidej/camox/issues/299)) ([7a9f2c8](https://github.com/remidej/camox/commit/7a9f2c886cdba11c8ff6532896cd60956b0215d9))
* integrate latest main into canvas flights ([dff55e0](https://github.com/remidej/camox/commit/dff55e0e71343c4bfe18f5cd4b305db4cf96864e))
* merge main for collections landing ([c3237cb](https://github.com/remidej/camox/commit/c3237cb474543dac3c4fb042417ddfef5824ef2e))
* merge main into canvas landing ([6eb58c6](https://github.com/remidej/camox/commit/6eb58c6b36332a982b0330c45c26c0795c5e1112))
* merge main into schema validation landing ([21f15da](https://github.com/remidej/camox/commit/21f15da740dfdd991d50d0b194b31f51f941af8f))
</details>

<details><summary>@camox/cli: 1.0.0</summary>

## [1.0.0](https://github.com/remidej/camox/compare/camox-v0.44.0...@camox/cli-v1.0.0) (2026-10-17)


###   BREAKING CHANGES

* remove comments ([#298](https://github.com/remidej/camox/issues/298))

### Features

* **api:** identify definitions by their names ([#255](https://github.com/remidej/camox/issues/255)) ([0024c88](https://github.com/remidej/camox/commit/0024c8870a64fd2f67b5cb461bd9fdd6c7ad021b))
* **cli:** expose layout-owned block discovery ([975bf9a](https://github.com/remidej/camox/commit/975bf9a8056810272f24864ade2b87fbaf148418))
* **cli:** set string fields from files with --field-file ([#174](https://github.com/remidej/camox/issues/174)) ([3b302ba](https://github.com/remidej/camox/commit/3b302ba37115561320049b72cddf6447ce698c48))
* development drafts replace development environments ([#274](https://github.com/remidej/camox/issues/274)) ([e1f8a07](https://github.com/remidej/camox/commit/e1f8a07c69b594d7b9ccb455e8e20d615c015ba6)), closes [#246](https://github.com/remidej/camox/issues/246)
* **dev:** isolate worktree sessions and open playground sign-in ([e5615b6](https://github.com/remidej/camox/commit/e5615b64c679404cd9ba0f360e5aa3e1df4c1f4f))
* drafts v1 ([e6473b2](https://github.com/remidej/camox/commit/e6473b2ffd21e7ba3a404a03c6a73dccae136876))
* generated values sit beside content ([#272](https://github.com/remidej/camox/issues/272)) ([81cb4da](https://github.com/remidej/camox/commit/81cb4da1330ccb25784e3ec3587d8feaba7cd130)), closes [#244](https://github.com/remidej/camox/issues/244)
* identify files, collection records and comments by UUIDv7 ([#253](https://github.com/remidej/camox/issues/253)) ([2efc5da](https://github.com/remidej/camox/commit/2efc5da7a6c56e6bc3428d954684fb23f36d1b80))
* identify pages, blocks and repeatable items by UUIDv7 ([#260](https://github.com/remidej/camox/issues/260)) ([ee3a8c9](https://github.com/remidej/camox/commit/ee3a8c90af9bd5d79803c53cc5c4dc8b17fe56cb))
* publish from the CLI and AI tools, and remove environments ([#275](https://github.com/remidej/camox/issues/275)) ([eb8369b](https://github.com/remidej/camox/commit/eb8369bd433b32cd31ad5f283aed691871e6b395)), closes [#248](https://github.com/remidej/camox/issues/248)
* remove comments ([#298](https://github.com/remidej/camox/issues/298)) ([400b1d9](https://github.com/remidej/camox/commit/400b1d995f4bf88cea175a3684e11c3f3a89fc5d))
* **sdk:** add camox-expand skill ([#171](https://github.com/remidej/camox/issues/171)) ([30738e8](https://github.com/remidej/camox/commit/30738e8a9a98a3b17d5a818c9da098731b0ea8b2))
* **sdk:** print authenticated development links ([20cbdb8](https://github.com/remidej/camox/commit/20cbdb8b77fd948dc5531fe7986a9240fc453f57))
* **sdk:** track repeatable items with Fragment refs instead of a wrapper div ([#175](https://github.com/remidej/camox/issues/175)) ([b34d7d2](https://github.com/remidej/camox/commit/b34d7d28edf92f5fbaec066a8e18848a33ecd869)), closes [#119](https://github.com/remidej/camox/issues/119)


### Bug Fixes

* **drafts:** address the feat/drafts review findings ([#277](https://github.com/remidej/camox/issues/277)) ([1e46291](https://github.com/remidej/camox/commit/1e462917c3a258dba5e1134c9de3f8ed4fb4104f)), closes [#226](https://github.com/remidej/camox/issues/226)
* lint errors ([8ca7cee](https://github.com/remidej/camox/commit/8ca7cee221965a4cd2090c69da863d15163fde09))


### Refactoring

* align terminology across the platform ([5c68704](https://github.com/remidej/camox/commit/5c687042a3fe9892c9faaaa560d567fabd9acdfa))
* drop page and layout checkpoints and per-item publishing ([#256](https://github.com/remidej/camox/issues/256)) ([989cb75](https://github.com/remidej/camox/commit/989cb75c8f20cec2e7f69be00871c2dec34d7adb))


### Miscellaneous

* merge main for collections landing ([c3237cb](https://github.com/remidej/camox/commit/c3237cb474543dac3c4fb042417ddfef5824ef2e))
* merge main into canvas landing ([6eb58c6](https://github.com/remidej/camox/commit/6eb58c6b36332a982b0330c45c26c0795c5e1112))
* merge main into schema validation landing ([21f15da](https://github.com/remidej/camox/commit/21f15da740dfdd991d50d0b194b31f51f941af8f))
</details>

<details><summary>@camox/ui: 1.0.0</summary>

## [1.0.0](https://github.com/remidej/camox/compare/camox-v0.44.0...@camox/ui-v1.0.0) (2026-10-17)


### Features

* **sdk:** set the favicon from the studio's project menu ([#287](https://github.com/remidej/camox/issues/287)) ([ba000b9](https://github.com/remidej/camox/commit/ba000b9820d62152819865aa69f19951e09cd03d))
* **sdk:** track repeatable items with Fragment refs instead of a wrapper div ([#175](https://github.com/remidej/camox/issues/175)) ([b34d7d2](https://github.com/remidej/camox/commit/b34d7d28edf92f5fbaec066a8e18848a33ecd869)), closes [#119](https://github.com/remidej/camox/issues/119)
* **sdk:** tuck page settings behind a checkbox in the page sidebar ([912dc24](https://github.com/remidej/camox/commit/912dc247a676e6da2505719cbd4a716c9f2be731))


### Bug Fixes

* **ui:** merge credential buttons into inputs and steady menu trigger colors ([#252](https://github.com/remidej/camox/issues/252)) ([e8b31c9](https://github.com/remidej/camox/commit/e8b31c929dbe8bedaa872e7bf22a45be52950051))


### Miscellaneous

* clean up warnings and tooling quirks after vite-plus 1.3.0 ([#299](https://github.com/remidej/camox/issues/299)) ([7a9f2c8](https://github.com/remidej/camox/commit/7a9f2c886cdba11c8ff6532896cd60956b0215d9))
</details>

<details><summary>@camox/api-contract: 1.0.0</summary>

## [1.0.0](https://github.com/remidej/camox/compare/camox-v0.44.0...@camox/api-contract-v1.0.0) (2026-10-17)


###   BREAKING CHANGES

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
</details>

<details><summary>create-camox: 1.0.0</summary>

## [1.0.0](https://github.com/remidej/camox/compare/camox-v0.44.0...create-camox-v1.0.0) (2026-10-17)


### Miscellaneous

* **create-camox:** Synchronize camox versions
</details>

---
This PR was generated with [Release Please](https://github.com/googleapis/release-please). See [documentation](https://github.com/googleapis/release-please#release-please).