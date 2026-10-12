---
name: camoxify
description: Turn an existing website, screenshot, or design into an editable Camox site. Use when recreating a reference in an existing Camox project, composing its design into blocks, layouts, fields, and repeaters.
---

# Camoxify

Work in the existing Camox project; project creation and authentication are onboarding prerequisites. Match the reference while making the result reusable and easy to edit.

## Scope the run

Take the scope from the request. A first run usually covers the shell and the homepage; a later run may cover the whole site, reusing what earlier runs built.

For multi-page runs, build the page list before coding: read the sitemap (`/sitemap.xml`, or the one named in `/robots.txt`) and follow navigation and footer links. Group pages that share one structure, such as blog posts, case studies, or docs articles, into a **page family**: one layout and set of blocks, built and verified on a representative page, then repeated for the rest through the CLI. Confirm the list and its families with the user before building.

Track progress in `camoxify-progress.md` at the project root: one line per page with its status (pending, built, populated, verified) and any new definitions it introduced. Update it as each page advances. When resuming, start from that file and the project's current definitions.

## Inspect and decompose

Inspect the source URL with available browsing tools, or use the supplied screenshot/design. If the URL is inaccessible, ask for screenshots. Check multiple pages and viewport sizes when available; don't infer a whole site's structure from one crop.

For URL references, use a browser when available to explore interactive states: navigation dropdowns, hover menus, tooltips, modals, accordions, carousels, and mobile navigation. Reproduce observed behavior, not just the initial appearance. Avoid submitting forms or triggering destructive actions.

Before coding, map the reference to:

- **Layout:** the consistent shell across pages, such as navigation and footer. Editable shell content still lives in blocks, placed by the layout.
- **Page blocks:** independently useful sections such as a hero, feature grid, testimonials, or pricing. Avoid both a monolithic page block and separate blocks for every heading or card.

Reuse before creating. When a section matches an existing definition's content shape and visual treatment, use it, adding a setting for a small variation. Create a new definition when the visual treatment or the content shape is meaningfully different; distinct designs for the same job keep pages varied. A new definition's `description` says when to choose it over similar existing blocks.

- **Fields and repeaters:** editable content within each section, grouped by meaning rather than visual position.

Read [Block Definitions](../camox/references/block-definitions.md) and, when creating or changing a shell, [Layout Definitions](../camox/references/layout-definitions.md).

## Use the existing styling stack

Strongly prefer the project's existing shadcn components and Tailwind utilities for all styling. Inspect and reuse existing components, theme tokens, and styling conventions before building new ones. Compose or extend them to match the reference.

If the reference uses another styling system, recreate its appearance and behavior with the project's existing shadcn components and Tailwind utilities; do not copy or introduce the reference's styling dependencies.

Do not install other styling libraries or rely on raw CSS, custom stylesheets, or inline styles. Express layout, spacing, typography, colors, responsive behavior, and interactive states through Tailwind and the existing shadcn components.

## Keep definitions generic

Block names, schemas, rendering, and **default content** must work on other pages. Use `feature-grid`, not `acme-homepage-features`. Defaults are neutral examples, not the reference's copy, links, assets, or item data.

Apply reference-specific content **only to instances through the CLI**, never by changing definition defaults or hardcoding it in JSX.

## Model repetition, not a fixed screenshot

Use `field.repeater` for every repeated content structure: lists, rows, columns, tables, carousels, navigation items, and cards. Never use `field1`, `field2`, etc., or hardcoded content arrays. Nest repeaters for structures such as footer columns containing links or table rows containing cells.

Choose bounds from real constraints, not the number of items visible in the reference. Many sibling fields are a code smell: look for repeated groups or separate sections. Model enough flexibility to add, remove, reorder, and rewrite content without code changes; don't expose every CSS value as a field.

## Use settings for constrained choices

Before adding a `content` field, ask whether the editor is writing free-form content or choosing from known options. For configuration choices such as alignment, theme, size, or variant, use `settings` with `setting.enum`. For on/off choices such as showing a background or enabling autoplay, use `settings` with `setting.boolean`.

Do not model these choices as `content` fields using `field.string`, even if rendering code could interpret strings such as `"left"`, `"dark"`, or `"true"`. Editors should choose a valid option or toggle a setting, not type a magic string. Reserve `content`'s `field.string` for genuinely free-form text, such as headings and descriptions. Enum defaults must match an option key.

## Keep formatted text in one field

Use inline formatting and `textStyle`, including highlights, instead of fields such as `headingStart`, `coloredWord`, and `headingEnd`. Editors should be able to move the emphasis by editing content alone. Read [Field styling](../camox/references/field-styling.md).

```ts
// Avoid: headingStart + coloredWord + headingEnd
// Instance content:
{
  title: "Build <highlight>something great</highlight>";
}
```

## Populate and verify

Follow the [Camox CLI workflow](../camox/SKILL.md#content-and-cli) to assign layouts, place blocks, and populate content, including shared navigation/footer content. Don't publish unless asked.

Compare the rendered site with the reference at desktop and mobile sizes. Verify that fields remain editable and that longer text and different repeater counts still work. Fix the reusable implementation, not just the one captured arrangement.

In multi-page runs, give this full check to every page that introduced or changed a definition, and to each page family's representative page. Compare the remaining pages with their source at desktop size. The run is complete when every page in `camoxify-progress.md` is verified.

Once the run is complete, suggest running `camox-expand` to build blocks for jobs the site will need next.
