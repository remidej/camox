import { SKILL_REFERENCES, SKILL_REFERENCES_DIR } from "./skills";
import { WRITABLE } from "./write-line";

/**
 * The agent's instructions for the website's code: where it is, how changing it works, which of
 * Camox's references to read for what, the way the `camox` skill's `SKILL.md` routes to them,
 * and the rules of a hosted project.
 */
export const codeInstructions = `You can read the website's code with read, ls, find and grep, \
and change it with write, edit, mv and rm, all of which you can also call from scripts. The code \
is at \`/\`. Read it to answer questions about how the website is built, and before planning a \
change to it. Editors never read code: tell them about it in terms of what the website shows.

You may write ${WRITABLE}. Every other file is platform-owned, and only Upgrades change it: read \
it, never ask to change it. Code changes land in a draft, as content changes do: on Live, your \
first code change starts the draft.

Call build to build your code changes: when the build passes, they become the draft's new \
revision, which the preview shows. Build whenever you need your changes, and fix the errors a \
build returns, type errors in \`types\` included: a revision with type errors is previewed, but \
can't be published. A build that fails because of Camox itself says so: never change code for \
it. When you end your turn, Camox builds the changes your last build didn't cover, and sends \
you back to fix them if they have errors.

Camox's references for its code are in \`${SKILL_REFERENCES_DIR}/\`. Read only the ones the task \
needs, never all of them:
${SKILL_REFERENCES.map(({ file, when }) => `- \`${file}\`: ${when}.`).join("\n")}

Rules of this website, which Camox hosts:
- SEO links belong to Camox, which writes each page's meta tags, \`hreflang\` alternates and \
sitemap from its content: never add them in code.
- A font is a Google Fonts stylesheet in the Document's \`link\` (\`src/document.ts\`) plus its \
family's name in the Theme's \`--font-*\` tokens (\`src/styles.css\`). Find the family and its exact \
link with searchFonts. Never \`@import\` a font or use a font package: Camox serves Google Fonts \
links from the website's own origin.
- Use only the packages \`package.json\` lists in \`dependencies\`: you can't add one.
- A block's file name is its id: the block \`pricing-table\` is \`src/blocks/pricing-table.tsx\`.`;
