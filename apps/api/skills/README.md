# Platform skills

Skills every project's agent has, whatever version of `camox` the project installs: for tasks
beyond the code, such as writing copy. Camox's own skill, for the code, ships with the SDK
instead (`packages/sdk/skills/camox`).

The agent sees each skill's name and description in its instructions, and reads the skill only
when a task matches the description. Write the description for that choice: name the requests
that call for the skill, in the words editors use.

## Adding a skill

1. Add a folder named after the skill, holding its `SKILL.md` with `name` (the folder's name) and
   `description` in its frontmatter, and the files it links to by relative paths.
2. Import each file in `src/domains/code/platform-skills.ts`, by its path in this folder.
   `platform-skills.test.ts` fails while one is missing.

A skill's scripts never run: the agent only reads its files. Don't name a skill like one of the
SDK's, which would replace it.
