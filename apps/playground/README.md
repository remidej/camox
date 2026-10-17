Development playground for trying out all Camox APIs. This app is not meant to be deployed — it exists to test and experiment with blocks, layouts, and other Camox features during development.

The playground uses the Camox-owned Nitro runtime. Its authored application surface is:

```txt
src/
  blocks/
  layouts/
  components/
  document.ts
  styles.css
```

Camox owns page routing, SSR, hydration, client navigation, Studio, sitemap, markdown, and OG responses. The app does not define TanStack Start or TanStack Router entries.

## Demo content

No manual step is needed. On a fresh clone or worktree, `scripts/prepare.sh` migrates and
seeds the local database, and the first `pnpm dev` creates your development draft. Once the
definitions are synced, `demoArticles.ts` fills the **Articles** collection: five
articles with distinct titles, slugs, excerpts and bodies, no cover, four published one
after another and the last one, "Notes on our next release (draft)", left as a draft.

Seeding runs only when your development draft has no articles, so restarting dev never duplicates
them, and articles you create or delete are left alone. To start over, run `pnpm seed` at
the repository root, which resets the whole local database, then `pnpm dev` again.

The seeder runs as the dev user through the camox plugin's dev-only `_internal.afterSync`
hook in `vite.config.ts`. If it fails, dev logs a warning and keeps running.

## External-data loader example

The Pokémon layouts exercise the ordinary loader contract: `{ kind: "data", data }`.
`Layout.useData()` returns the unwrapped payload, so the UI stays independent of the envelope.

- `/pokedex` loads the directory in a singleton layout.
- `/pokemon/pikachu` loads one Pokémon through typed route parameters.
- `/pokemon-types/electric` loads a type and its Pokémon.
- `/about-camox` remains a singleton without a loader.

With the development services running (`pnpm dev` at the repository root), open `/pokedex`,
search for Pikachu, follow its detail and type links, and refresh each URL. The same
data should render on the server, hydrate without mismatch, and update on client navigation.
Search and “Show more” remain interactive. An unknown Pokémon returns 404; other PokéAPI
errors remain server failures. These examples require access to PokéAPI and the configured
Camox development API. They do not use collections or route discovery.

## Standalone customer publication (slice 3)

`src/collections/customers.ts` is discovered and synced by the Vite plugin; no
page needs to reference an item before it can be authored. The playground already enables experimental Studio features.
With `pnpm dev` running, sign into Studio, select the playground project, and open
**Content → Customers**:

1. Create an item named “Ada Lovelace”, company “Analytical Engines”, and save.
   The browser shows **Draft**; saving does not publish.
2. Edit the company, save, then hover or keyboard-focus its row and click **Publish**.
   The item’s
   independent switch starts on. Turn it off to verify confirmation is disabled,
   or cancel to leave it unpublished.
3. Reopen and confirm with the switch on. Status becomes **Published** without
   changing any page or block.
4. Edit and save again. Status becomes **Modified**; live reads retain the prior
   revision. Use **… → Discard changes**
   to restore the published draft without changing live content, or use
   **Publish changes** in the list to publish the saved draft.
5. Use **… → Unpublish** and confirm: status returns to **Draft**, with content/history kept.
   The whole publish button group appears on row hover or keyboard focus.
   Both menu actions stay listed, disabled
   when unavailable (an unpublished item cannot discard to a published revision).
   Two tabs reviewing the same version cannot silently overwrite one another:
   a stale publish/unpublish/discard fails; cancel and reopen after the list refreshes.

No derived customer URL is created. Repeat with
new customer names or delete an unattached demo item. Automated API/tool integration tests
use this exact definition and verify that public reads never receive draft edits.

## Shared testimonial company (slice 4)

The testimonial's `company` is now `field.reference(customers)`. The quote, author,
and title still belong to each testimonial; `customer.company` belongs to the
shared Customers item. `testimonial.Reference` provides its typed rendering scope.
The Markdown callback reads `c.company.company`, not the stored record ID.

1. Add two testimonials to a draft page. An unset company shows an editor
   placeholder, not an invented customer. It is empty on the public site.
2. Open the first testimonial's **Company** field. Use **Create item** to
   open the existing customer modal, enter a name and company, and save. Cancelling
   the modal must not attach anything.
3. Open the second testimonial's Company field and select the same customer by its
   label in the combobox. This saves only its ID, not a copy of its content.
4. Edit the company inline in either testimonial, or click the selected customer
   card in the reference view. Both previews should update. The reference view itself only
   attaches/unlinks items; source content is edited in the existing modal.
5. Publish the page. Its review lists the customer once even though it appears
   twice; changed customer switches start on. After publication, edit the company
   again and compare draft versus live: live must retain the published company.
   Publishing with the customer switch off preserves its earlier live revision.
   Publishing the customer independently updates every live reference.
6. Verify the published page's Markdown uses the same published company as the
   page, never the draft. Shared fields use purple editor outlines.
7. Click the card's **Unlink** X on one testimonial: the other remains attached, and the customer remains
   in Content → Customers. Deleting a still-referenced customer is rejected.

For required companies, add `{ required: true }` to `field.reference`. Drafts may
remain incomplete, but publication requires an attached published customer or
its explicit inclusion in the publication review. Unpublishing a required live
dependency is rejected; optional unpublished references render empty.

Existing demo testimonials may still contain the old plain-text company value.
Attach a Customers item in each Company view to replace that legacy value;
there is no implicit conversion from text into shared records.

## Shared customer logos (slice 5, reference lists)

The logo grid's `customers` is `field.referenceList(customers, { maxItems: 12 })`: an
ordered list of distinct Customers items, shared with the testimonial's company.
`logoGrid.ReferenceList` renders its child once per linked customer with the same
typed scope as `testimonial.Reference`. The list's order belongs to the logo grid.

Edit the list in the sidebar: the logo grid's Customers row shows how many are
linked and opens the list view. Drag cards to reorder, use the X to unlink (the
customer itself is kept), and pick or create customers below the cards to append
them. Clicking a card opens the shared customer's fields. In the preview, click a
customer in the grid to select it, its logo to select that field, or its company
name to edit it inline: the edit changes
the shared customer, so the testimonial updates too. Agents can also set the
list through the block edit tools with an array of customer IDs.

1. Add a logo grid to a draft page. On the Canvas the empty list shows an "Add
   Customers" placeholder that opens the list view with the picker focused; the
   live site renders nothing. Link two customers, one of which the testimonial
   also uses. Customers never published show a Draft badge on their card.
2. Publish the page. The review lists the shared customer once. A customer that was
   never published doesn't block publishing; the live grid skips it and keeps the
   order of the others.
3. Unpublishing a customer linked only from the grid is allowed, and the live grid
   skips it. Deleting a customer that any draft or live grid links is rejected.

## Customer highlights (slice 5, references in repeatable items)

The customer highlights block is a repeater whose items each hold
`field.reference(customers, { required: true })`, a local note, and an `emphasized`
setting. Each item's `highlight.Reference` renders the shared customer with the same
typed scope as `testimonial.Reference`; the note and emphasis belong to the item only.

1. Add customer highlights to a draft page. On the Canvas each item's unset customer shows a
   "Select Customers" placeholder that opens that item's Customer view with the picker
   focused. Link a customer the testimonial or logo grid also uses.
2. Select an item in the sidebar and drill into its Customer: the path reads Customer
   highlights › Highlights › item › Customer › the customer. Editing the customer's company
   inline or in the sidebar updates every block that shows it; toggling Emphasized changes
   only this item.
3. Publishing the page with an unset customer, or one never published and excluded from
   the review, is rejected because the item's reference is required. The review lists a
   customer once even when several items and blocks link it.
4. Unpublishing a customer that a live item requires, or deleting one any item links, is
   rejected.

## Author bio (slice 5, references between collections)

Each article links its author with `field.reference(authors)`. The author bio block places
one author with `field.reference(authors)`. The article's record page renders the author
inside the article's scope: the article is the first hop and the author the second, which
links nothing further.

1. In Content → Authors, create and publish an author. In Content → Articles, pick that
   author on a few of the seeded demo articles (see [Demo content](#demo-content)) and
   publish them.
2. Add an author bio to a draft page and select the author. Click the name to edit it
   inline, or open it from the sidebar: Author bio › Author › the author.
3. The publish review lists the author once. An author left unpublished is skipped on the
   live site.
4. Deleting an author that any article or block links is rejected.

Authors used to link their articles instead. A schema change is rejected while records exist,
so if your development draft still has authors from before, run `pnpm seed` at the repository root
to start over.

## Recent articles and article list (slice 6, query-backed reference lists)

`field.referenceList(articles, { query })` declares a query-backed list: code defines its
membership and order, and the block stores nothing. Both blocks render with the same
`ReferenceList` scope as the logo grid, and each declares per-use Markdown for its records.

- **Recent articles** orders by first publication, newest first, with `limit: 3`.
- **Article list** orders every article by title, ascending (up to the cap of 100).

1. In Content → Articles, create at least four articles and publish three of them.
2. Add a recent articles block to an existing page, and an article list block to another.
   The preview lists drafts too: never-published articles sort first in the recent list,
   as if published now. On the Canvas an empty result renders nothing; there is no "Add"
   placeholder.
3. Click an article title in either list to edit it inline: the edit changes the shared
   article, so the other list and the author bio update too. A draft title change re-sorts
   the preview list, never the live one.
4. Select the recent articles block in the sidebar: its Articles row reads "3 results".
   Drill in to see "Newest 3 by published date" above read-only article cards. There is
   no Unlink, reordering or picker; click a card to edit that article.
5. Publish the pages. The publication review lists no articles for these blocks: query
   results are not owned by the page, and editing a queried article never marks it Modified.
6. Publish a fourth article from Content → Articles. The live recent list and article list
   include it without republishing either page. Republishing an older article keeps its
   place, because `publishedAt` is its first publication. These lists never block
   unpublishing or deleting an article.

## Article record pages (slice 8)

`src/layouts/articles.$slug.tsx` is a record page: it spreads
`articles.pages({ by: "slug", param: "slug" })` into a derived layout, so each article renders
at `/articles/<its slug>`. It renders the article through `Layout.Item` and its author
through `article.Reference`, and declares `toMarkdown`, a title and a description from the
article's fields. `src/layouts/articles.tsx` is the `/articles` singleton. Its articles index
block lists every article and links each one to its record page, with the href built from the
slug in code. In Studio, the article's fields are editable in place, like a referenced record.

After the demo content is seeded (see [Demo content](#demo-content)), with `pnpm dev` running:

1. Open `/articles`, then follow a link, for example `/articles/editing-in-context`. The page
   shows that article's title, excerpt and body, and its author once you pick one (see
   [Author bio](#author-bio-slice-5-references-between-collections)). The tab title is the
   article's title.
2. Signed out, `/articles/next-release-notes` returns 404: that article is a draft. Signed in
   to Studio, the same URL shows the draft.
3. In Content → Articles, change a published article's slug without publishing. The preview
   finds it at the new slug, while visitors keep the old URL until you publish.
4. An unknown slug, such as `/articles/missing`, returns 404.
5. `/sitemap.xml` lists each published article's page, never drafts, even when signed in.
   In Studio, the Canvas opens the Article layout on its first article, draft-only ones
   included.
6. `curl -H "Accept: text/markdown" http://localhost:3000/articles/editing-in-context` returns
   the navbar's Markdown, the article's title, author, excerpt and body, then the footer's.
   It shows the published article even while a draft edit is pending.

Editing an article on its page, signed in to Studio:

1. Open `/articles/editing-in-context` with the Canvas shown. The article's fields have purple
   outlines, like any shared record. Click its title: the sidebar opens the article's fields
   under Layout → the article's title.
2. Edit the title inline, or the excerpt in the sidebar. The `/articles` frame's article list
   shows the new title at once. Editing a title in that list updates the record page too: both
   edit the same article.
3. Click the author's name: the sidebar opens the author, one hop further. Pick another
   author in the article's Author field, and the page shows them.
4. Change the article's slug in the sidebar. The Studio moves to `/articles/<new slug>`
   instead of staying on a 404.
5. Publish from the page's publication modal with the article's switch on, then preview live
   content: the page shows the published article. Switching between draft and live, and
   publishing, reload the page's article.
6. Signed out, the page still shows only the published article.
