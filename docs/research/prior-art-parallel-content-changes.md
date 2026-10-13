# Prior art: parallel content changes

Research for issue #193 (Prior art for parallel content changes), part of the Drafts v1 map (issue #192). Decision record: [ADR 0003](../adr/0003-drafts-replace-environments-and-per-item-publishing.md). Researched October 2026.

**Question.** How do other CMSs handle several sets of content changes in parallel? For Sanity, Contentful, Storyblok and Prismic: what Live means, how a set of changes is stored and previewed, how publishing works and whether it is atomic, how conflicts between parallel sets are detected and shown, and how rollback works.

**Sources.** Official docs, API references, changelogs and pricing pages of each vendor, plus Sanity Studio's open-source code where the docs are silent. `www.contentful.com` blocked automated fetches, so Contentful Help Center pages were read from Wayback Machine snapshots (April to July 2026) and developer docs from Contentful's own docs origin (`contentful.docs.buildwithfern.com`); links below use the canonical URLs. One Prismic source is an archived copy of Prismic's own guide (June 2025), marked **[archived]**. Claims I could not confirm from a primary source are listed per vendor under "Not confirmed".

## Naming clash: "Release"

Sanity, Contentful, Storyblok and Prismic all call a set of content changes a **release**. In Camox's glossary that concept is a **Draft**, and **Release** means building the website and syncing its definitions to Live (shipping code). Draft is settled; this is only a flag for readers. When this document says "release", it means the vendor's concept, the Camox equivalent of a Draft.

## Summary

|                           | Sanity                                                                 | Contentful                                                                                           | Storyblok                                                                                  | Prismic                                                    |
| ------------------------- | ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ---------------------------------------------------------- |
| Name for a set of changes | Content Release                                                        | Launch release (`Release.v1`), Timeline release (`Release.v2`), environment                          | Release                                                                                    | Release                                                    |
| How it's stored           | Full copy of each document per release (`versions.<release>.<id>`)     | Launch: links to entries (publishes their current draft). Timeline: a copy of each entry per release | Copy per story per release, with base / current / main version IDs                         | Copy ("version") of each page per release                  |
| Unchanged content         | Falls through to published (perspective stack)                         | Falls through to published, or to earlier scheduled releases (Timeline)                              | Falls through to published (`from_release`)                                                | Falls through to Live (release ref follows every publish)  |
| Preview                   | Perspectives, incl. stacks of releases                                 | Timeline preview stacks earlier scheduled releases; no documented Launch preview                     | `from_release` param, Visual Editor URL                                                    | Release ref, preview session                               |
| Publish atomic?           | Whole release is the unit, but large releases publish in 10 MB batches | All-or-nothing on validation; async; failure mid-way undocumented                                    | "Publishes as a unit"; transaction undocumented                                            | "All at once"; transaction undocumented, hints of async    |
| Conflict detection        | None documented; banner "part of N releases"; compare view             | None documented; Timeline explicitly doesn't carry Live changes into releases                        | Yes: `check_conflicts` (changed since added), field-level compare, accept/reject (Premium) | None documented; versions in different releases don't sync |
| Rollback                  | Revert a published release (Enterprise), warns if docs changed since   | Per-entry version history; alias switch for environments; no release revert                          | Per-story restore; no release revert                                                       | Per-page restore as a draft; no release revert             |

## Takeaways for Camox Drafts v1

1. **"Store a copy of what changed, show Live for the rest" is the norm.** Sanity, Storyblok, Prismic and Contentful Timeline all keep a per-release copy of each changed item and resolve everything else from published content. This matches ADR 0003's "a draft stores only what it changes, on top of Live".
2. **Copies are whole items, not field patches.** Nobody documents field-level merging at publish time. Publishing replaces the published item with the release's copy, so the practical behaviour is "last publish wins" per item. Camox v1's "overwrite after confirmation" is the same model with an explicit warning, which most of these products don't give.
3. **Recording the base version is what makes conflicts detectable.** Storyblok is the only one with documented conflict detection, and it works because each story in a release records `base_version_id` (its content when added) next to the main and release versions. Camox's Conflict definition ("Live changed after the draft first changed it") needs exactly that: store the Live version a draft's copy was based on. Sanity has an `ifBaseRevisionId` guard only at copy creation; Contentful Timeline states plainly that Live changes are _not_ carried into releases.
4. **Overlap is allowed everywhere.** The same item can be in several releases at once (Sanity, Prismic explicitly; Storyblok via `release_ids`). Nobody blocks it; at most they show it (Sanity: "This document is part of the X release and N more releases"). Camox showing "also changed in draft Y" would already exceed most of them.
5. **Atomic publish is promised loosely and delivered partially.** Sanity documents batching for large releases ("small delays when individual documents go live"); Contentful only guarantees that one invalid entry blocks the whole release; Storyblok and Prismic say "as a unit" / "all at once" without a transaction guarantee. Camox's all-or-nothing Publish in one database transaction would be a genuine differentiator, and should be stated as a guarantee.
6. **Validate before publishing.** Contentful refuses the whole release if any entry is invalid. The Camox analogue is the Development Draft rule (Live must have the same definitions) plus content validation, all checked before anything is written.
7. **Whole-release rollback is rare and premium.** Only Sanity reverts a published release, as an Enterprise add-on built on document history, and it warns when documents changed after publishing. Everyone else rolls back item by item from history. Camox can lean on Checkpoints and Revisions for v1 and leave "revert a published draft" for later.
8. **Releases are an upsell.** Sanity (Enterprise add-on), Storyblok (Premium+), Contentful (paid Launch app, Timeline on specific plans). Parallel named drafts as the default way to edit is unusual; it is a positioning point for Camox.
9. **Deleting a release discards its copies, not Live.** Prismic: "The original version will remain untouched." Matches Camox's Discard.
10. **Environments are not the answer for content.** Contentful's environments are full copies used for content-model work; entry merging (`contentful-merge`) only considers published content and has no three-way conflict handling. This supports ADR 0003's rejection of environments-as-branches.

## Sanity: Content Releases and Perspectives

Sanity calls a set of changes a **Content Release**. Each document a release touches gets its own copy, called a **version**. A **Scheduled Draft** is a release holding one document ([Drafts and versions](https://www.sanity.io/docs/content-lake/drafts-and-versions)).

### What Live means, and where drafts and versions live

- **Published:** the document ID has no prefix; it "is live on the public APIs and visible to unauthenticated requests" ([Drafts and versions](https://www.sanity.io/docs/content-lake/drafts-and-versions)).
- **Draft:** ID `drafts.<id>`. "A document has at most one draft at a time" (same page).
- **Version:** ID `versions.<releaseName>.<id>`. "A document can have a version in every release it belongs to"; a release holds one version of a given document ([same](https://www.sanity.io/docs/content-lake/drafts-and-versions); [user guide](https://www.sanity.io/docs/user-guides/content-releases)).
- **The release** is a `system.release` document with a `state`, `metadata` (`title`, `releaseType`, `intendedPublishAt`) and `publishAt` ([Content Releases API](https://www.sanity.io/docs/apis-and-sdks/content-releases-api)).
- "Neither drafts nor versions are served to unauthenticated requests" ([Drafts and versions](https://www.sanity.io/docs/content-lake/drafts-and-versions)).
- A version can strongly reference another document that has a version in the same release; a published document can't strongly reference unpublished content (same page).

### Storage and preview

- **Full document copies.** A version starts as a copy of the published document ("Sanity copies the current published content into the version for you"). `ifBaseRevisionId` makes creation fail if the base changed since you read it ([JS client releases](https://www.sanity.io/docs/apis-and-sdks/js-client-releases); [Actions API](https://www.sanity.io/docs/http-reference/actions)). Studio's **Copy version to** bases a version on a draft or another release ([user guide](https://www.sanity.io/docs/user-guides/content-releases)).
- **Perspectives** ([Perspectives](https://www.sanity.io/docs/content-lake/perspectives)): `published` (default since API 2025-02-19), `drafts` (content as if every draft were published), `raw` (everything side by side).
- **Release stacks:** `perspective: ['release-a','release-b']`; "Layers are prioritized from left to right" and `published` is appended automatically ([Perspectives](https://www.sanity.io/docs/content-lake/perspectives); [Query API](https://www.sanity.io/docs/http-reference/query)).
- Studio layers Published, Draft, ASAP releases, "At time" releases, then Undecided ([user guide](https://www.sanity.io/docs/user-guides/content-releases)). "Preview overlapping releases" is Enterprise-only ([Pricing](https://www.sanity.io/pricing)).

### Publishing and atomicity

- Release types: `asap`, `scheduled`, `undecided` ([Actions API](https://www.sanity.io/docs/http-reference/actions)). The intended time is "only for planning, previews and hints about whether documents conflict" ([Studio source](https://raw.githubusercontent.com/sanity-io/sanity/main/packages/sanity/src/core/i18n/bundles/studio.ts)).
- States: `active`, `scheduled`, `published`, `archived`, with transient states between. "If publishing or archiving fails, the release returns to `active`." Scheduled versions are locked ([Content Releases API](https://www.sanity.io/docs/apis-and-sdks/content-releases-api)).
- `sanity.action.release.publish` "Publishes all documents in a release"; source and target documents are locked meanwhile. Single versions can't be published on their own ([Actions API](https://www.sanity.io/docs/http-reference/actions); [Dispatch actions](https://www.sanity.io/docs/content-lake/dispatch-actions)).
- Actions in one request run "in a single transaction" ([Actions API](https://www.sanity.io/docs/http-reference/actions)), **but** "Releases publish documents in batches based on size and reference connections. For larger releases, there may be small delays when individual documents go live" ([user guide](https://www.sanity.io/docs/user-guides/content-releases)); "Releases batch in sets of 10 MB" ([Technical limits](https://www.sanity.io/docs/content-lake/technical-limits)).
- Publishing a release does not reset existing drafts unless **Update existing drafts** is on: "Unpublished draft changes will be lost" ([user guide](https://www.sanity.io/docs/user-guides/content-releases)).

### Conflicts

- Overlap is allowed; each version is an independent snapshot ([user guide](https://www.sanity.io/docs/user-guides/content-releases)).
- "Releases are published one at a time and are ordered by the time they will be published"; ties are random; a blocked release "waits up to 10 minutes before the release is marked as failed" (same page).
- Studio shows "This document is part of the <release> release and {{count}} more releases" and "+N versions" chips (Studio source strings: [structure](https://raw.githubusercontent.com/sanity-io/sanity/main/packages/sanity/src/structure/i18n/resources.ts), [studio](https://raw.githubusercontent.com/sanity-io/sanity/main/packages/sanity/src/core/i18n/bundles/studio.ts)). A Compare versions view diffs draft, published and release versions ([Compare document versions](https://www.sanity.io/docs/studio/compare-document-versions)).
- **No merge or conflict-resolution step is documented**, and no warning when the published document changes after a version was created.

### Rollback

- "You can return to the state prior to when a release was published by reverting the release", immediately or as a new staged release; Enterprise add-on ([user guide](https://www.sanity.io/docs/user-guides/content-releases)).
- Revert "restores every document to its pre-release revision, only unpublishes documents that did not exist before the release, and stops if any document's previous state cannot be determined" ([changelog](https://www.sanity.io/docs/changelog/studio-Ni4xMy4x)). It warns: "Changes were made to documents in this release after they were published. Reverting will overwrite these changes" ([Studio source](https://raw.githubusercontent.com/sanity-io/sanity/main/packages/sanity/src/core/releases/i18n/resources.ts)).
- Limited by history retention: 3 days Free, 90 Growth, 365 Enterprise ([History experience](https://www.sanity.io/docs/user-guides/history-experience)).

### Limits

- Content Releases is an Enterprise add-on ([config](https://www.sanity.io/docs/studio/content-releases-configuration); [Pricing](https://www.sanity.io/pricing)). Scheduled Drafts are Growth and above ([Scheduled drafts](https://www.sanity.io/docs/studio/scheduled-drafts)).
- At most 1,000 document versions and 100 MB per release; versions count toward the dataset's document limit ([Technical limits](https://www.sanity.io/docs/content-lake/technical-limits)).

### Not confirmed

- Publishing a release whose version was copied from an older published state: presumably overwrites the newer published document (whole-document last-write-wins). Not stated.
- Whether a small release publishes in exactly one transaction (inferred from Studio's revert code only).
- Whether documents created by a release are kept as drafts after a revert (user guide and changelog differ).

## Contentful: environments, Launch and Timeline

Contentful has three mechanisms: **environments and aliases** (content-model and dev work), **Launch releases** (`Release.v1`, a group of links to entries) and **Timeline releases** (`Release.v2`, separate future versions of entries).

### What Live means

- Entries are Draft, Changed (published with pending changes), Published or Archived. There is one draft and at most one published copy per entry ([entry state guide](https://www.contentful.com/developers/docs/tutorials/general/determine-entry-asset-state/)).
- The `master` environment is "where your production or live content resides" ([help](https://www.contentful.com/help/environments/)); the `master` alias can point at any environment ([concept](https://www.contentful.com/developers/docs/concepts/environment-aliases/)).

### Storage and preview

- **Environment:** an "exact copy of the original, including all content, entries, assets, and configuration" ([help](https://www.contentful.com/help/environments/)).
- **Launch release:** a list of links (`sys.type`, `sys.linkType`, `sys.id`) without versions ([Releases API](https://www.contentful.com/developers/docs/references/content-management-api/releases/)). Publishing publishes "all entries/assets that it contains changing their DRAFT state to PUBLISHED" ([set up a release](https://www.contentful.com/help/launch/create-manage-release/setting-up-a-release/)), so it references the entry's single draft, not a snapshot (inference from the schema). Referenced entries must be added by hand (same page). No documented Launch preview.
- **Timeline release:** editors edit "a release version of the entry that exists separately from the main entry" ([apps in release context](https://www.contentful.com/developers/docs/extensibility/app-framework/working-with-releases/)), copied from the current version or another release ([create a Timeline release](https://www.contentful.com/help/timeline/create-a-release/)).
- **Timeline preview** stacks every release scheduled before the one previewed, "falling back to the previous scheduled release or the currently published version" ([preview Timeline releases](https://www.contentful.com/help/timeline/preview-a-release/); [Preview API, Timeline](https://www.contentful.com/developers/docs/references/content-preview-api/timeline/)).

### Publishing and atomicity

- "If at least one of the entries or assets is invalid, the entire release will fail to publish and the published content will remain unchanged" ([what is a release](https://www.contentful.com/help/launch/create-manage-release/what-is-a-release/)).
- Publishing is asynchronous: `202` plus a `ReleaseAction` going `created` → `inProgress` → `succeeded` ([Releases API](https://www.contentful.com/developers/docs/references/content-management-api/releases/)). A successful publish archives the release ([publish a release](https://www.contentful.com/developers/docs/references/content-management-api/releases/publish-a-release/)).
- 200 entities per release; 80 Timeline releases per environment, 30 scheduled ([technical limits](https://www.contentful.com/developers/docs/technical-limits/)).

### Conflicts

- No documented rule or warning for the same entry in several Launch releases, or for edits after an entry was added.
- Timeline states that changes to the current version are **not** carried into future versions (the example: shipping cost changed from 10 to 5 euros won't reach the Black Friday version) ([help](https://www.contentful.com/help/timeline/)). Overlapping Timeline releases resolve by date. Contentful advises versioning pages or sections in releases, never shared components ([best practices](https://www.contentful.com/help/timeline/timeline-best-practices/)).
- Concurrent edits use optimistic locking on `X-Contentful-Version` ([Management API](https://www.contentful.com/developers/docs/references/content-management-api/)).
- Environment merges: the Merge app covers content types only, and "Merges are final" ([Merge app](https://www.contentful.com/help/reuse-content-structures/merge-app/)). The `contentful-merge` CLI diffs entries but only "published content is taken into account", with no three-way conflict handling ([contentful-merge guide](https://www.contentful.com/developers/docs/tutorials/general/diff-and-merge-content-with-contentful-merge/)).

### Rollback

- Unpublishing a release takes entries offline; it doesn't restore earlier versions ([set up a release](https://www.contentful.com/help/launch/create-manage-release/setting-up-a-release/)). No "revert release".
- Per-entry, per-field version history, only in `master` ([versions](https://www.contentful.com/help/content-and-entries/versions/); [multiple environments](https://www.contentful.com/developers/docs/concepts/multiple-environments/)).
- Environments roll back by repointing the `master` alias, positioned for content-model deployments ([deploying with aliases](https://www.contentful.com/developers/docs/tutorials/general/deploying-changes-with-environment-aliases/)).

### Limits

- Launch is a paid app (the Releases API is open to all); Timeline is "available on specific plans" and doesn't work with Workflows, comments and other features ([Releases API](https://www.contentful.com/developers/docs/references/content-management-api/releases/); [help](https://www.contentful.com/help/timeline/)).

### Not confirmed

- That Launch publishes each entry's latest draft at publish time (inferred).
- Atomicity beyond validation; behaviour on failure mid-publish.
- Any warning for an entry in several Launch releases; what happens to later Timeline versions when an earlier release publishes; reverting a published Timeline release.

## Storyblok: Releases

### What Live means

- Each story has a working draft and a published state; `published` and `unpublished_changes` flags ([Story object](https://www.storyblok.com/docs/api/management/stories/the-story-object)). The delivery API's `version` is `draft` or `published` ([Retrieve Multiple Stories](https://www.storyblok.com/docs/api/content-delivery/v2/stories/retrieve-multiple-stories)); Public tokens read only `published` ([Access tokens](https://www.storyblok.com/docs/concepts/access-tokens)).

### Storage and preview

- "A release is a group of content changes scheduled for publishing" ([Content Authoring](https://www.storyblok.com/docs/manuals/content-authoring)).
- Each story in a release is a separate copy. The story holds `release_ids`, `base_version_id` (content "when it was first added to the release"), `current_version_id` (latest "within the release") and `main_version_id` (current "outside the release") ([Story object](https://www.storyblok.com/docs/api/management/stories/the-story-object)).
- Read a release with `from_release=<id>` on delivery requests ([Retrieving a story from a release](https://www.storyblok.com/docs/api/content-delivery/v2/stories/examples/retrieving-an-edited-version-of-a-story-from-a-release)); the Visual Editor carries the release in its URL and passes `_storyblok_release` to the preview ([FAQ: release preview](https://www.storyblok.com/faq/view-release-preview-environment)).
- Releases can be restricted to users, roles and API tokens ([Release object](https://www.storyblok.com/docs/api/management/releases/the-release-object)).

### Publishing and atomicity

- A release "publishes as a unit, either manually or on a schedule" ([Releases app](https://www.storyblok.com/docs/apps/releases)), via `do_release: true` ([Update a Release](https://www.storyblok.com/docs/api/management/releases/update-a-release)).
- "On publish, Storyblok merges release changes into the main story" ([Experiments](https://www.storyblok.com/docs/manuals/experiments)); the webhook event is `merged` ([Webhooks](https://www.storyblok.com/docs/concepts/webhooks)).

### Conflicts

- A conflict is when a story "has changed after it was added to the release"; `GET /releases/:id/check_conflicts` returns `has_conflicts` ([Check Conflict in Release](https://www.storyblok.com/docs/api/management/releases/check-conflict-in-release)).
- **Release Merging** (January 2026, Premium) "automatically detects when content in a release changes after approval", shows a field-by-field comparison, and offers "Accept changes" (pull latest into the release) or "Reject changes" (keep the approved content), or automatic intake of later updates ([Release Merging](https://www.storyblok.com/cl/release-merging)). Mismatches can be resolved "individually or in bulk" ([Releases app](https://www.storyblok.com/docs/apps/releases)).
- Separately, two editors saving the same story get a "Content Conflict" warning with "Copy Over" or "Overwrite" ([Content Authoring](https://www.storyblok.com/docs/manuals/content-authoring)).

### Rollback

- Per-story history and "Restore" ([History](https://www.storyblok.com/docs/manuals/history); [Restore a Story Version](https://www.storyblok.com/docs/api/management/stories/restore-a-story-version)). No documented whole-release undo ([Releases API](https://www.storyblok.com/docs/api/management/releases)).

### Limits

- Releases need Premium (20) or Elite (unlimited); Release Merging is Premium+ ([Pricing](https://www.storyblok.com/pricing)).

### Not confirmed

- Whether publish is one transaction.
- Which copy wins when one story is in two releases that publish in turn.
- The conflict field comparison: the API says `current_version_id ≠ base_version_id`, though `main_version_id ≠ base_version_id` would better match "changed after added".
- Whether merging replaces the whole story or merges fields when conflicts are left unresolved.

## Prismic: Releases and refs

### What Live means

- Pages are Draft, Live or Archived ([organize-pages](https://prismic.io/docs/organize-pages)).
- "A ref is an identifier for a specific version of your content." The **master ref** is "the current version of your content"; "Every time you publish changes, a new master ref is generated" ([Repository API](https://prismic.io/docs/repository-api-technical-reference)). Only the six most recent refs are kept ([glossary](https://prismic.io/docs/glossary)).

### Storage and preview

- A release is "a collection of drafts that you can publish at the same time" ([[archived] guide](http://web.archive.org/web/20250630090747/https://prismic.io/docs/guides/draft-plan-and-schedule-content)); current docs: "publish everything at once" ([releases](https://prismic.io/docs/releases)).
- Each release has its own ref in two parts: "The first hash in the ref is updated whenever a change is made in the release ... The second hash in the ref is updated whenever a page in the repository is published" ([Repository API](https://prismic.io/docs/repository-api-technical-reference)). So a release is resolved on top of the current Live state (inference).
- "You can preview an entire release live on your website" ([releases](https://prismic.io/docs/releases)).

### Publishing and atomicity

- Publish now or on a schedule (`scheduledAt`) ([releases](https://prismic.io/docs/releases); [Repository API](https://prismic.io/docs/repository-api-technical-reference)). No transactional guarantee is documented; the archived guide advises scheduling releases "at least one minute apart", and migration releases publish asynchronously ([prismicio-client v7](https://prismic.io/docs/technical-reference/prismicio-client/v7)).
- "Unpublishing pages in a release is not currently supported" ([releases](https://prismic.io/docs/releases)).

### Conflicts

- A page can be in several releases, each with its own version: "If you make changes to a version of a page in one release, those changes will not automatically be reflected in a version of the same page in another release" ([[archived] guide](http://web.archive.org/web/20250630090747/https://prismic.io/docs/guides/draft-plan-and-schedule-content)).
- "To avoid broken links between pages, ensure that any pages with links between them are in the same release" (same guide).
- No conflict warning, merge step or "Live has changed since" indicator is documented.

### Rollback

- Per-page history; "Restore" reverts "to the previous version as an unsaved draft", then Save and Publish ([create-pages](https://prismic.io/docs/create-pages)). No release-level rollback.
- Deleting a release: "Changes to pages in the release will be archived. The original version will remain untouched" ([releases](https://prismic.io/docs/releases)).

### Limits

- "Releases can contain up to 200 pages" ([releases](https://prismic.io/docs/releases)), though the migration guide says 1,000 ([migration](https://prismic.io/docs/migration)).

### Not confirmed

- Atomicity, and whether a release publish produces exactly one master ref.
- What happens when a page in a release is published directly or by another release first. Community forum threads (not primary) report the later release overwriting the earlier one's changes.
- Whether a page can have a normal draft and a release version at once.
