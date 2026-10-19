# Named drafts replace environments and per-item publishing

Pages, layouts, synced blocks, and collection records used to publish independently, each with its own draft and live state, and each project had a production environment plus a development environment per developer, replicated with push and pull. Both were designed for humans making occasional, small changes. Agents change many connected things at once, and several of them, alongside editors, need to work in parallel without blocking each other. Per-item publishing made every publish a walk of the dependency tree (does this page need that synced block, that layout, those records?), and a single draft per item meant everyone edited the same state. We replace both with one concept: a project has one Live state and any number of named drafts, and publishing applies a whole draft to Live at once.

## Considered Options

- **Keep per-item publishing.** Familiar from Strapi, but the dependency walk grows with every new kind of content (layouts, synced blocks, collections, references), and it still allows only one draft per item.
- **Reuse environments as branches.** Environments are full copies whose rows get new identities on every push, and pushing replaces the whole target. Without shared identity there is no way to diff or merge, so parallel work would overwrite itself.
- **Publish parts of a draft.** It brings the dependency walk back. Splitting a draft in two is the answer instead.

## Consequences

- Content needs identities that stay the same across Live and every draft, so a draft can be compared with Live and applied to it. See [Stable content identity](0004-stable-content-identity.md).
- A draft stores only what it changes, on top of Live. Anything it doesn't change always shows the latest Live content, so drafts don't need to be brought up to date by hand. See [Drafts are rows beside Live](0005-drafts-as-rows-beside-live.md).
- Live is read-only in the studio. Editing while viewing Live starts a draft, so a quick fix is still edit, then publish.
- Files belong to drafts like any other content.
- Agents work only in Live's definitions, never changing them. Definition changes happen in development drafts, which replace development environments and stay out of the hosted studio. A development draft can only be published once a release has given Live the same definitions, the same rule push follows today. See [Definitions live in Live and in development drafts](0006-definitions-in-live-and-development-drafts.md).
- The first version doesn't merge. When a draft changed something that Live also changed since, publishing overwrites Live's version after the editor confirms. Field-level merging and AI-assisted resolution can come later without changing the model.

## Research

- [D1 limits for publishing (#194)](https://github.com/remidej/camox/issues/194): whether a draft can be applied to Live atomically on Cloudflare D1.
