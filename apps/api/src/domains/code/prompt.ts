import { SKILL_REFERENCES, SKILL_REFERENCES_DIR } from "./skills";

/**
 * The agent's instructions for the website's code: where it is, and which of Camox's references
 * to read for what, the way the `camox` skill's `SKILL.md` routes to them.
 */
export const codeReading = `You can read the website's code with read, ls, find and grep, all \
of which you can also call from scripts. The code is at \`/\`, as it is on Live. Read it to \
answer questions about how the website is built, and before planning a change to it. Editors \
never read code: tell them about it in terms of what the website shows.

Camox's references for its code are in \`${SKILL_REFERENCES_DIR}/\`. Read only the ones the task \
needs, never all of them:
${SKILL_REFERENCES.map(({ file, when }) => `- \`${file}\`: ${when}.`).join("\n")}`;
