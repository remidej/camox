---
name: camoxify
description: Turn an existing website, screenshot, or design into an editable Camox site. Use when recreating a reference in an existing Camox project, composing its design into blocks, layouts, fields, and repeaters.
---

# Camoxify

Work in the existing Camox project; project creation and authentication are onboarding prerequisites. Match the reference while making the result reusable and easy to edit.

## Inspect and decompose

Inspect the source URL with available browsing tools, or use the supplied screenshot/design. If the URL is inaccessible, ask for screenshots. Check multiple pages and viewport sizes when available; don't infer a whole site's structure from one crop.

For URL references, use a browser when available to explore interactive states: navigation dropdowns, hover menus, tooltips, modals, accordions, carousels, and mobile navigation. Reproduce observed behavior, not just the initial appearance. Avoid submitting forms or triggering destructive actions.

Before coding, map the reference to:

- **Layout:** the consistent shell across pages, such as navigation and footer. Editable shell content still lives in blocks, placed by the layout.
- **Page blocks:** independently useful sections such as a hero, feature grid, testimonials, or pricing. Reuse existing definitions where they fit. Avoid both a monolithic page block and separate blocks for every heading or card.
- **Fields and repeaters:** editable content within each section, grouped by meaning rather than visual position.

Read [Block Definitions](../camox/references/block-definitions.md) and, when creating or changing a shell, [Layout Definitions](../camox/references/layout-definitions.md).

## Keep definitions generic

Block names, schemas, rendering, and **default content** must work on other pages. Use `feature-grid`, not `acme-homepage-features`. Defaults are neutral examples, not the reference's copy, links, assets, or item data.

Apply reference-specific content **only to instances through the CLI**, never by changing definition defaults or hardcoding it in JSX.

## Model repetition, not a fixed screenshot

Use `Type.Repeater` for every repeated content structure: lists, rows, columns, tables, carousels, navigation items, and cards. Never use `field1`, `field2`, etc., or hardcoded content arrays. Nest repeaters for structures such as footer columns containing links or table rows containing cells.

Choose bounds from real constraints, not the number of items visible in the reference. Many sibling fields are a code smell: look for repeated groups or separate sections. Model enough flexibility to add, remove, reorder, and rewrite content without code changes; don't expose every CSS value as a field.

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
