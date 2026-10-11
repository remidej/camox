---
name: camox-expand
description: Expand a Camox project's block library ahead of need by finding jobs its Block Definitions can't do yet, proposing new blocks and Settings, and building the approved ones. Use when asked to add more blocks, fill gaps in the block library, or prepare blocks before a launch.
---

# Camox Expand

Work in an existing Camox project. Grow its block library so editors can do more with content changes alone. Every addition fills a real **gap**: a job the current Block Definitions can't do, or can only do in a shape or visual treatment the site already repeats. Each one must keep the site's own design.

## 1. Ask about what's next

Ask the operator one question: what is being launched or published next? Use the answer to rank gaps. If they have nothing planned, the other evidence decides.

## 2. Inventory the library

Read every Block Definition in `src/blocks/`. For each one, note its job, content shape, visual treatment, and Settings. Also look at the rendered site to learn its design language. You're done when you can say which jobs each block does and how two blocks for the same job differ.

## 3. Find gaps

Collect evidence in this order:

1. **Upcoming needs** from the operator's answer.
2. **The jobs checklist.** Compare [Jobs](references/jobs.md) with the library. A job counts as covered only when an existing block, or an existing block with a Setting, does it well.
3. **The source site**, when the project was migrated from one. Look for sections and page types that `camoxify-progress.md` or the current Pages don't reproduce.
4. **Competitors' sites**, only when the site's category is clear. Take the jobs their pages and sections do, and leave their designs and copy alone. Every suggestion is designed in the site's own visual language.

Decide between a new block and a Setting with Camoxify's reuse rule ("Reuse before creating" in [Inspect and decompose](../camoxify/SKILL.md#inspect-and-decompose)). The same content shape and visual treatment becomes a Setting on the existing block. A meaningfully different shape or treatment becomes a new block, even when an existing block already does that job.

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

- **New Block Definitions**, following [Block Definitions](../camox/references/block-definitions.md) and Camoxify's rules on [styling](../camoxify/SKILL.md#use-the-existing-styling-stack), [genericity and default content](../camoxify/SKILL.md#keep-definitions-generic), [repeaters](../camoxify/SKILL.md#model-repetition-not-a-fixed-screenshot), [Settings](../camoxify/SKILL.md#use-settings-for-constrained-choices), and [formatted text](../camoxify/SKILL.md#keep-formatted-text-in-one-field).
- **New Settings on existing Block Definitions**, with defaults that leave current rendering unchanged. Existing content schemas stay exactly as they are.
- **Description edits.** A new block's `description` says when to choose it over its siblings. Update the siblings' descriptions to match, so the Agent can tell them apart.

New blocks live only in code and the Block Catalog. Leave Pages, layouts, and publishing alone, and create no temporary Pages.

## 6. Verify

The run is complete when:

- every approved item is built,
- the project's `check` script passes,
- every new block renders correctly with its default content at desktop and mobile in the Block Catalog, opened at `/camox/blocks/<id>` on the running dev server,
- every existing block that gained a Setting renders the same as before with default Settings.

Finish with a Block Catalog link to each new block, so the operator and the product marketing team can review them live. Delete any block the operator rejects, along with any description changes made only for it.
