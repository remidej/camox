---
name: camox-expand
description: Expand a Camox project's Block Definitions ahead of need by finding jobs they can't do yet, proposing new blocks and Settings, and building the approved ones. Use when asked to add more blocks or prepare blocks before a launch.
---

# Camox Expand

Work in an existing Camox project. Grow its Block Definitions so editors can do more with content changes alone. Every addition fills a real **gap**: a job the current Block Definitions can't do, or can only do in a shape or visual treatment the site already repeats. Each one must keep the site's own design.

## 1. Ask about what's next

Ask the operator one question: what is being launched or published next? Use the answer to rank gaps. If they have nothing planned, the other evidence decides.

## 2. Inventory the Block Definitions

Read every Block Definition in `src/blocks/`. For each one, note its job, content shape, visual treatment, and Settings. Also look at the rendered site to learn its design language. You're done when you can say which jobs each block does and how two blocks for the same job differ.

## 3. Find gaps

Collect evidence in this order:

1. **Upcoming needs** from the operator's answer.
2. **The jobs checklist.** Compare [Jobs](references/jobs.md) with the Block Definitions. A job counts as covered only when an existing block, or an existing block with a Setting, does it well.
3. **The source site**, when the project was migrated from one. Look for sections and page types that `camoxify-progress.md` or the current Pages don't reproduce.
4. **Competitors' sites**, only when the site's category is clear. Take the jobs their pages and sections do, and leave their designs and copy alone. Every suggestion is designed in the site's own visual language.

Decide between a new block and a Setting with Camoxify's "Reuse before creating" rule in [Inspect and decompose](../camoxify/SKILL.md#inspect-and-decompose).

You're done when every evidence source that applies has been checked, every job in the checklist is marked covered or a gap, and every gap is marked as a new block or a Setting.

## 4. Propose and wait for approval

List the suggestions in the chat. Each one has:

- its **job**,
- its **kind**: new block, or new Setting on an existing block,
- the **closest existing block**,
- a **text wireframe** for a new block, or a **before/after sketch** for a new Setting, in a fenced code block so it renders in any harness.

```text
Logo wall (new block). Job: social proof. Closest: feature-grid
+----------------------------------------------+
|        Trusted by teams shipping daily        |
|  [logo]  [logo]  [logo]  [logo]  [logo]       |
+----------------------------------------------+
```

Stop suggesting when the next idea would be filler; there is no target count. Then wait. The operator approves, cuts items, or asks for more or fewer. Revise until they approve a list. Nothing is built before that.

## 5. Build the approved list

Make only these kinds of change:

- **New Block Definitions**, following [Block Definitions](../camox/references/block-definitions.md), [Localized code](../camox/SKILL.md#localized-code) (every visible text in fields, internal links through `useLocalizedHref` without a locale prefix), and Camoxify's rules on [styling](../camoxify/SKILL.md#use-the-existing-styling-stack), [genericity and default content](../camoxify/SKILL.md#keep-definitions-generic), [repeaters](../camoxify/SKILL.md#model-repetition-not-a-fixed-screenshot), [Settings](../camoxify/SKILL.md#use-settings-for-constrained-choices), and [formatted text](../camoxify/SKILL.md#keep-formatted-text-in-one-field).
- **New Settings on existing Block Definitions**, with defaults that leave current rendering unchanged. Existing content schemas stay exactly as they are. Before editing the block, capture it in the Block Catalog at desktop and mobile, opened at `/camox/blocks/<id>` on the running dev server; step 6 compares against this capture.
- **Description edits.** A new block's `description` says when to choose it over its siblings. Edit the siblings' descriptions so each one names what sets it apart, and the Agent can choose between them.

New blocks live only in code and the Block Catalog. Leave Pages, layouts, and publishing alone, and create no temporary Pages. This rules out new Layout-only Blocks: the Block Catalog never shows them, and they only sync once a layout uses them. An existing Layout-only Block that gains a Setting has no Block Catalog page either, so capture and check it on a Page whose layout uses it.

## 6. Verify

Finish with a Block Catalog link to each new block, so the operator and the product marketing team can review them live. Delete any block the operator rejects, along with any description changes made only for it.

The run is complete when:

- every approved item is built, and every rejected one is deleted,
- the project's `check` script passes, and so does `vp lint --type-aware --type-check`, since `vp check` skips type errors unless the project's Vite config sets `lint.options.typeCheck`,
- every new block renders correctly with its default content at desktop and mobile in the Block Catalog at `/camox/blocks/<id>`,
- every existing block that gained a Setting renders the same as its capture with default Settings.
