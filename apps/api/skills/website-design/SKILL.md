---
name: website-design
description: How the website looks. Read before building or restructuring a page, a redesign or rebrand, a new block, or restyling colors, fonts, layout or motion.
---

# Website design

Design every page as a design lead whose clients have rejected anything templated: a website for a bakery looks nothing like one for a law firm. The subject's world (its trade, materials, vernacular and audience) is where distinctive choices come from.

## 1. Find out whose Theme it is

Read the opening comment of `src/styles.css`.

- **It says the Theme is still the Template's**: nobody chose this look. Any request about the look, even a vague one ("make it ours", "make it look better"), is a new look: follow [A new look](#2-a-new-look).
- **The request asks for a new look** (a redesign, a rebrand, "make it look like…"): follow [A new look](#2-a-new-look).
- **Otherwise** the Theme is the website's own: follow [Within the Theme](#3-within-the-theme).

## 2. A new look

1. **Ground it in the subject.** Read the website's content and the request for what the website is about, who it's for, and its main job. When they don't say, ask in one message before designing: what the business does, who it serves, two or three websites they like, and how it should feel. Then wait for the answer.
2. **Plan.** Write a short plan in your turn:
   - Color: the five brand inputs on `:root`, each a named value.
   - Type: one family or two, with their roles. Two families must be clearly distinct. Find them with `searchFonts`, chosen for this subject rather than the families you'd reach for on any project.
   - Shape and rhythm: the radius roles, `--spacing-section`, and `--eyebrow-case`.
   - Layout: a one-sentence concept and an ASCII wireframe of the homepage, with its alignment.
   - The one memorable thing, and why it belongs to this subject.
3. **Review the plan against the [defaults](#defaults).** Imagine the plan you'd write for a similar website: every part that matches it is a default, not a choice. Revise it, and say what you changed and why. When the request names a look, it wins, even when it names a default.
4. **Build.** Change the Theme first, then each block's markup until the pages follow the plan: tokens alone rarely change how a layout reads. Then delete the opening comment that says the Theme is the Template's: the new Theme is the website's own.
5. **[Check](#4-check).**

## 3. Within the Theme

The Theme is a choice someone made: build from it. Use its color schemes, text roles, radius roles and spacing, compose the components in `src/components/`, and match the rhythm of the blocks around the one you change. A new block should read as part of the same website. When the request needs something the Theme lacks, add it to the Theme rather than to one block.

Then [check](#4-check).

## 4. Check

- **The design holds whatever editors write.** A block is a template that editors refill: try its default content, then each field at its longest and shortest, a repeatable with one item and with twelve, an empty image, and a translation 30% longer. The layout stays intact in all of them.
- **Every trait in it is a choice.** Each of the [defaults](#defaults) it has is one the subject calls for.
- **Each page has its own shape.** No block definition follows itself or recurs close by, and each recurring block is set differently and sits among different neighbours ([A page never repeats itself](#principles)).
- **It meets the floor**: responsive down to a phone, visible keyboard focus, `prefers-reduced-motion` respected, text contrast readable on every scheme it sits on.
- **It looks right.** When you have `look`, screenshot the pages you changed, on desktop and on a phone, and critique them as the client would. Then remove one accessory: the decoration that serves the subject least.

## Principles

- **Spend boldness in one place.** One element is the memorable thing; everything around it stays quiet and disciplined.
- **The hero opens with the most characteristic thing in the subject's world**, in the form that fits it: a headline, an image, an artifact, an interactive moment.
- **Typography carries the personality.** Set a clear type scale with deliberate weights and spacing, and use a headline's type treatment as part of the design. Keep lines under 80 characters; serif body text gets slightly more line height than sans-serif.
- **A page never repeats itself.** A visitor who spots the same structure coming back is bored by it. Never place a block definition twice in a row, and keep its placements on a page far apart, with several other blocks between them. When a page needs more sections than the existing block definitions can space out, write new block definitions for the extra ones, shaped for their content: a new block is the expected cost of a long page. Across the website, vary which blocks open each page and which follow each other, so pages don't share a skeleton. Each time a block definition recurs, set its Block Settings unlike its nearest other placement, such as another layout, color scheme or media side.
- **Structure is information.** Borders, numbering, eyebrows, dividers and labels each encode something about the content. Number items only when they are a sequence, such as steps or a timeline.
- **Motion draws attention once.** One orchestrated moment, such as a page-load sequence or one reveal, lands better than effects on every section. Motion answering a visitor's action (opening, expanding, confirming) shows what changed.
- **Copy is design.** Write about the subject, specifically, in plain words from the visitor's side: say what something is or does rather than selling it. A button says what happens when it's clicked. Sentence case, no filler.

## Defaults

Generated websites cluster around these looks. Each is legitimate when the subject calls for it, and a tell when it appears whatever the subject:

1. A warm cream background (near `#F4F1EA`), a high-contrast serif display and a terracotta accent (near `#D97757`).
2. A near-black background with one acid-green or vermilion accent.
3. A broadsheet layout: hairline rules, square corners, dense newspaper columns.
4. The SaaS-card kit: content chopped into identical rounded cards, one radius on everything, the same soft grey shadow under each, gradient washes as decoration.
5. Template chrome: an uppercase eyebrow above every heading; one word of a headline accented in another color or italic; meta strings joined with middle dots (`A · B · C`); `→` after link and button text; monospace for small labels; a big number with a small label as the hero.
6. A fade-and-slide-up entrance on every section, and a hover lift on every card.
