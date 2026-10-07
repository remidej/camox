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
With `pnpm dev` running, sign into Studio, select the playground project and the
intended environment, and open **Content → Customers**:

1. Create an item named “Ada Lovelace”, company “Analytical Engines”, and save.
   The browser shows **Draft**; saving does not publish.
2. Edit the company, save, then hover or keyboard-focus its row and click **Publish**.
   The item’s
   independent switch starts on. Turn it off to verify confirmation is disabled,
   or cancel to leave it unpublished.
3. Reopen and confirm with the switch on. Status becomes **Published** without
   creating or publishing any page or block.
4. Edit and save again. Status becomes **Modified**, using the same badges as
   PagePicker; live reads retain the prior revision. Use **… → Discard changes**
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
