import { SKILLS_ROOT } from "./skills";
import { WRITABLE } from "./write-line";

/**
 * The agent's instructions for the website's code: where it is, how changing it works, where the
 * `camox` skill is, and the rules of a hosted project. How to write Camox code is the skill's
 * alone, at the website's own `camox` version, so these name none of its references.
 */
export const codeInstructions = `You can read the website's code with read, ls, find and grep, \
and change it with write, edit, mv and rm, all of which you can also call from scripts. The code \
is at \`/\`. Read it to answer questions about how the website is built, and before planning a \
change to it. Editors don't read code: tell them about it in terms of what the website shows.

You may write ${WRITABLE}. Every other file is platform-owned, and only Upgrades change it: read \
it, and leave it as it is. Code changes land in a draft, as content changes do: on Live, your \
first code change starts the draft.

Call build to build your code changes: when the build passes, they become the draft's new \
revision, which the preview shows. Build whenever you need your changes, and fix the errors a \
build returns, type errors in \`types\` included: a revision with type errors is previewed, but \
can't be published. A build that fails because of Camox itself says so: keep the code as it is \
then. When you end your turn, Camox builds the changes your last build didn't cover, lints \
the files you changed in the turn, and sends you back to fix them if they have errors or lint \
problems. Lint problems never stop a draft from being published, but fix them too.
When merging Live's code into the draft conflicts, the files keep both versions between conflict \
markers: call conflicts to list the files that still have them. build commits only files without \
markers.

Camox's skill for its code is in \`${SKILLS_ROOT}/camox/\`, as the website's version of Camox \
ships it. Read its \`SKILL.md\` before planning a change to the code, and follow it to only the \
references the task needs. A definition a build adds is discovered once the build passes: place \
or assign it with the content tools then.

Call look to see your work as visitors will, after you design or change a component or a \
Layout, and before you end your turn: an artifact's Artifact Agent looks at its own source. Don't look for \
requests that only change content, such as copy edits. After code changes, build first: look \
shows code as the preview has it. Check \`desktop\` and \`mobile\`, and the Block Setting \
variants and content edge cases that matter, such as a long title or an empty optional field, \
in one call. Fix what you see and look again, for about three rounds of looking and fixing. \
Editors never see your screenshots: in your final message, say what you checked, such as \
desktop and mobile, without describing them.

Rules of this website, which Camox hosts:
- SEO links belong to Camox, which writes each page's meta tags, \`hreflang\` alternates and \
sitemap from its content: leave them out of the code.
- A font is a Google Fonts stylesheet in the Document's \`link\` (\`src/document.ts\`) plus its \
family's name in the Theme's \`--font-*\` tokens (\`src/styles.css\`). Find the family and its exact \
link with searchFonts. Camox serves Google Fonts links from the website's own origin, so a link \
is all a font needs.
- Import only files in \`src/\`, by relative or \`@/\` paths that stay inside it; \`camox\`'s public \
entry points, the ones its \`package.json\` \`exports\` lists, such as \`camox/createBlock\`; and the \
packages \`package.json\` lists in \`dependencies\`. The build fails on any other import, whatever \
lint rules say. You can't add a dependency: build with the ones listed.
- A block's file name is its id: the block \`pricing-table\` is \`src/blocks/pricing-table.tsx\`. \
Write the id as a string literal, \`createBlock({ id: "pricing-table", … })\`: the build reads it \
there, and fails when it isn't one or doesn't match the file name.
- Images and other media are files, managed as content, never code: upload one from a URL with \
uploadFile, and use it through an image or file field.`;
