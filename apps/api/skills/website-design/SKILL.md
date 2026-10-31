---
name: website-design
description: How the website looks. Read before a new look, a redesign or rebrand, a new block or Layout, or restyling colors, fonts, layout or motion.
---

# Website design

Design as a design lead whose clients have rejected anything templated: a website for a bakery looks nothing like one for a law firm. The subject's world (its trade, materials, vernacular and audience) is where distinctive choices come from.

Reusable is not generic. A block assumes nothing about the content editors put in it, and still belongs unmistakably to this subject: its type, color, shape and motion carry the subject, so any content reads as this website's.

## 1. Find out whose Theme it is

Read the opening comment of `src/styles.css`.

- **It says the Theme is still the Template's**: nobody chose this look. Any request about the look, even a vague one ("make it ours", "make it look better"), is a new look: follow [A new look](#2-a-new-look).
- **The request asks for a new look** (a redesign, a rebrand, "make it look like…"): follow [A new look](#2-a-new-look).
- **Otherwise** the Theme is the website's own: follow [Within the Theme](#3-within-the-theme).

## 2. A new look

1. **Ground it in the subject.** The request says what the business does, who it serves, websites the editor likes, and how it should feel. When it lacks these, answer by asking for them, and design once they come.
2. **Plan.** Write a short plan in your turn:
   - Color: the five brand inputs on `:root`, each a named value.
   - Type: one family or two, with their roles. Two families must be clearly distinct. Find them with `searchFonts`, chosen for this subject rather than the families you'd reach for on any project.
   - Shape and rhythm: the radius roles, `--spacing-section`, and `--eyebrow-case`.
   - Layout: a one-sentence concept, and the grid and alignment the blocks share.
   - The one memorable thing, and why it belongs to this subject.
3. **Review the plan against the [defaults](#defaults).** Imagine the plan you'd write for a similar website: every part that matches it is a default, not a choice. Revise it, and say what you changed and why. When the request names a look, it wins, even when it names a default.
4. **Build.** Change the Theme first, then each block's markup and each Layout until they follow the plan: tokens alone rarely change how a layout reads. Then delete the opening comment that says the Theme is the Template's: the new Theme is the website's own.
5. **[Check](#4-check).**

## 3. Within the Theme

The Theme is a choice someone made: build from it. Use its color schemes, text roles, radius roles and spacing, compose the components in `src/components/`, and match the rhythm of the website's other blocks. A new block should read as part of the same website. When the request needs something the Theme lacks, add it to the Theme rather than to one block.

Then [check](#4-check).

## 4. Check

- **The design holds whatever editors write.** A block is a template that editors refill: `look` at it with its default content, then each field at its longest and shortest, a repeatable with one item and with twelve, an empty image, a translation 30% longer, and each Block Setting. Look at a Layout with a short page and a tall one, a long navigation and an empty footer column. The layout stays intact in all of them.
- **Every trait in it is a choice.** Each of the [defaults](#defaults) it has is one the subject calls for.
- **It meets the floor**: responsive down to a phone, visible keyboard focus, `prefers-reduced-motion` respected, text contrast readable on every color scheme it sits on.
- **It looks right.** Critique each look as the client would. Then remove one accessory: the decoration that serves the subject least.

## Principles

- **Spend boldness in one place.** One element is the memorable thing; everything around it stays quiet and disciplined.
- **Typography carries the personality.** Set a clear type scale with deliberate weights and spacing, and use a headline's type treatment as part of the design. Keep lines under 80 characters; serif body text gets slightly more line height than sans-serif.
- **Structure is information.** Borders and dividers each encode something about the content: draw them where the content has that structure.
- **Motion draws attention once.** One orchestrated moment, such as a page-load sequence or one reveal, lands better than effects on every block. Motion answering a visitor's action (opening, expanding, confirming) shows what changed.

## Defaults

Generated websites cluster around these looks. Each is legitimate when the subject calls for it, and a tell when it appears whatever the subject:

1. A warm cream background (near `#F4F1EA`), a high-contrast serif display and a terracotta accent (near `#D97757`).
2. A near-black background with one acid-green or vermilion accent.
3. A broadsheet layout: hairline rules, square corners, dense newspaper columns.
4. The SaaS-card kit: content chopped into identical rounded cards, one radius on everything, the same soft grey shadow under each, gradient washes as decoration.
5. Template chrome: uppercase eyebrows; monospace for small labels; a big number with a small label as the hero.
6. A fade-and-slide-up entrance on every block, and a hover lift on every card.
