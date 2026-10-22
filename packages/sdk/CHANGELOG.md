# Changelog

## [0.45.0](https://github.com/remidej/camox/compare/camox-v0.44.0...camox-sdk-v0.45.0) (2026-10-22)


### ⚠ BREAKING CHANGES

* older CLIs and SDK dev servers can't create preview sign-in links (`/one-time-token/generate` is removed).
* camox({ projectSlug }) must become camox({ projectId }) with the Project ID shown in the Camox dashboard. Requires the API from #457.
* SDKs calling the six removed procedures stop syncing definitions. Deploy the API before publishing the SDK that calls definitions.sync.
* remove comments ([#298](https://github.com/remidej/camox/issues/298))

### Features

* **api:** add and remove locales ([#366](https://github.com/remidej/camox/issues/366)) ([3c94915](https://github.com/remidej/camox/commit/3c94915db27c12cbc8145c7baafb4f2b59bfe6b1))
* **api:** conform content to its definitions on read ([#254](https://github.com/remidej/camox/issues/254)) ([e0b47e1](https://github.com/remidej/camox/commit/e0b47e1604ab494eae8c9b3e6d8e30045443ef3e))
* **api:** end threads with their drafts ([#424](https://github.com/remidej/camox/issues/424)) ([801955c](https://github.com/remidej/camox/commit/801955ce27418a2a1bafcc4525182b8aa2430741))
* **api:** identify definitions by their names ([#255](https://github.com/remidej/camox/issues/255)) ([0024c88](https://github.com/remidej/camox/commit/0024c8870a64fd2f67b5cb461bd9fdd6c7ad021b))
* **api:** let localizations diverge in structure ([#388](https://github.com/remidej/camox/issues/388)) ([c9e1ece](https://github.com/remidej/camox/commit/c9e1ece3a8d4e9fb47955c05c967dbf51a65dabc))
* **api:** optimize short videos at source resolution ([2436b6a](https://github.com/remidej/camox/commit/2436b6a0d96a15af72633897ec8a3204705d9ffb))
* **api:** store a synced block's shared content as one entity ([#261](https://github.com/remidej/camox/issues/261)) ([4f48652](https://github.com/remidej/camox/commit/4f4865294750069177f94b54887aca0d347cac53))
* **api:** translate the default locale into every locale ([#376](https://github.com/remidej/camox/issues/376)) ([bec1b50](https://github.com/remidej/camox/commit/bec1b503ceec42c76596b117d83d20ebce5aa890))
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
* navigation and realtime follow the selected draft ([#263](https://github.com/remidej/camox/issues/263)) ([4cbf39f](https://github.com/remidej/camox/commit/4cbf39feedda355995e10b177468f5a868f7c1b0)), closes [#237](https://github.com/remidej/camox/issues/237)
* pages, repeatable items and synced content in drafts ([#269](https://github.com/remidej/camox/issues/269)) ([af252a6](https://github.com/remidej/camox/commit/af252a6603ebdde401a23b071e5f7aec1f7f37c4)), closes [#238](https://github.com/remidej/camox/issues/238)
* **playground:** seed demo articles automatically in dev ([#146](https://github.com/remidej/camox/issues/146)) ([37cc0e0](https://github.com/remidej/camox/commit/37cc0e0aa3b834b3ffabe4bb9aeb9508fd55c28a))
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
* drop page and layout checkpoints and per-item publishing ([#256](https://github.com/remidej/camox/issues/256)) ([989cb75](https://github.com/remidej/camox/commit/989cb75c8f20cec2e7f69be00871c2dec34d7adb))
* **sdk:** let a layout own a record placement ([#200](https://github.com/remidej/camox/issues/200)) ([a6d4653](https://github.com/remidej/camox/commit/a6d4653ec2a88cf28bdc3037c879f988f17a4f25))
* **sdk:** migrate layout loaders to result envelopes ([6a9ec27](https://github.com/remidej/camox/commit/6a9ec271b2e1de4108a1310d5c4acc284a926680))
* **sdk:** one draft scope per render and one catalog of studio reads ([#309](https://github.com/remidej/camox/issues/309)) ([eb91eb6](https://github.com/remidej/camox/commit/eb91eb6d00c181e9101a8e114d12c7ae6d79358d))
* **sdk:** one editing frame module for the Preview and the Canvas ([#307](https://github.com/remidej/camox/issues/307)) ([364aedb](https://github.com/remidej/camox/commit/364aedbb3f73824a467f2e75f8fea4b7605f56f0))
* **sdk:** organize the Canvas sidebar into a navigator and inspectors ([#327](https://github.com/remidej/camox/issues/327)) ([812bffe](https://github.com/remidej/camox/commit/812bffeaefae3ea9cae95281c61d222720293c3e))
* **sdk:** replace Edit Mode with showing the Canvas ([#317](https://github.com/remidej/camox/issues/317)) ([638dbd9](https://github.com/remidej/camox/commit/638dbd974ca146f8ff5e71737c6f6830aeb9a79f))
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

## [0.44.0](https://github.com/remidej/camox/compare/camox-v0.43.0...camox-sdk-v0.44.0) (2026-09-24)

### Features

- add strikethrough marker instead of underline ([5cf5e11](https://github.com/remidej/camox/commit/5cf5e1139881482cab0a97d6efd5a1e915fd1ef5))
- **auth:** isolate credentials and databases per checkout ([730095b](https://github.com/remidej/camox/commit/730095b94dd9634549e2a2576487373e4e7b0936))
- **cli:** list and resolve page comments ([3142dd8](https://github.com/remidej/camox/commit/3142dd8ced6a9a4f08f921ee0583ba9c5c80c391))
- **feedback:** mark comments as done ([28954ae](https://github.com/remidej/camox/commit/28954ae99ef6adfa07ba4f7dc7821d51349224d9))
- **feedback:** persist object comments across environments ([816d09a](https://github.com/remidej/camox/commit/816d09acded7d1fab1efbf791e7f3c55b14393c0))
- **icons:** add typed icon fields and searchable picker ([f7ad47f](https://github.com/remidej/camox/commit/f7ad47f19b92446cda38ebf1a1f6247f7e29b46b))
- **preview:** add authenticated CLI-to-browser draft handoff ([cdad73b](https://github.com/remidej/camox/commit/cdad73b54783d318ba5603a049e10493388de94c)), closes [#114](https://github.com/remidej/camox/issues/114)
- **preview:** send feedback to agent ui ([5de0f81](https://github.com/remidej/camox/commit/5de0f81a5ffc4f3af26483dcfec977a17ec22f0b))
- **sdk:** add feedback shortcut and archive comment action ([99dbf08](https://github.com/remidej/camox/commit/99dbf088afc96948322159cbe4b81220c30b3f3c))
- **sdk:** send page feedback to agent with actionable prompt ([dee4e1f](https://github.com/remidej/camox/commit/dee4e1f8116d60c01e47c37b68b6896cc0c40208))
- **studio:** richer video support ([3f57f7d](https://github.com/remidej/camox/commit/3f57f7da9d4791fd4be2bb0607c23dbe3dd7d940))

### Bug Fixes

- **sdk:** navigate the icon picker as a grid ([f987b6d](https://github.com/remidej/camox/commit/f987b6d2c95c52792719e760dea6204ba0359f49))
- **sdk:** pre-optimize dynamically loaded runtime dependencies ([4d31c60](https://github.com/remidej/camox/commit/4d31c608363505a495320d45301f1db58efe5053))
- **sdk:** show feedback across previews and prompt signed-out users ([595a93a](https://github.com/remidej/camox/commit/595a93a9349e98f12f7c4d587869872ef72d6406))
- **sdk:** show only the deepest overlay highlights ([035db7a](https://github.com/remidej/camox/commit/035db7acc698e177506edefa8770e1781c1219e9))
- **sdk:** simplify page picker and command palette UI ([1cdb95c](https://github.com/remidej/camox/commit/1cdb95c8668f00444effa9233347d58214fb3723))
- **sdk:** tighten page picker and preview path layout ([5d70774](https://github.com/remidej/camox/commit/5d707747bab950ad6a3ec42fc83571f564f2d599))

### Performance Improvements

- **sdk:** virtualize the icon picker grid ([b3cd1bc](https://github.com/remidej/camox/commit/b3cd1bc2f9118cf85a4691ea2e1bea89b5432745))

### Refactoring

- **sdk:** rename comments flag to enableExperimentalFeatures ([fe53fff](https://github.com/remidej/camox/commit/fe53fff36f9586e1240d5623bb9373d1b50fe5a3))

### Documentation

- **sdk:** keep camoxify styling on shadcn and Tailwind ([5dc8099](https://github.com/remidej/camox/commit/5dc8099d6ff6981333817e6eafd2b194f51678fe))
- **sdk:** prefer settings for constrained camoxify choices ([40e7d83](https://github.com/remidej/camox/commit/40e7d83fdfa4652d7b7d73825754d19779380482))

## [0.43.0](https://github.com/remidej/camox/compare/camox-v0.42.0...camox-sdk-v0.43.0) (2026-09-21)

### Features

- add camoxify skill ([fa2f5bf](https://github.com/remidej/camox/commit/fa2f5bf3ba3f7cf653d8d2d4802009236dcaa42e))
- add getElementContext api ([141965c](https://github.com/remidej/camox/commit/141965cedd307e8c47fd5491c1a66ee4ed885900))
- add singleton layouts ([2dee85d](https://github.com/remidej/camox/commit/2dee85de42600f8095925cc8bc5f18838f4eb8cc))
- **cli:** support page SEO metadata updates ([1ca122a](https://github.com/remidej/camox/commit/1ca122aad316b5acc678f811e68d024142eb5b16)), closes [#109](https://github.com/remidej/camox/issues/109)

### Bug Fixes

- **cli:** populate empty blocks with default content ([cce66cf](https://github.com/remidej/camox/commit/cce66cfe912dd600a45da2ffcd4234bfe86b8d47))
- **sdk:** generate formatter-compliant layout declarations ([b8883e9](https://github.com/remidej/camox/commit/b8883e95b696ce084e0acc26f41030f126197d88))
- **sdk:** include production server runtime dependencies ([937528c](https://github.com/remidej/camox/commit/937528cb0bd69c65aa617555deb20b454df17307)), closes [#106](https://github.com/remidej/camox/issues/106)

### Miscellaneous

- less verbose skill contents ([ed62cc9](https://github.com/remidej/camox/commit/ed62cc9e831e8007fe64e21d41a92fa9bc072683))
- more progressive skill discovery ([d837336](https://github.com/remidej/camox/commit/d837336d056b31b651076f7760a6bdf13307f29c))
- transform gradient marker into highlight ([f11523d](https://github.com/remidej/camox/commit/f11523d4ad57cda07308f536cb5a824625c3bb73))

## [0.42.0](https://github.com/remidej/camox/compare/camox-v0.41.1...camox-sdk-v0.42.0) (2026-09-18)

### Features

- add comment ui prototype under flag ([aff4f67](https://github.com/remidej/camox/commit/aff4f6751b2202b0d4922d1224f0f6d74308e2bf))
- add comments sidebar ([a4e8482](https://github.com/remidej/camox/commit/a4e8482c4d8aecc5a2b0802fb6420715043bc2f4))
- page-level comments ui ([2aa557d](https://github.com/remidej/camox/commit/2aa557d80b3bc680e92b7b90613f925d2f941dd6))
- **sdk:** redesign command palette ([1e77ab3](https://github.com/remidej/camox/commit/1e77ab3614826141b9f9881d75e6a01ed0d3588c))

### Bug Fixes

- add new block ui tweaks ([b3085aa](https://github.com/remidej/camox/commit/b3085aa8a7d097dd46dc38c9e1afe3b0c06a838d))
- comments ui tweaks ([b2ed8a2](https://github.com/remidej/camox/commit/b2ed8a297f25f4acd1b3040a7b18b3d7e5b83a83))
- editor editor ui tweaks ([8088b84](https://github.com/remidej/camox/commit/8088b8425577bde01804539a0a017e7c1feaaf2e))
- escape behavior ([73e0cce](https://github.com/remidej/camox/commit/73e0cce528a6fa57ccd4c33b189671238021ac0b))
- **preview:** remove persistent comment bubbles ([6a0c539](https://github.com/remidej/camox/commit/6a0c5397320ba5e59480389cd8e32ee1fef78a30))
- **sdk:** remove form and settings actions from block popover ([80fbf58](https://github.com/remidej/camox/commit/80fbf5801854b7b14a71d73746df9744ea5f2470))
- various ui tweaks ([5baf8d9](https://github.com/remidej/camox/commit/5baf8d9bd1839fe7402b6fa7331fbbeb24679a19))

### Refactoring

- **sdk:** remove obsolete content sheet controls and state ([3c8f2cf](https://github.com/remidej/camox/commit/3c8f2cf4cb3fff293e979126893320b2ee7dc3fd))

### Miscellaneous

- move sdk css output out of dist ([f5ffb40](https://github.com/remidej/camox/commit/f5ffb404172971de3bdf77f110e39e6baec85682))
- refactor comment mode state management ([f32e432](https://github.com/remidej/camox/commit/f32e432eb58ea7f595bed704023cf7a48ee02d44))
- remove telemetry ([9eb6701](https://github.com/remidej/camox/commit/9eb67019d5a4e1fc6a839a07328acb1ae7d5f5d8))

## [0.41.1](https://github.com/remidej/camox/compare/camox-v0.41.0...camox-sdk-v0.41.1) (2026-09-16)

### Bug Fixes

- link and embed editing in preview ([e735499](https://github.com/remidej/camox/commit/e735499c9c82921a1c8f36b279b69a91e2f20080))
- preview not reacting to block setting changes ([e518df4](https://github.com/remidej/camox/commit/e518df435785f064c387495399903d0a0198c6a1))
- toggle edit mode shortcut adding line breaks ([85d78fa](https://github.com/remidej/camox/commit/85d78faa14709b6ba984bb3a00264c871a1761c1))
- view live page showing draft content ([55ab48d](https://github.com/remidej/camox/commit/55ab48d9824c9adfb0bef7d86a9d60ade1bd1fae))

### Miscellaneous

- refactor previewStore to prevent impossible edit live source state ([431b092](https://github.com/remidej/camox/commit/431b0922a16b2a35f9f7ce8b2c06906d1c5825cd))

## [0.41.0](https://github.com/remidej/camox/compare/camox-v0.40.0...camox-sdk-v0.41.0) (2026-09-15)

### Features

- add derived layouts ([2569639](https://github.com/remidej/camox/commit/25696391bf699d5971b64a8eb8d4e978ccb2f11f))
- add gradient text marker ([4a509f4](https://github.com/remidej/camox/commit/4a509f41c70a070b42e2ca7cac69829f92da76b4))
- add publishing controls to derived layouts ([b655dc6](https://github.com/remidej/camox/commit/b655dc68dc6b30c1b7ca894caf0434bf0d98fc25))
- add synced blocks ([f860852](https://github.com/remidej/camox/commit/f860852cc0773f9fe4efaa0d05dbe8b682a6450f))
- show peeked block thumbnails ([e4f1256](https://github.com/remidej/camox/commit/e4f1256fb13c31e4f7a16d46b91753dceed32c58))

### Bug Fixes

- avoid layout shift on navigation with better ssr ([04086be](https://github.com/remidej/camox/commit/04086beba10c55f1b38345867ea3b7b0fb2fadbc))
- better view published page wording ([3ef10ad](https://github.com/remidej/camox/commit/3ef10adad2e6862f7db76b399a934a0a3ea904c0))
- edit link popover ([8f5903d](https://github.com/remidej/camox/commit/8f5903d0c22d0eda3b4030bbda8d194c5a9ef4b0))
- ensure publish actions available when edit mode off ([5ee196b](https://github.com/remidej/camox/commit/5ee196b969f58857502de7f75d71ec148e6e77cc))
- iframe glitch on hydration ([be44552](https://github.com/remidej/camox/commit/be44552e27ce70fe690c26e6c9c0b5dc1bee5594))
- move add new block back to right sidebar ([32eb053](https://github.com/remidej/camox/commit/32eb0533a9892a7b0d4fa93b43af95cf0871e32a))
- prevent selecting derived layouts on curated pages ([600dd87](https://github.com/remidej/camox/commit/600dd87191488e55f53f6ffc02d3bf8e26319812))
- **preview:** remove automatic page peeking ([27ff827](https://github.com/remidej/camox/commit/27ff827b72dcb37b95922472e1f9bf7e60c0cdb8))

### Miscellaneous

- add right sidebar for derived pages ([49e794d](https://github.com/remidej/camox/commit/49e794dc5362e03f09e72b88c0a1ec858eae097e))

## [0.40.0](https://github.com/remidej/camox/compare/camox-v0.39.0...camox-sdk-v0.40.0) (2026-09-11)

### Features

- add mobile preview ui ([56daa0c](https://github.com/remidej/camox/commit/56daa0cd89dc34bec9b5845a349a2ff2d054ddfd))
- hide camox ui in user button popover ([9c603ce](https://github.com/remidej/camox/commit/9c603ce621ee17528301344889ff83e6fb1e2cf2))

## [0.39.0](https://github.com/remidej/camox/compare/camox-v0.38.0...camox-sdk-v0.39.0) (2026-09-02)

### Features

- remove in-app agent chat ([f5a8ed1](https://github.com/remidej/camox/commit/f5a8ed1e331e45344b8170e2358d0763475819f9))

### Bug Fixes

- use title instead of summary in breadcrumbs ([844f51d](https://github.com/remidej/camox/commit/844f51dce5fe0f29654293021e61790dfebe45aa))

### Miscellaneous

- add with without block ([9a74a24](https://github.com/remidej/camox/commit/9a74a24c0fcc4150659ea80d11cb7e737e5d1408))

## [0.38.0](https://github.com/remidej/camox/compare/camox-v0.37.0...camox-sdk-v0.38.0) (2026-08-25)

### Features

- refactor skills into umbrella symlinked skill ([733acea](https://github.com/remidej/camox/commit/733acea2326ba1ef6525c12bf46a86610a7cfda5))

### Miscellaneous

- remove convex generated from ignore patterns ([f8482d3](https://github.com/remidej/camox/commit/f8482d320a653a454584eb586149c446ccdf036e))

## [0.37.0](https://github.com/remidej/camox/compare/camox-v0.36.3...camox-sdk-v0.37.0) (2026-08-21)

### Features

- logged out flow instead of crashing dev server ([b3f6efe](https://github.com/remidej/camox/commit/b3f6efe22b7d97db723982d07fd8262a5a4caad2))
- new camox release command instead of sync secret ([b9776c1](https://github.com/remidej/camox/commit/b9776c1ab8b1acd1f5986d43b34efcc7e00c181c))

## [0.36.3](https://github.com/remidej/camox/compare/camox-v0.36.2...camox-sdk-v0.36.3) (2026-08-09)

### Bug Fixes

- virtual modules breaking generated apps ([dd116eb](https://github.com/remidej/camox/commit/dd116eb5e70fd936c7ae205f39d974296dedc6c0))

## [0.36.2](https://github.com/remidej/camox/compare/camox-v0.36.1...camox-sdk-v0.36.2) (2026-08-06)

### Miscellaneous

- **camox-sdk:** Synchronize camox versions

## [0.36.1](https://github.com/remidej/camox/compare/camox-v0.36.0...camox-sdk-v0.36.1) (2026-08-05)

### Bug Fixes

- **sdk:** missing runtime module in exports ([68cc40e](https://github.com/remidej/camox/commit/68cc40e85de3d0096ae898969681d8992c3b3c6e))

## [0.36.0](https://github.com/remidej/camox/compare/camox-v0.35.0...camox-sdk-v0.36.0) (2026-08-05)

### Features

- add view live page button ([45576d8](https://github.com/remidej/camox/commit/45576d8426db8a1411a6aca4df1a9a0fc56b3bdc))
- display navbar by default ([6a42b90](https://github.com/remidej/camox/commit/6a42b90de343397f5501443a9c67c8d539dd8611))

### Bug Fixes

- navbar displaying wrong theme ([7bb23f7](https://github.com/remidej/camox/commit/7bb23f71cb56e163ccb4a63f56da37d280d27883))
- preview toolbar navigation ([bc49edf](https://github.com/remidej/camox/commit/bc49edfad9cc3e0de893880facab765de87d645d))
- selection breadcrumbs design (metro map style) ([80d68ea](https://github.com/remidej/camox/commit/80d68ea0f487a65f5bb53ced58cb87acb8023ac4))
- toolbar view live site design ([bb5989a](https://github.com/remidej/camox/commit/bb5989abf9c8dfc4bf367829701ed0cea0623dc8))

### Documentation

- rewrite readme presentation ([60b32d9](https://github.com/remidej/camox/commit/60b32d991e87695e5b4ae2d203dd8dc962d95d1d))

### Miscellaneous

- change domain from ai to dev tld ([a008d92](https://github.com/remidej/camox/commit/a008d9205087de7fc450743eb56e37ec9ed827b8))

## [0.35.0](https://github.com/remidej/camox/compare/camox-v0.34.0...camox-sdk-v0.35.0) (2026-07-28)

### Features

- display page meta ([a6bdac8](https://github.com/remidej/camox/commit/a6bdac833cf3d3bf0b5853d884ed3c2e442a109f))

### Bug Fixes

- split website and studio bundles ([c93f110](https://github.com/remidej/camox/commit/c93f110e6d3abe7c668c450f171877e62103307d))

## [0.34.0](https://github.com/remidej/camox/compare/camox-v0.33.1...camox-sdk-v0.34.0) (2026-07-23)

### Features

- add \_future page rendering ([e0fcf09](https://github.com/remidej/camox/commit/e0fcf0976401963f7504e7d25844e5fe86b5832f))
- add defineDocument API ([92552ba](https://github.com/remidej/camox/commit/92552ba2dcae8cf4cdcc51459b083cc69bec936f))
- add hydration to \_future runtime ([19c865f](https://github.com/remidej/camox/commit/19c865fd4ae6497c4568120f8d482e8ce16bea2d))
- nitro-first runtime ([ec92df2](https://github.com/remidej/camox/commit/ec92df24bb483e25ca8a486027d8683a3f62b4b0))
- preserve shared layout upon navigation ([99327fa](https://github.com/remidej/camox/commit/99327fade7bae66aac3ce4446521600c0f21317a))
- render camox routes on future runtime ([31250cd](https://github.com/remidej/camox/commit/31250cdf062791b9edb98abdf4247497d7ded3e5))

### Bug Fixes

- display toolbar upon auth ([dc75a4e](https://github.com/remidej/camox/commit/dc75a4e2b7a2a90a3c8cd44b9fa7c21a750f8296))
- **sdk:** css and js not loading ([9936bfa](https://github.com/remidej/camox/commit/9936bfa8cad1988fa2a797c51139a904f438f5e0))
- ssr not rendering blocks html ([6985198](https://github.com/remidej/camox/commit/69851980ba7ad8fad3bfa47163234773db3d3d95))

### Miscellaneous

- add camox provider to future runtime ([6413270](https://github.com/remidej/camox/commit/64132702fa08a7435c5daf9f812be449f8724067))
- client side navigation ([c69ee0d](https://github.com/remidej/camox/commit/c69ee0d889470888000144851dc8f42fdc24a0ca))
- promote future runtime to default ([e5a8482](https://github.com/remidej/camox/commit/e5a84823f01b0b5443cc6c0ab83fcf2890e8123a))
- register \_future route path ([99b402c](https://github.com/remidej/camox/commit/99b402c5da13a6ef8d6da733120157074196c81b))
- remove tanstack start from playground app ([b5e4e51](https://github.com/remidej/camox/commit/b5e4e51a6ef43c73cbc4dc777a6ca996468a3e38))
- render camox studio routes on future runtime ([63e5e55](https://github.com/remidej/camox/commit/63e5e55cb973670b0c18a5268fe62fb3ed21cbcd))
- split web app into dashboard and landing ([e334ffe](https://github.com/remidej/camox/commit/e334ffe642c66141f670ccbd596c92bf8f7616e0))

## [0.33.1](https://github.com/remidej/camox/compare/camox-v0.33.0...camox-sdk-v0.33.1) (2026-06-30)

### Bug Fixes

- broken auth gate on studio pages ([2663423](https://github.com/remidej/camox/commit/26634239f33dd5fa196a2d0bdfce6ee5796ab2ab))
- remove preview toolbar transitions ([11fb5a2](https://github.com/remidej/camox/commit/11fb5a23dd68bcf769b966028c825279556b1383))

## [0.33.0](https://github.com/remidej/camox/compare/camox-v0.32.0...camox-sdk-v0.33.0) (2026-06-29)

### Features

- add right sidebar ([963a8bb](https://github.com/remidej/camox/commit/963a8bbe3233fe24ec64761453a97f76327649fa))
- add tablet viewport mode ([3b40bfd](https://github.com/remidej/camox/commit/3b40bfde4f66bc7952e093e5771d9bfead6e012c))
- hide toolbar ([0fdf7d7](https://github.com/remidej/camox/commit/0fdf7d7faf4dcc2535f08c97ca62e6860dc6a784))
- move asset picker to a dedicated modal ([12db5f8](https://github.com/remidej/camox/commit/12db5f8ddd562827a4773f83e7e51ea2fdeb2d76))
- new preview toolbar ([ee28363](https://github.com/remidej/camox/commit/ee283632e15d6300b55e3897ba4d8b26b98ef337))
- replace page metadata modal by right sidebar ([2a98bb9](https://github.com/remidej/camox/commit/2a98bb942c2e6bb65e1ced20bb78a2bf6b945b13))
- transform asset field editor into a modal ([cbf4576](https://github.com/remidej/camox/commit/cbf4576d26711739d227d9a74cdb851a37de8fd3))
- vertical selection breadcrumbs in sidebar ([88b1aa9](https://github.com/remidej/camox/commit/88b1aa9f677918ada4aadeeedc702b6f43a9d96a))
- warn before redirecting to sign in ([9b95fe5](https://github.com/remidej/camox/commit/9b95fe51557fe33c624aa7ae596de79e343073d9))

### Bug Fixes

- 404 on camox studio pages ([adc064d](https://github.com/remidej/camox/commit/adc064d3d727943db6133ebeb03c0b3239b14c2d))
- sidebar stealing focus on preview click ([5e87313](https://github.com/remidej/camox/commit/5e8731318920eb002a52fd81641c0b11026a5140))
- ui details ([809fb8b](https://github.com/remidej/camox/commit/809fb8bd600b2ac4c9fd4bb7674f7f545ecaf2d4))
- use existing preview toolbar for unauthenticated localhost visitors ([e1fd2ce](https://github.com/remidej/camox/commit/e1fd2ce50411f710d52731651fd6a2812976c923))

### Miscellaneous

- clean up previewStore ([12f6f07](https://github.com/remidej/camox/commit/12f6f0799a8c5619616e4f88fb9c396e2352e9f2))
- move add block ui to left sidebar ([7ae19ce](https://github.com/remidej/camox/commit/7ae19ce9acb7fddc93fea167e7b515728e17c9b5))
- move ai chat to right sidebar ([28efc91](https://github.com/remidej/camox/commit/28efc91c6ce4b259503f2c9adfe9d94dc6bd66ed))
- organize right sidebar into separate files ([fa83188](https://github.com/remidej/camox/commit/fa8318880c35726e882f3fc527cbbcf131fe05d3))
- remove list of fields from PageTree ([c2c1f60](https://github.com/remidej/camox/commit/c2c1f607b8258d71fe539d4a543523a4a39723c7))
- remove preview side sheet component ([76b0ff5](https://github.com/remidej/camox/commit/76b0ff5ed8c7153a6e73c726b82d19bf7bef2f24))
- rename sidebar files ([2950f1b](https://github.com/remidej/camox/commit/2950f1b754cb994b3e1db5c19c7d58e12bed539a))
- use `/camox` as camox studio path prefix ([c4ea339](https://github.com/remidej/camox/commit/c4ea33955e1456085670974a4d4d66d861be9228))

## [0.32.0](https://github.com/remidej/camox/compare/camox-v0.31.5...camox-sdk-v0.32.0) (2026-06-20)

### Features

- add components prop to Field component ([e2d42c4](https://github.com/remidej/camox/commit/e2d42c499a357793d3281a7bf13cf8780ce7fab0))
- add text links support ([1ba98ee](https://github.com/remidej/camox/commit/1ba98eea74c6e4eed5e98eb2ea4fecb9f3791279))

### Bug Fixes

- link popover editor ([edc0f15](https://github.com/remidej/camox/commit/edc0f15fea0a56e5215010fc10541c4a037b02aa))

## [0.31.5](https://github.com/remidej/camox/compare/camox-v0.31.4...camox-sdk-v0.31.5) (2026-06-09)

### Miscellaneous

- migrate all but api to mit license ([07e31a2](https://github.com/remidej/camox/commit/07e31a2298d0537bb228246ce9fc7e97cbbc83dd))

## [0.31.4](https://github.com/remidej/camox/compare/camox-v0.31.3...camox-sdk-v0.31.4) (2026-05-27)

### Bug Fixes

- server import in client ([294153a](https://github.com/remidej/camox/commit/294153ac437f7377f4824a25056f84dc9de78a54))

## [0.31.3](https://github.com/remidej/camox/compare/camox-v0.31.2...camox-sdk-v0.31.3) (2026-05-27)

### Bug Fixes

- remove tanstack router from vite optimizDeps ([987a1d1](https://github.com/remidej/camox/commit/987a1d12b902bd5188c3bfb97432fceb7e943551))

## [0.31.2](https://github.com/remidej/camox/compare/camox-v0.31.1...camox-sdk-v0.31.2) (2026-05-27)

### Bug Fixes

- hydration error on created apps ([ff8cd51](https://github.com/remidej/camox/commit/ff8cd5111f7744a002e6f8df021d74781b15412a))

## [0.31.1](https://github.com/remidej/camox/compare/camox-v0.31.0...camox-sdk-v0.31.1) (2026-05-26)

### Bug Fixes

- expired cookie triggering 404 ([1005498](https://github.com/remidej/camox/commit/10054985bf4f03c3c597571233aee48b164b0ca4))

## [0.31.0](https://github.com/remidej/camox/compare/camox-v0.30.0...camox-sdk-v0.31.0) (2026-05-26)

### Features

- add aliases to command palette actions ([ebdc132](https://github.com/remidej/camox/commit/ebdc1322db6d2a35279f502f72c0033fcfb5ce5d))

## [0.30.0](https://github.com/remidej/camox/compare/camox-v0.29.1...camox-sdk-v0.30.0) (2026-05-26)

### Features

- add reasoning to agent chat ([155ad15](https://github.com/remidej/camox/commit/155ad156574c6eddfa81e88b5acb02cba7f9ff2e))
- add stop button to agent chat ([f89b9a2](https://github.com/remidej/camox/commit/f89b9a27e8836b71bb0802b52aaa3cb3b56a38c2))
- add validation ui for agent chat tool calls ([827de84](https://github.com/remidej/camox/commit/827de844c964dd0891a277f2673968ca5033aabb))
- auto-navigate to pages created by agent ([083041c](https://github.com/remidej/camox/commit/083041cc4814e3cbc507fa2369c7989135d5e49f))
- move initial page scaffolding to agent chat ([1dc9f66](https://github.com/remidej/camox/commit/1dc9f6663fc059f4b8e36c7179441987fa8568b9))
- new agent thread button ([3c95bbb](https://github.com/remidej/camox/commit/3c95bbbdc76308747ebcbd73bcf16ddd4fcff810))
- render agent chat markdown with streamdown ([1986bb2](https://github.com/remidej/camox/commit/1986bb298f9580f6e61f6c689090eec7f614e77c))
- richer tool call labels ([a2440e3](https://github.com/remidej/camox/commit/a2440e3a390110004ee66bc42a7ff1cd5b4d763e))
- **sdk:** add rough agent chat ui ([80b150d](https://github.com/remidej/camox/commit/80b150dd2ebc3573d0409497b4a5a9afcff251d5))

### Bug Fixes

- agent chat tool calls ui consistency ([35f5de1](https://github.com/remidej/camox/commit/35f5de1d9bef63690326e470018356347f351a9c))
- align agent chat messages to bottom ([96ff72c](https://github.com/remidej/camox/commit/96ff72ceaa3e4e27484915199a95edf6efb02457))
- don't lose agent chat input focus on submit ([0395b8e](https://github.com/remidej/camox/commit/0395b8e37895e128181cd2a532f7b5855693e344))
- persist agent chat state when toggling sheet ([af1f742](https://github.com/remidej/camox/commit/af1f742d778df26f79744b56977dd70f22cfe3df))
- scroll preview to blocks mutated by agent ([8b3a212](https://github.com/remidej/camox/commit/8b3a2124602782963a00169a71db02f688dd3916))
- tool approval ui ([5ac0762](https://github.com/remidej/camox/commit/5ac076203619f6331f4dd6167716cdd23f208af3))

### Miscellaneous

- agent chat ui improvements ([24acf9b](https://github.com/remidej/camox/commit/24acf9b681f9a7030f9d2680f66e0935a586f3e5))
- improve agent chat type safety ([ba5087d](https://github.com/remidej/camox/commit/ba5087d00b38ed475b9d9e45431a57fbc9448cdd))
- use emitCustomEvent for frontend side effects ([21cc759](https://github.com/remidej/camox/commit/21cc759d6f25145b661e3e7b42f8bfaf96231902))

## [0.29.1](https://github.com/remidej/camox/compare/camox-v0.29.0...camox-sdk-v0.29.1) (2026-05-22)

### Miscellaneous

- **camox-sdk:** Synchronize camox versions

## [0.29.0](https://github.com/remidej/camox/compare/camox-v0.28.6...camox-sdk-v0.29.0) (2026-05-22)

### Features

- prefill page path on creation using nickname ([cea4d99](https://github.com/remidej/camox/commit/cea4d99619b4c7bd4c88093d317834057943814d))

### Miscellaneous

- move page status next to nickname in PagePicker ([4de5067](https://github.com/remidej/camox/commit/4de5067031480f855578f7028d34cc626f831d95))

## [0.28.6](https://github.com/remidej/camox/compare/camox-v0.28.5...camox-sdk-v0.28.6) (2026-05-22)

### Bug Fixes

- drop yarn support ([457e2ca](https://github.com/remidej/camox/commit/457e2ca30edbde2f8580109641e6d9c57034389f))

## [0.28.5](https://github.com/remidej/camox/compare/camox-v0.28.4...camox-sdk-v0.28.5) (2026-05-22)

### Bug Fixes

- list of optimized vite deps ([8a14bfa](https://github.com/remidej/camox/commit/8a14bfa1938af5fd2d98d839bf6117bf11ec1617))

## [0.28.4](https://github.com/remidej/camox/compare/camox-v0.28.3...camox-sdk-v0.28.4) (2026-05-22)

### Miscellaneous

- **camox-sdk:** Synchronize camox versions

## [0.28.3](https://github.com/remidej/camox/compare/camox-v0.28.2...camox-sdk-v0.28.3) (2026-05-20)

### Miscellaneous

- **camox-sdk:** Synchronize camox versions

## [0.28.2](https://github.com/remidej/camox/compare/camox-v0.28.1...camox-sdk-v0.28.2) (2026-05-19)

### Bug Fixes

- prevent unpublishing homepage ([79f7058](https://github.com/remidej/camox/commit/79f70588d19253d18ba72496a74150b776eddc61))

## [0.28.1](https://github.com/remidej/camox/compare/camox-v0.28.0...camox-sdk-v0.28.1) (2026-05-19)

### Miscellaneous

- nicer environment compatibility error display ([cf126cf](https://github.com/remidej/camox/commit/cf126cfed37158a9bbc12f1d50d130afbf4b726b))
- upgrade all deps ([fead81a](https://github.com/remidej/camox/commit/fead81ab55a771bf1d75b467e9fa45535a22b883))

## [0.28.0](https://github.com/remidej/camox/compare/camox-v0.27.0...camox-sdk-v0.28.0) (2026-05-18)

### Features

- add blocks get-many tool ([83e8c0a](https://github.com/remidej/camox/commit/83e8c0a7c485d50bba764abb9baa6b5d7a3bd073))

### Bug Fixes

- caomx-cli skill description too long ([697fac0](https://github.com/remidej/camox/commit/697fac004c5396342b5deab8a3ee36db8a6e346b))
- toggle agent chat action ([6b98c86](https://github.com/remidej/camox/commit/6b98c86b69adb95c04d7876b368284e1e81fcb25))

## [0.27.0](https://github.com/remidej/camox/compare/camox-v0.26.0...camox-sdk-v0.27.0) (2026-05-18)

### Features

- add page nickname concept ([478b61e](https://github.com/remidej/camox/commit/478b61e24ea9c91b5a1dcf9382882093c46c0853))
- add publish-related actions to command palette ([4139209](https://github.com/remidej/camox/commit/413920972a5a41e842eb38c7ebe863fa4babcea5))
- add unpublish and discard draft cli commands ([c6b15cb](https://github.com/remidej/camox/commit/c6b15cb790f0280790ff181b5f3bc5725a2c3902))
- unpublish and restore drafts ([5a1c6f5](https://github.com/remidej/camox/commit/5a1c6f51814e6eb6e7cfcb89fd8027e27e65e3c1))

### Bug Fixes

- draft pages ssr ([1258180](https://github.com/remidej/camox/commit/125818007998a7c57aa24c4b558add3c5e58e3a4))
- preview sidebar ui tweaks ([ff5e8cd](https://github.com/remidej/camox/commit/ff5e8cdf182246459fc7bacc47d96b3b343f2e3d))
- stop triggering updates on lexical selection changes ([78de369](https://github.com/remidej/camox/commit/78de369398f8861ecf0b8634694ae673647db7d5))

### Miscellaneous

- update camox-cli for publishing workflows ([1ba85d9](https://github.com/remidej/camox/commit/1ba85d9e8ce1216dbe599c756de82fe24a818cc1))

## [0.26.0](https://github.com/remidej/camox/compare/camox-v0.25.0...camox-sdk-v0.26.0) (2026-05-18)

### Miscellaneous

- **camox-sdk:** Synchronize camox versions

## [0.25.0](https://github.com/remidej/camox/compare/camox-v0.24.1...camox-sdk-v0.25.0) (2026-05-18)

### Features

- add draft-publish status badges and preview toggle (phase 2) ([5cab5bf](https://github.com/remidej/camox/commit/5cab5bf54e328b4508aecb3ecd8b8de2478b1771))
- add publish button ([a609c74](https://github.com/remidej/camox/commit/a609c74b8d85482986b42ae67486ef43b459599a))
- add toggle live/draft content action and shortcut ([eecb5cc](https://github.com/remidej/camox/commit/eecb5cc2643872e558f50cdb388d21c7c50e284d))
- plumb draft-publish snapshots (phase 1) ([fd92d1b](https://github.com/remidej/camox/commit/fd92d1b678807010b701b7c0e7f9adaf618a5661))
- prevent edits when source is live ([8691030](https://github.com/remidej/camox/commit/86910300250f98cdab4dc8754debe772f7fa8f0c))
- publish layout changes ([3f9db46](https://github.com/remidej/camox/commit/3f9db46093f11253091c19d88f06c195da7cc650))

### Bug Fixes

- remove environment name from sidecar file ([d10e7be](https://github.com/remidej/camox/commit/d10e7be4f1521b6088c7624a3c489846da739571))

### Miscellaneous

- draft and publish ui tweaks ([62e6ea5](https://github.com/remidej/camox/commit/62e6ea523d402f1060a018bae9599d13566faa12))
- replace draft select by live content switch ([bd05ef1](https://github.com/remidej/camox/commit/bd05ef11306d07f2b855dd4ffdc9b68cef34529e))

## [0.24.1](https://github.com/remidej/camox/compare/camox-v0.24.0...camox-sdk-v0.24.1) (2026-05-16)

### Bug Fixes

- add get block cli tool ([7f9f7ad](https://github.com/remidej/camox/commit/7f9f7ad97ec508cfe8dc860af003f8293a1e2e36))

## [0.24.0](https://github.com/remidej/camox/compare/camox-v0.23.0...camox-sdk-v0.24.0) (2026-05-16)

### Features

- custom per page opengraph image ([67bc8e0](https://github.com/remidej/camox/commit/67bc8e0c94eb8f27f4133425d2e0ed0e1c5c35d1))

### Bug Fixes

- don't optimize files below 50KB ([676b5c2](https://github.com/remidej/camox/commit/676b5c26bc85ac4119d976b44962024789930026))

### Miscellaneous

- nicer rendering of raster images in AssetCard ([d331336](https://github.com/remidej/camox/commit/d3313363e779e0afec1c654bcf14e5235a4685b7))

## [0.23.0](https://github.com/remidej/camox/compare/camox-v0.22.0...camox-sdk-v0.23.0) (2026-05-16)

### Features

- add env commands to cli ([449231c](https://github.com/remidej/camox/commit/449231c42b55b129d42df071a9eed545c6deb828))
- automatic image optimization ([0ce6e18](https://github.com/remidej/camox/commit/0ce6e18876792f937a1385e9a99a0ad9ac7723ee))

### Bug Fixes

- make assets grid scrollable ([cce9198](https://github.com/remidej/camox/commit/cce9198e26ff31a4ee8caa7917f4db6cfa4326e2))
- only generate ai metadata for raster images ([8740973](https://github.com/remidej/camox/commit/8740973359012f8825354ecb21336b35b6ca5dcf))

### Miscellaneous

- **sdk:** revamp all Type list APIs for consistency ([181dc77](https://github.com/remidej/camox/commit/181dc7745c3cb5297b64bf3ed41c3f3893bef195))

## [0.22.0](https://github.com/remidej/camox/compare/camox-v0.21.0...camox-sdk-v0.22.0) (2026-05-15)

### Features

- render project favicon in camox pages ([b2ec6e5](https://github.com/remidej/camox/commit/b2ec6e5a25fd76e1f328eacbe0e4a44e570aeaf5))

## [0.21.0](https://github.com/remidej/camox/compare/camox-v0.20.0...camox-sdk-v0.21.0) (2026-05-13)

### Features

- **sync:** delete orphaned block definitions ([9db8bae](https://github.com/remidej/camox/commit/9db8baee4d506c8b87c93f1a1e11d0a2f7b64c5b))

### Bug Fixes

- takumi on workers using wasm everywhere ([63b915d](https://github.com/remidej/camox/commit/63b915d40ffe129da63171d669d4c8870f97c7f5))

## [0.20.0](https://github.com/remidej/camox/compare/camox-v0.19.0...camox-sdk-v0.20.0) (2026-05-13)

### Features

- **environments:** add push/pull replication between dev and production ([c9a9de3](https://github.com/remidej/camox/commit/c9a9de30b889b1ac523e61257d6828c1d25a3490))

### Bug Fixes

- **sdk:** alias tslib to its ESM build for SSR ([aeaf963](https://github.com/remidej/camox/commit/aeaf9631cfde8328208ca0d56e681bd74c1f9f8e))
- **sdk:** avoid shiki onig.wasm load in SSR builds ([d6a8063](https://github.com/remidej/camox/commit/d6a80635ac72d5ccd2f1219a39ba63c2b0e0c16c))

### Miscellaneous

- ui tweaks ([1cb638a](https://github.com/remidej/camox/commit/1cb638a3d481b50086395a8e4e0d442cf97b4e5f))

## [0.19.0](https://github.com/remidej/camox/compare/camox-v0.18.2...camox-sdk-v0.19.0) (2026-05-13)

### Bug Fixes

- asset lightbox and page metadata inputs debouncing ([cf385e6](https://github.com/remidej/camox/commit/cf385e68c1f7ce4a64a1a91aba21f39e833ae20b))
- avoid refetching layout blocks on other block update ([6938832](https://github.com/remidej/camox/commit/69388327741abdac5f20c0ba4f8f69bbef57de75))
- make media lib scrollable ([e9754d9](https://github.com/remidej/camox/commit/e9754d94f5d6f346d33117653cc551d78c382623))

## [0.18.2](https://github.com/remidej/camox/compare/camox-v0.18.1...camox-sdk-v0.18.2) (2026-05-12)

### Bug Fixes

- create separate tmp vite cache dir during definitions sync ([185d444](https://github.com/remidej/camox/commit/185d44410bafabd8b0227889d0268dcb1e78cd42))

### Miscellaneous

- remove nitro from apps to prevent vite 504 ([fd3cb82](https://github.com/remidej/camox/commit/fd3cb82773fcd4484a8509aab7dfb1b5c0735a8b))

## [0.18.1](https://github.com/remidej/camox/compare/camox-v0.18.0...camox-sdk-v0.18.1) (2026-05-11)

### Bug Fixes

- vite optimizeDeps 504 breaking hydration ([0befc68](https://github.com/remidej/camox/commit/0befc68fd908a0a7654f3dd5e425f53c52cfef2a))

## [0.18.0](https://github.com/remidej/camox/compare/camox-v0.17.7...camox-sdk-v0.18.0) (2026-05-10)

### Bug Fixes

- multiple assets bugs and api ([0815a17](https://github.com/remidej/camox/commit/0815a17f1fa6ca4efc7258ff4f6ca9af76a3ec6c))

### Miscellaneous

- add multiple assets to fieldTypes ([e94b28e](https://github.com/remidej/camox/commit/e94b28ee698b19be9a5140cbd3e8c5c963608958))

## [0.17.7](https://github.com/remidej/camox/compare/camox-v0.17.6...camox-sdk-v0.17.7) (2026-05-07)

### Miscellaneous

- **camox-sdk:** Synchronize camox versions

## [0.17.6](https://github.com/remidej/camox/compare/camox-v0.17.5...camox-sdk-v0.17.6) (2026-05-07)

### Bug Fixes

- pin xstate store dep ([ae4daa0](https://github.com/remidej/camox/commit/ae4daa00fb9eb18bf0703d480efd634f41fdb701))

## [0.17.5](https://github.com/remidej/camox/compare/camox-v0.17.4...camox-sdk-v0.17.5) (2026-05-07)

### Miscellaneous

- **camox-sdk:** Synchronize camox versions

## [0.17.4](https://github.com/remidej/camox/compare/camox-v0.17.3...camox-sdk-v0.17.4) (2026-05-07)

### Miscellaneous

- **camox-sdk:** Synchronize camox versions

## [0.17.3](https://github.com/remidej/camox/compare/camox-v0.17.2...camox-sdk-v0.17.3) (2026-05-07)

### Miscellaneous

- **camox-sdk:** Synchronize camox versions

## [0.17.2](https://github.com/remidej/camox/compare/camox-v0.17.1...camox-sdk-v0.17.2) (2026-05-07)

### Miscellaneous

- **camox-sdk:** Synchronize camox versions

## [0.17.1](https://github.com/remidej/camox/compare/camox-v0.17.0...camox-sdk-v0.17.1) (2026-05-07)

### Miscellaneous

- more tracking events ([69c81ab](https://github.com/remidej/camox/commit/69c81ab36ec65f1f181fe2aeb7203697f3fe28d6))
- rename analytics to telemetry ([cdc7f9d](https://github.com/remidej/camox/commit/cdc7f9d359a9dd979b2f64d1e564717f6429fddb))

## [0.17.0](https://github.com/remidej/camox/compare/camox-v0.16.1...camox-sdk-v0.17.0) (2026-05-06)

### Features

- add lexical history plugin ([40cf4f9](https://github.com/remidej/camox/commit/40cf4f9629a0a4ea6aba0ed8964c6cf7a4ca790b))

## [0.16.1](https://github.com/remidej/camox/compare/camox-v0.16.0...camox-sdk-v0.16.1) (2026-05-05)

### Miscellaneous

- upgrade to @xstate/store-react dep ([802fb44](https://github.com/remidej/camox/commit/802fb441882f4dc86308fc115e638af3dc14a807))

## [0.16.0](https://github.com/remidej/camox/compare/camox-v0.15.1...camox-sdk-v0.16.0) (2026-05-05)

### Features

- add repeatable item buttons to dedicated content sheet view ([b2130af](https://github.com/remidej/camox/commit/b2130af1d4911756e6fc98c3a8c0a473405ad19e))
- add repeatable item buttons to FieldToolbar ([c3ee694](https://github.com/remidej/camox/commit/c3ee694816fdbb4d9581764a75e3dd0b26448741))

### Bug Fixes

- accidental dark theme ([251d139](https://github.com/remidej/camox/commit/251d139ba610bf31421efb10bb528ecd4f8befa2))
- display loader when creating repeatable item ([98437e6](https://github.com/remidej/camox/commit/98437e68a2788ecaa4d84c9eb04bacd0a61bbd50))
- fewer tool calls needed to edit content ([60b9c2f](https://github.com/remidej/camox/commit/60b9c2fbaa5fe3987c78c63b2d926c4ed4f6bef3))
- skill formatting issues ([b0d31cf](https://github.com/remidej/camox/commit/b0d31cfa268eaef6bda9915de110c579560efa29))

### Miscellaneous

- add new web app blocks ([44c0b42](https://github.com/remidej/camox/commit/44c0b42d473b02c5ac614f324ef714fd21af72c5))
- fix check script ([dc12bcb](https://github.com/remidej/camox/commit/dc12bcb6113345227032f41419ec57666e1e7862))
- set up vite plus ([bd1d4f1](https://github.com/remidej/camox/commit/bd1d4f1c5a938cf0dde44cb764583bf524aee1af))

## [0.15.1](https://github.com/remidej/camox/compare/camox-v0.15.0...camox-sdk-v0.15.1) (2026-04-30)

### Miscellaneous

- promote the cli in-app ([7deb631](https://github.com/remidej/camox/commit/7deb631f7903fff7f30e42d03c6886df9292b683))

## [0.15.0](https://github.com/remidej/camox/compare/camox-v0.14.2...camox-sdk-v0.15.0) (2026-04-30)

### Features

- add api tools to cli ([2d96fd1](https://github.com/remidej/camox/commit/2d96fd10ad02d1c326c1c7b338bf7b1ac6641149))
- add camox-cli skill to camox apps ([039dcfe](https://github.com/remidej/camox/commit/039dcfe83b4ef4fc675f28886f49bcd3cd0287fe))

### Bug Fixes

- image component not aware of repeater context ([b4743d7](https://github.com/remidej/camox/commit/b4743d7746b41e47a805c3afb1ac0a1073ff5a83))

### Miscellaneous

- misc improvements ([32306e6](https://github.com/remidej/camox/commit/32306e6e724b7974c3d0cd6a03dd993de6b67000))

## [0.14.2](https://github.com/remidej/camox/compare/camox-v0.14.1...camox-sdk-v0.14.2) (2026-04-28)

### Miscellaneous

- **camox-sdk:** Synchronize camox versions

## [0.14.1](https://github.com/remidej/camox/compare/camox-v0.14.0...camox-sdk-v0.14.1) (2026-04-28)

### Bug Fixes

- deleting files used in repeatable items ([d609e16](https://github.com/remidej/camox/commit/d609e16988e346a80fdd85a5f152fcd912ac2b56))
- sdk papercuts ([28dc8d7](https://github.com/remidej/camox/commit/28dc8d75c47839da5f19c369035d8a83c0b64203))

### Miscellaneous

- **api:** refactor structure to domain directories ([68a957b](https://github.com/remidej/camox/commit/68a957bd6a4b02bf6ad81295e4c086b3a701ae6d))

## [0.14.0](https://github.com/remidej/camox/compare/camox-v0.13.0...camox-sdk-v0.14.0) (2026-04-27)

### Features

- conditional toMarkdown based on settings ([544b0e6](https://github.com/remidej/camox/commit/544b0e6b01662ac78da5b28d01ab8f50c90c1c3d))
- repetable item level settings ([5f27cc5](https://github.com/remidej/camox/commit/5f27cc5aef3f2a54a680736528569bd44991da03))

### Bug Fixes

- inline text overlays ([02de1b5](https://github.com/remidej/camox/commit/02de1b5136b8126d297d21b52a1af638e4507ea6))

## [0.13.0](https://github.com/remidej/camox/compare/camox-v0.12.1...camox-sdk-v0.13.0) (2026-04-24)

### Features

- add field toolbar ([b9d8612](https://github.com/remidej/camox/commit/b9d8612dbf998e448bd40b06e464ae3580929a65))
- support line breaks ([c24ed66](https://github.com/remidej/camox/commit/c24ed667fa74921a2d42c1bbd87a08ac3e44b1e3))

### Bug Fixes

- dev server leaking into prod deployments ([92fc8b4](https://github.com/remidej/camox/commit/92fc8b48e2e2b3404932b93d63da105cb4a7fd3c))
- remove backdrop blur for performance ([8897627](https://github.com/remidej/camox/commit/8897627235b9bc9c70048aae93b60965f6f7c3e1))

## [0.12.1](https://github.com/remidej/camox/compare/camox-v0.12.0...camox-sdk-v0.12.1) (2026-04-23)

### Miscellaneous

- set up nx groups ([2e2128a](https://github.com/remidej/camox/commit/2e2128a80133c7c9e599d85ef855223aefb64d4c))

## [0.12.0](https://github.com/remidej/camox/compare/camox-v0.11.0...camox-sdk-v0.12.0) (2026-04-23)

### Features

- **web:** add cool blocks and shaders ([7a020ad](https://github.com/remidej/camox/commit/7a020ad0d071749e086d5df0d97172e82ad227d9))

### Bug Fixes

- stop assuming the build camox environment ([b99b2e8](https://github.com/remidej/camox/commit/b99b2e856d748200c3a13c1f5827d3390aefcb81))

### Miscellaneous

- merge Type.RepeatableItem params ([42c418e](https://github.com/remidej/camox/commit/42c418e0f726ceedd27050f7c873648ca634dc78))
- remove cmd+escape shortcut in favor of cmd+enter ([eb9de35](https://github.com/remidej/camox/commit/eb9de350e5c20c8e9215991c356c4f3b5beb228b))
- **web:** init camox app ([d32518c](https://github.com/remidej/camox/commit/d32518c43ab8dd5e7e361a3514e3079328e8e03d))

## [0.11.0](https://github.com/remidej/camox/compare/camox-v0.10.1...camox-sdk-v0.11.0) (2026-04-20)

### Features

- **camox:** new toMarkdown type safe builder api ([5b0f18e](https://github.com/remidej/camox/commit/5b0f18e55850ae685eab0a1f633560fbab9017b8))

### Bug Fixes

- race condition breaking partykit in prod ([6ea3dfa](https://github.com/remidej/camox/commit/6ea3dfaf7569180239a90640f87960c72e2c4682))
- sidebar lexical editor losing focus ([420264d](https://github.com/remidej/camox/commit/420264de34ea8b530ed0f27bbe5ca05a69464888))

## [0.10.1](https://github.com/remidej/camox/compare/camox-v0.10.0...camox-sdk-v0.10.1) (2026-04-20)

### Bug Fixes

- remaining hydration issues ([4432899](https://github.com/remidej/camox/commit/4432899f846491607cbbadeb4fce0485cdd6796c))
- ssr Link href ([3015859](https://github.com/remidej/camox/commit/3015859946421702fe44d12c0f6a507433415c31))

## [0.10.0](https://github.com/remidej/camox/compare/camox-v0.9.1...camox-sdk-v0.10.0) (2026-04-19)

### Features

- **sdk:** add error boundary for each block ([48f04a8](https://github.com/remidej/camox/commit/48f04a81f5ce02095c1afbdf8c739478eeb2c2db))

### Bug Fixes

- debounced LinkFieldEditor url ([465db76](https://github.com/remidej/camox/commit/465db76647c9983bd33c183694c80a858e8c0c03))
- various bugs ([86e66ba](https://github.com/remidej/camox/commit/86e66badfc79030e49513d5403fe7089b12814fd))
- vite optimizer causing page reloads in dev ([6b62b5c](https://github.com/remidej/camox/commit/6b62b5c476b29b468c402440592c02f43fb22637))

### Miscellaneous

- add BeforeBlocks and AfterBlocks to createLayout instead of individual references ([7c44700](https://github.com/remidej/camox/commit/7c447001397052958240ce33b9efdec57023da43))
- clean up api surface of createBlock and createLayout using \_internal in return value ([71f8d8f](https://github.com/remidej/camox/commit/71f8d8f5a0987d4e00b7c793b1f57a1b97f7d6df))
- convert create page sheet to modal ([40463a3](https://github.com/remidej/camox/commit/40463a3143cd16a4b0e2bed99668a2733dd847e8))
- convert edit page sheet to modal ([487b0a5](https://github.com/remidej/camox/commit/487b0a5a664fcfe821289a877f3c66156067dd05))
- misc fixes ([6fced4b](https://github.com/remidej/camox/commit/6fced4bf0ff5b56cd58bb8ed3098638daf7fd7fb))
- move createLayout initial blocks to blocks object ([c4b6d96](https://github.com/remidej/camox/commit/c4b6d96dfa2566d9841928bfbd747ca4402454a0))
- remove PageTree prop drilling ([1e1e6fd](https://github.com/remidej/camox/commit/1e1e6fdf4a3aab7b15d8c5ebdb2979f632f047f9))
- scope partykit rooms by environment instead of project ([a316561](https://github.com/remidej/camox/commit/a31656130032fe206bc9758022b6ac5a9f501098))
- store ids as numbers in selection state ([7892ff0](https://github.com/remidej/camox/commit/7892ff0dc19c986238fb5d774352d37c093fcf65))

## [0.9.1](https://github.com/remidej/camox/compare/camox-v0.9.0...camox-sdk-v0.9.1) (2026-04-18)

### Bug Fixes

- broken websocket in production ([b19d70b](https://github.com/remidej/camox/commit/b19d70b94790e225bdeb8617bf5972ba211514f0))
- cascading deletes on block deletion ([6df62c2](https://github.com/remidej/camox/commit/6df62c26b583a70d76d2ca28a9a9e045e70e08f6))
- create missing layout blocks on sync ([dc1373a](https://github.com/remidej/camox/commit/dc1373af592956d6835eaabcae217dc7c86b404d))
- layout block creation ([4e8a481](https://github.com/remidej/camox/commit/4e8a481bab937e8d58e457ac64a765e10ad9abc6))
- peeked page not clearing on popover close ([2019751](https://github.com/remidej/camox/commit/20197515b36b31fba7074afb5753777df83ebb38))
- show sign in toast to unauthenticated users in dev ([d64549e](https://github.com/remidej/camox/commit/d64549eaf1261d4b5664d4d23c8b26546d5ae3f2))

### Miscellaneous

- fix auth client type safety ([0084668](https://github.com/remidej/camox/commit/0084668e48137f49ec9024468758437c741209cf))

## [0.9.0](https://github.com/remidej/camox/compare/camox-v0.8.0...camox-sdk-v0.9.0) (2026-04-17)

### Miscellaneous

- **camox-sdk:** Synchronize camox versions

## [0.8.0](https://github.com/remidej/camox/compare/camox-v0.7.3...camox-sdk-v0.8.0) (2026-04-16)

### Features

- add studio-authorize consent page ([48176ee](https://github.com/remidej/camox/commit/48176ee3123f3b5675ec3b1fa7a7acdb0aa60cc6))

### Miscellaneous

- refactor dashboard ui ([7064401](https://github.com/remidej/camox/commit/70644017a8b58552822233a37c14a77dd92fa39d))
- various improvements ([5fbdb6a](https://github.com/remidej/camox/commit/5fbdb6a12d1423b2c5921c5a044603616ce1877d))

## [0.7.3](https://github.com/remidej/camox/compare/camox-v0.7.2...camox-sdk-v0.7.3) (2026-04-16)

### Bug Fixes

- css build error on created apps ([f5fb662](https://github.com/remidej/camox/commit/f5fb6624f007658bb8caea56653cebb396964b9d))

## [0.7.2](https://github.com/remidej/camox/compare/camox-v0.7.1...camox-sdk-v0.7.2) (2026-04-16)

### Miscellaneous

- build css with tailwindcss cli ([6fb99c6](https://github.com/remidej/camox/commit/6fb99c6691505e675275d27609d3a33d9beeed89))
- migrate sdk to tsdown build pipeline ([ef339c6](https://github.com/remidej/camox/commit/ef339c68b9ab5f5dbd456d8a23812da04a8ccd7d))

## [0.7.1](https://github.com/remidej/camox/compare/camox-v0.7.0...camox-sdk-v0.7.1) (2026-04-16)

### Miscellaneous

- add api contract package ([491ef44](https://github.com/remidej/camox/commit/491ef44c119f28a2f3ccecb34b8cdbcf632849e1))

## [0.7.0](https://github.com/remidej/camox/compare/camox-v0.6.1...camox-sdk-v0.7.0) (2026-04-16)

### Features

- add disabeCodeGen \_internal option to vite ([c2a96c3](https://github.com/remidej/camox/commit/c2a96c3dd0b93896b8a66ebfbcf2337cfb2faf91))

### Bug Fixes

- post base ui migration tweaks ([0d72dee](https://github.com/remidej/camox/commit/0d72dee380b304770769d54bb6c0770a3c73e654))
- remaining asChild in blocks ([f7e7d82](https://github.com/remidej/camox/commit/f7e7d82f0cf8302f2249c7cc8d0e8f1774495927))
- some cli template issues ([359f00f](https://github.com/remidej/camox/commit/359f00f4f83f618d35ae09f64adf6df1f7011b35))

### Miscellaneous

- migrate app template to base ui ([4f470a4](https://github.com/remidej/camox/commit/4f470a40f77a100dc65ea8a07f13123202f2782e))
- migrate popover to base ui ([826aae6](https://github.com/remidej/camox/commit/826aae69222c4906b932514d2512160e524197ae))
- migrate ui package to base ui ([24439ee](https://github.com/remidej/camox/commit/24439eecc426b72f8136d4217792847c3a0ace34))
- use css for overlay styles instead of inline style tags ([827dbf4](https://github.com/remidej/camox/commit/827dbf4cece76fc3f403f2f366678541abe5dbf4))
- use render prop based api for editable components instead of radix slot ([33ae569](https://github.com/remidej/camox/commit/33ae5698307333dbec9b9e4c1ab78b339be3f889))

## [0.6.1](https://github.com/remidej/camox/compare/camox-v0.6.0...camox-sdk-v0.6.1) (2026-04-14)

### Bug Fixes

- definitions sync nitro support ([84021d9](https://github.com/remidej/camox/commit/84021d9d3ef4edb69b462a8096041f1505e5124a))

## [0.6.0](https://github.com/remidej/camox/compare/camox-v0.5.2...camox-sdk-v0.6.0) (2026-04-14)

### Features

- manage multiple auth providers in auth.json file ([3528ea5](https://github.com/remidej/camox/commit/3528ea5f75b08edf61bfa16d5d19cffc8505e51e))

### Bug Fixes

- force useSyncExternalStore via react and not shim package ([cd1b72c](https://github.com/remidej/camox/commit/cd1b72cbee73da41602b579e7b328b4d92a07ba0))

## [0.5.2](https://github.com/remidej/camox/compare/camox-v0.5.1...camox-sdk-v0.5.2) (2026-04-14)

### Miscellaneous

- **camox-sdk:** Synchronize camox versions

## [0.5.1](https://github.com/remidej/camox/compare/camox-v0.5.0...camox-sdk-v0.5.1) (2026-04-14)

### Miscellaneous

- **camox-sdk:** Synchronize camox versions

## [0.5.0](https://github.com/remidej/camox/compare/camox-v0.4.2...camox-sdk-v0.5.0) (2026-04-14)

### Miscellaneous

- **camox-sdk:** Synchronize camox versions

## [0.4.2](https://github.com/remidej/camox/compare/camox-v0.4.1...camox-sdk-v0.4.2) (2026-04-13)

### Miscellaneous

- **camox-sdk:** Synchronize camox versions

## [0.4.1](https://github.com/remidej/camox/compare/camox-v0.4.0...camox-sdk-v0.4.1) (2026-04-13)

### Bug Fixes

- cli template ([6e7147d](https://github.com/remidej/camox/commit/6e7147dc2a175c79dd4e225f7d09f1e826436fc7))

## [0.4.0](https://github.com/remidej/camox/compare/camox-v0.3.1...camox-sdk-v0.4.0) (2026-04-13)

### Features

- **sdk:** add powered by camox link ([7fb2e8a](https://github.com/remidej/camox/commit/7fb2e8a2b28fb43de041d4dfce1d4b5ea9df574f))

### Miscellaneous

- remove definitionsSync from camox vite options ([7c3411f](https://github.com/remidej/camox/commit/7c3411fce9519807d4c7a3a1149580306bea621a))

## [0.3.1](https://github.com/remidej/camox/compare/camox-v0.3.0...camox-sdk-v0.3.1) (2026-04-13)

### Miscellaneous

- drop extraneous typescript dependency ([4189347](https://github.com/remidej/camox/commit/41893478954f0cc4baaf9de61d41e997394f1eb3))
- set up rolldown react compiler ([ec250f6](https://github.com/remidej/camox/commit/ec250f6dbf2f8b2e33f34ded8c2183adb3090eef))
- upgrade all deps ([7155d86](https://github.com/remidej/camox/commit/7155d863e1fd617db6a4312b33daad4d047b5fc8))
- use react stable version ([2414936](https://github.com/remidej/camox/commit/24149362afa636eadb9c3eda0d15815cd0b2cb90))

## [0.3.0](https://github.com/remidej/camox/compare/camox-sdk-v0.2.0...camox-sdk-v0.3.0) (2026-04-12)

### Features

- add dedicated environment menu to navbar ([9d0fffa](https://github.com/remidej/camox/commit/9d0fffa3577819e95430fe1d8238121fd5994d87))
- add environments concept to scope db per-user in dev ([40f1b11](https://github.com/remidej/camox/commit/40f1b113f473ca1af9468bfce5a711e7c906a8de))
- add itialBlocks to createLayout for declarative initial content generation ([27ded94](https://github.com/remidej/camox/commit/27ded94210d958d02a9bb5a7cb822b381ff04a1b))
- add page metadata button to sidebar ([622ed83](https://github.com/remidej/camox/commit/622ed83197d171a44812eb464b541736a6a876a7))
- add sitemap util ([7fbf740](https://github.com/remidej/camox/commit/7fbf740b2a19d6762c03044dcd59217049a6b811))
- auto generate project initial content in vite plugin ([18d0599](https://github.com/remidej/camox/commit/18d059981e1e629d64dc1fc6891d284eefcbe8da))
- introduce sync secret to authenticate definition routes ([70251f2](https://github.com/remidej/camox/commit/70251f262c8f19961f1b7c50470f3977ab1eacb7))
- make create-camox auto run app ([ede571b](https://github.com/remidej/camox/commit/ede571b8b8eda3fc931409d6ae6997ae1702d1fd))
- **sdk:** add partykit query invalidation ([7828774](https://github.com/remidej/camox/commit/7828774666f4e07cfa19071eb69b4bc2dcb0450c))
- set up cli package and sdk reexport ([b5c0493](https://github.com/remidej/camox/commit/b5c0493464ab0e9ec8b02d159573f43111033c43))
- show sync secret in project dashboard ([3675495](https://github.com/remidej/camox/commit/36754951775553a0ad2b4f1edf89facd8e99c1af))
- store default content in block definitions ([b1d8657](https://github.com/remidej/camox/commit/b1d865716a4569c2334b9f1731fc306b83c8292f))

### Bug Fixes

- **api:** ai image metadata generation ([08da599](https://github.com/remidej/camox/commit/08da599803fc73f1a54d2407117bb8f14c75d4a0))
- authenticate seed route ([92ce5a1](https://github.com/remidej/camox/commit/92ce5a183f431ce86796f685543c7db8e64cd3e7))
- block reordering and upload ([7ba5534](https://github.com/remidej/camox/commit/7ba5534d5ffdf536b9616ca0007ae9d29f1af9d5))
- blocks reordering ([61a9f71](https://github.com/remidej/camox/commit/61a9f71a857e0c3f87b04d8e7f02fac89c5003fa))
- breadcrumbs performance ([e4fbdde](https://github.com/remidej/camox/commit/e4fbdde2d1db37e09cf6fd877ed35113cd73749e))
- bulk delete files ([4001898](https://github.com/remidej/camox/commit/4001898911e14e6352a4e748c7d841cba7909a8c))
- convex \_id to d1 id ([c4654c7](https://github.com/remidej/camox/commit/c4654c700aa72c3d39db4397c6d4244fa898ee32))
- definitions sync failing ([b2b2638](https://github.com/remidej/camox/commit/b2b2638d8d53087c4f1f3c6fce3ceebacdc40bc3))
- multiple file fields corrupt data ([24ef219](https://github.com/remidej/camox/commit/24ef2196d4b6029dc9a758d5247ebab7e60d2332))
- nested repeatable items not resolving ([4110d71](https://github.com/remidej/camox/commit/4110d71332d446d58f9204104ceac82fbaf878cf))
- playground css breaking build ([fbf28a5](https://github.com/remidej/camox/commit/fbf28a5063e693658773145857666f9536519cc1))
- repeatable item creation and ghost items ([8a08118](https://github.com/remidej/camox/commit/8a08118c8173cff102c11cfa3033c3f8dd80c13d))
- **sdk:** editing repeatable item fields in sidebar ([9bb5ae9](https://github.com/remidej/camox/commit/9bb5ae99bcea33b654aec83042c7cd99c3e61990))
- **sdk:** repeatable items not detected ([155964d](https://github.com/remidej/camox/commit/155964d1670876eaf887a3f887da1aa4313babd2))
- **sdk:** retrieve project by slug ([fe37eea](https://github.com/remidej/camox/commit/fe37eea83f7ae2f4d3788a1830a7d43643b82cf4))
- server side rendering ([5d33f2c](https://github.com/remidej/camox/commit/5d33f2c61fb2012c32ad105523ce2713f801ec51))
- sync definitions during build ([2b93bad](https://github.com/remidej/camox/commit/2b93bada3758c4e62e001249d638efa191fa9bae))
- use project specific sync secret ([3e5748a](https://github.com/remidej/camox/commit/3e5748a3662945470b9d919fc03099d181683dfd))
- various issues ([7d3d89f](https://github.com/remidej/camox/commit/7d3d89f45a1b9d46500cdbac544f7d65d71e7560))
- various ui tweaks ([4fe6adb](https://github.com/remidej/camox/commit/4fe6adb64668846d4898e5f023ee647720ac22d3))
- **web:** cross domain auth ([79ef5be](https://github.com/remidej/camox/commit/79ef5be2a09ce30a157656403fc14cff703f5a4c))
- **web:** race condition when switching org ([f789a14](https://github.com/remidej/camox/commit/f789a14da71575984113856235ad9f62d3683368))

### Refactoring

- fetch ssr data through tanstack query ([1b58709](https://github.com/remidej/camox/commit/1b5870998da00812415d5fa99111eb058abc1d70))
- move query key definition and invalidation to backend ([a4d6dbc](https://github.com/remidej/camox/commit/a4d6dbc295543862759a153a7e1e96affaba7e3c))
- normalize images in page response ([3bf3e01](https://github.com/remidej/camox/commit/3bf3e017a7329ad7c8a6d92f49231dc30bf3ba03))
- **sdk:** centralize all API mutations into tanstack query mutation factories ([ec30ff8](https://github.com/remidej/camox/commit/ec30ff8d1b9ffba6174c8c55512de9cd61d5da59))
- **sdk:** extract camox dev options to \_config vite options ([22a6c78](https://github.com/remidej/camox/commit/22a6c78c3c5e6e8e5e3e223ced04488f7b10ca05))
- **sdk:** make components subscribe to granular cache items ([fa9b771](https://github.com/remidej/camox/commit/fa9b771da39876082ace1af98edd550be177bb29))
- **sdk:** rework breadcrumbs system (wip) ([1bb2be4](https://github.com/remidej/camox/commit/1bb2be4d85ed237bdc6c8652db4df29d38b9cc63))
- store markdown and move lexical conversion to editor level ([741e57f](https://github.com/remidej/camox/commit/741e57f614f19b3407e2b1ec643d280de64cda47))

### Documentation

- add cli architecture plan ([1c6012f](https://github.com/remidej/camox/commit/1c6012fcdc09e1b69cd3dec7dfe6e9c1e9c0196f))

### Miscellaneous

- add queryClient to router context on createRouter ([6bfb7f8](https://github.com/remidej/camox/commit/6bfb7f85ba23ebe8dc0224b73becf7b2a6fd9111))
- clean up remainingrepeatable object references ([302ad60](https://github.com/remidej/camox/commit/302ad60c96e8fed24f8bfa43aa50828ff89e4dd9))
- declutter oxlint configs ([9a89597](https://github.com/remidej/camox/commit/9a89597310a97606894f59c76e4881ee1d281f69))
- delete project domain and description ([8a1ee2d](https://github.com/remidej/camox/commit/8a1ee2d9597fced845ee47c1c917401ae70a0388))
- delete remaining convex code in sdk ([c390d8c](https://github.com/remidej/camox/commit/c390d8cdeaa44285874403724e96997d291a2cc9))
- ignore generated files in linter and formatter ([a87ff5f](https://github.com/remidej/camox/commit/a87ff5f0a6f7ba1eba39a70956a81152c11617bf))
- implement better-auth cross domain plugin internally ([080603d](https://github.com/remidej/camox/commit/080603df0970e359b80d631c917adce0e8c4c0f7))
- migrate definitions sync to orpc ([dfa6b90](https://github.com/remidej/camox/commit/dfa6b90013ad1e0efcfb460d1fd8c50af48c4024))
- migrate from hono rpc to orpc ([08d8c77](https://github.com/remidej/camox/commit/08d8c772446a33029026dd4e2fa7e1ec539a47eb))
- migrate sdk auth actions to hono api ([0754ad4](https://github.com/remidej/camox/commit/0754ad43546920272e0d33e7b0ccb6cffdba0161))
- mitigate layout shift on block reorder ([a907b33](https://github.com/remidej/camox/commit/a907b33f8503def20590de9d835a2ead119527f0))
- move hono api client out of react context ([b583157](https://github.com/remidej/camox/commit/b58315785035df2e9263d28ce3b975c8bbb29fc5))
- normalize page response ([9bc2516](https://github.com/remidej/camox/commit/9bc25164f9dab8f8536a36202451fb771e5e7765))
- normalize peeked block repeatable items ([71a2dbd](https://github.com/remidej/camox/commit/71a2dbd208c1f4ee372bcdb0ab5472fad9dc9f3d))
- release main ([10f2404](https://github.com/remidej/camox/commit/10f24049b5d4797fdb825efb831b9591f5c85973))
- release main ([c70b4a8](https://github.com/remidej/camox/commit/c70b4a850a5ad69e3effec04116277398cf9def2))
- release main ([7161c8e](https://github.com/remidej/camox/commit/7161c8ef08f144d6f7997bc8cd605b6cc26f669d))
- release main ([62dcf04](https://github.com/remidej/camox/commit/62dcf04f72a911c383f14f1f445726a2ebd756f9))
- release main ([#3](https://github.com/remidej/camox/issues/3)) ([daa00dd](https://github.com/remidej/camox/commit/daa00dd18a5c2784b58f6374f93a8cc8caddcb52))
- release main ([#3](https://github.com/remidej/camox/issues/3)) ([f589aaa](https://github.com/remidej/camox/commit/f589aaadc6f98c2921a5c51445d31229c5be4bc4))
- release main ([#4](https://github.com/remidej/camox/issues/4)) ([23e5f3e](https://github.com/remidej/camox/commit/23e5f3e3d8894e14d57904992c57a8bb1456c5de))
- release main ([#5](https://github.com/remidej/camox/issues/5)) ([532d93d](https://github.com/remidej/camox/commit/532d93d763523f77e8f70e47721a6c133e437f39))
- release main ([#6](https://github.com/remidej/camox/issues/6)) ([e2d023c](https://github.com/remidej/camox/commit/e2d023c660d56710b6a65f7bc664652755e6fbd8))
- remove dynamic contenteditable tag on lexical inputs ([41fdf5f](https://github.com/remidej/camox/commit/41fdf5fe6fd9033b2eebedf1f4eb803f5b9bccb1))
- rename repeatable object to repeatable item ([6f8c054](https://github.com/remidej/camox/commit/6f8c0545cc22dda7469c654a9d50d65450093e59))
- **sdk:** migrate mutations to new api ([76b6aae](https://github.com/remidej/camox/commit/76b6aaeb1d3a0e105219cfa39ce31797ac4c011d))
- **sdk:** migrate read operations to hono api ([b588e8e](https://github.com/remidej/camox/commit/b588e8e9769e172ff743ea982a850c8adfc9c6cf))
- seed individual tanstack cache queries ([d89ab96](https://github.com/remidej/camox/commit/d89ab96f47273efa1f62584447719948093b66ea))
- set up release-please ([b77b064](https://github.com/remidej/camox/commit/b77b064ab6f80e87fa22e70fbb9cac01505ff336))
- specify css source only once ([7fa0d78](https://github.com/remidej/camox/commit/7fa0d78555bc7ab58a965f63f2c45c8e6a49ff57))

## [0.2.0-alpha.5](https://github.com/remidej/camox/compare/camox-v0.2.0-alpha.4...camox-sdk-v0.2.0-alpha.5) (2026-04-10)

### Miscellaneous

- **camox-sdk:** Synchronize camox versions

## [0.2.0-alpha.4](https://github.com/remidej/camox/compare/camox-v0.2.0-alpha.3...camox-sdk-v0.2.0-alpha.4) (2026-04-10)

### Miscellaneous

- **camox-sdk:** Synchronize camox versions

## [0.2.0-alpha.3](https://github.com/remidej/camox/compare/camox-v0.2.0-alpha.2...camox-sdk-v0.2.0-alpha.3) (2026-04-10)

### Miscellaneous

- **camox-sdk:** Synchronize camox versions

## [0.2.0-alpha.2](https://github.com/remidej/camox/compare/camox-v0.1.2-alpha.2...camox-sdk-v0.2.0-alpha.2) (2026-04-10)

### Features

- add dedicated environment menu to navbar ([9d0fffa](https://github.com/remidej/camox/commit/9d0fffa3577819e95430fe1d8238121fd5994d87))
- add environments concept to scope db per-user in dev ([40f1b11](https://github.com/remidej/camox/commit/40f1b113f473ca1af9468bfce5a711e7c906a8de))
- add itialBlocks to createLayout for declarative initial content generation ([27ded94](https://github.com/remidej/camox/commit/27ded94210d958d02a9bb5a7cb822b381ff04a1b))
- add page metadata button to sidebar ([622ed83](https://github.com/remidej/camox/commit/622ed83197d171a44812eb464b541736a6a876a7))
- auto generate project initial content in vite plugin ([18d0599](https://github.com/remidej/camox/commit/18d059981e1e629d64dc1fc6891d284eefcbe8da))
- introduce sync secret to authenticate definition routes ([70251f2](https://github.com/remidej/camox/commit/70251f262c8f19961f1b7c50470f3977ab1eacb7))
- **sdk:** add partykit query invalidation ([7828774](https://github.com/remidej/camox/commit/7828774666f4e07cfa19071eb69b4bc2dcb0450c))
- set up cli package and sdk reexport ([b5c0493](https://github.com/remidej/camox/commit/b5c0493464ab0e9ec8b02d159573f43111033c43))
- show sync secret in project dashboard ([3675495](https://github.com/remidej/camox/commit/36754951775553a0ad2b4f1edf89facd8e99c1af))
- store default content in block definitions ([b1d8657](https://github.com/remidej/camox/commit/b1d865716a4569c2334b9f1731fc306b83c8292f))

### Bug Fixes

- **api:** ai image metadata generation ([08da599](https://github.com/remidej/camox/commit/08da599803fc73f1a54d2407117bb8f14c75d4a0))
- authenticate seed route ([92ce5a1](https://github.com/remidej/camox/commit/92ce5a183f431ce86796f685543c7db8e64cd3e7))
- block reordering and upload ([7ba5534](https://github.com/remidej/camox/commit/7ba5534d5ffdf536b9616ca0007ae9d29f1af9d5))
- blocks reordering ([61a9f71](https://github.com/remidej/camox/commit/61a9f71a857e0c3f87b04d8e7f02fac89c5003fa))
- breadcrumbs performance ([e4fbdde](https://github.com/remidej/camox/commit/e4fbdde2d1db37e09cf6fd877ed35113cd73749e))
- bulk delete files ([4001898](https://github.com/remidej/camox/commit/4001898911e14e6352a4e748c7d841cba7909a8c))
- convex \_id to d1 id ([c4654c7](https://github.com/remidej/camox/commit/c4654c700aa72c3d39db4397c6d4244fa898ee32))
- definitions sync failing ([b2b2638](https://github.com/remidej/camox/commit/b2b2638d8d53087c4f1f3c6fce3ceebacdc40bc3))
- multiple file fields corrupt data ([24ef219](https://github.com/remidej/camox/commit/24ef2196d4b6029dc9a758d5247ebab7e60d2332))
- nested repeatable items not resolving ([4110d71](https://github.com/remidej/camox/commit/4110d71332d446d58f9204104ceac82fbaf878cf))
- repeatable item creation and ghost items ([8a08118](https://github.com/remidej/camox/commit/8a08118c8173cff102c11cfa3033c3f8dd80c13d))
- **sdk:** editing repeatable item fields in sidebar ([9bb5ae9](https://github.com/remidej/camox/commit/9bb5ae99bcea33b654aec83042c7cd99c3e61990))
- **sdk:** repeatable items not detected ([155964d](https://github.com/remidej/camox/commit/155964d1670876eaf887a3f887da1aa4313babd2))
- **sdk:** retrieve project by slug ([fe37eea](https://github.com/remidej/camox/commit/fe37eea83f7ae2f4d3788a1830a7d43643b82cf4))
- server side rendering ([5d33f2c](https://github.com/remidej/camox/commit/5d33f2c61fb2012c32ad105523ce2713f801ec51))
- sync definitions during build ([2b93bad](https://github.com/remidej/camox/commit/2b93bada3758c4e62e001249d638efa191fa9bae))
- various issues ([7d3d89f](https://github.com/remidej/camox/commit/7d3d89f45a1b9d46500cdbac544f7d65d71e7560))
- various ui tweaks ([4fe6adb](https://github.com/remidej/camox/commit/4fe6adb64668846d4898e5f023ee647720ac22d3))
- **web:** race condition when switching org ([f789a14](https://github.com/remidej/camox/commit/f789a14da71575984113856235ad9f62d3683368))

### Refactoring

- fetch ssr data through tanstack query ([1b58709](https://github.com/remidej/camox/commit/1b5870998da00812415d5fa99111eb058abc1d70))
- move query key definition and invalidation to backend ([a4d6dbc](https://github.com/remidej/camox/commit/a4d6dbc295543862759a153a7e1e96affaba7e3c))
- normalize images in page response ([3bf3e01](https://github.com/remidej/camox/commit/3bf3e017a7329ad7c8a6d92f49231dc30bf3ba03))
- **sdk:** centralize all API mutations into tanstack query mutation factories ([ec30ff8](https://github.com/remidej/camox/commit/ec30ff8d1b9ffba6174c8c55512de9cd61d5da59))
- **sdk:** extract camox dev options to \_config vite options ([22a6c78](https://github.com/remidej/camox/commit/22a6c78c3c5e6e8e5e3e223ced04488f7b10ca05))
- **sdk:** make components subscribe to granular cache items ([fa9b771](https://github.com/remidej/camox/commit/fa9b771da39876082ace1af98edd550be177bb29))
- **sdk:** rework breadcrumbs system (wip) ([1bb2be4](https://github.com/remidej/camox/commit/1bb2be4d85ed237bdc6c8652db4df29d38b9cc63))
- store markdown and move lexical conversion to editor level ([741e57f](https://github.com/remidej/camox/commit/741e57f614f19b3407e2b1ec643d280de64cda47))

### Documentation

- add cli architecture plan ([1c6012f](https://github.com/remidej/camox/commit/1c6012fcdc09e1b69cd3dec7dfe6e9c1e9c0196f))

### Miscellaneous

- add queryClient to router context on createRouter ([6bfb7f8](https://github.com/remidej/camox/commit/6bfb7f85ba23ebe8dc0224b73becf7b2a6fd9111))
- clean up remainingrepeatable object references ([302ad60](https://github.com/remidej/camox/commit/302ad60c96e8fed24f8bfa43aa50828ff89e4dd9))
- declutter oxlint configs ([9a89597](https://github.com/remidej/camox/commit/9a89597310a97606894f59c76e4881ee1d281f69))
- delete project domain and description ([8a1ee2d](https://github.com/remidej/camox/commit/8a1ee2d9597fced845ee47c1c917401ae70a0388))
- delete remaining convex code in sdk ([c390d8c](https://github.com/remidej/camox/commit/c390d8cdeaa44285874403724e96997d291a2cc9))
- implement better-auth cross domain plugin internally ([080603d](https://github.com/remidej/camox/commit/080603df0970e359b80d631c917adce0e8c4c0f7))
- migrate definitions sync to orpc ([dfa6b90](https://github.com/remidej/camox/commit/dfa6b90013ad1e0efcfb460d1fd8c50af48c4024))
- migrate from hono rpc to orpc ([08d8c77](https://github.com/remidej/camox/commit/08d8c772446a33029026dd4e2fa7e1ec539a47eb))
- migrate sdk auth actions to hono api ([0754ad4](https://github.com/remidej/camox/commit/0754ad43546920272e0d33e7b0ccb6cffdba0161))
- mitigate layout shift on block reorder ([a907b33](https://github.com/remidej/camox/commit/a907b33f8503def20590de9d835a2ead119527f0))
- move hono api client out of react context ([b583157](https://github.com/remidej/camox/commit/b58315785035df2e9263d28ce3b975c8bbb29fc5))
- normalize page response ([9bc2516](https://github.com/remidej/camox/commit/9bc25164f9dab8f8536a36202451fb771e5e7765))
- normalize peeked block repeatable items ([71a2dbd](https://github.com/remidej/camox/commit/71a2dbd208c1f4ee372bcdb0ab5472fad9dc9f3d))
- remove dynamic contenteditable tag on lexical inputs ([41fdf5f](https://github.com/remidej/camox/commit/41fdf5fe6fd9033b2eebedf1f4eb803f5b9bccb1))
- rename repeatable object to repeatable item ([6f8c054](https://github.com/remidej/camox/commit/6f8c0545cc22dda7469c654a9d50d65450093e59))
- **sdk:** migrate mutations to new api ([76b6aae](https://github.com/remidej/camox/commit/76b6aaeb1d3a0e105219cfa39ce31797ac4c011d))
- **sdk:** migrate read operations to hono api ([b588e8e](https://github.com/remidej/camox/commit/b588e8e9769e172ff743ea982a850c8adfc9c6cf))
- seed individual tanstack cache queries ([d89ab96](https://github.com/remidej/camox/commit/d89ab96f47273efa1f62584447719948093b66ea))
- specify css source only once ([7fa0d78](https://github.com/remidej/camox/commit/7fa0d78555bc7ab58a965f63f2c45c8e6a49ff57))

## [0.1.2-alpha.2](https://github.com/remidej/camox/compare/camox-v0.1.2-alpha.1...camox-sdk-v0.1.2-alpha.2) (2026-03-25)

### Bug Fixes

- playground css breaking build ([fbf28a5](https://github.com/remidej/camox/commit/fbf28a5063e693658773145857666f9536519cc1))

### Miscellaneous

- ignore generated files in linter and formatter ([a87ff5f](https://github.com/remidej/camox/commit/a87ff5f0a6f7ba1eba39a70956a81152c11617bf))

## [0.1.2-alpha.1](https://github.com/remidej/camox/compare/camox-v0.1.2-alpha.0...camox-sdk-v0.1.2-alpha.1) (2026-03-25)

### Miscellaneous

- **camox-sdk:** Synchronize camox versions

## [0.1.2-alpha.0](https://github.com/remidej/camox/compare/camox-v0.1.1-alpha.0...camox-sdk-v0.1.2-alpha.0) (2026-03-25)

### Features

- make create-camox auto run app ([ede571b](https://github.com/remidej/camox/commit/ede571b8b8eda3fc931409d6ae6997ae1702d1fd))

## [0.1.1-alpha.0](https://github.com/remidej/camox/compare/camox-v0.1.0-alpha.0...camox-v0.1.1-alpha.0) (2026-03-25)

### Miscellaneous

- set up release-please ([b77b064](https://github.com/remidej/camox/commit/b77b064ab6f80e87fa22e70fbb9cac01505ff336))
