# Platform skills

Skills every project's agent has, whatever version of `camox` the project installs: for tasks
beyond the code, such as writing copy. Camox's own skill, for the code, ships with the SDK
instead (`packages/sdk/skills/camox`).

Each skill is one agent's, so each agent reads only its own job's:

- The Code Agent's (`website-design`) are mounted beside the code. The Code Agent sees each one's
  name and description in its instructions, and reads the skill only when a task matches the
  description.
- The thread's agent's (`page-composition`) are held whole in its instructions, since it can't
  read files: each is its `SKILL.md` alone, linking to no other file.

Write the description for the choice of following the skill: name the requests that call for it,
in the words editors use.

## Adding a skill

1. Add a folder named after the skill, holding its `SKILL.md` with `name` (the folder's name) and
   `description` in its frontmatter, and the files it links to by relative paths.
2. Import each file in `src/domains/code/platform-skills.ts`, by its path in this folder, among
   the skills of the agent it's for.
   `platform-skills.test.ts` fails while one is missing.

A skill's scripts never run: the agent only reads its files. Don't name a skill like one of the
SDK's, which would replace it.

## Credits

`website-design` and `page-composition` adapt Anthropic's
[`frontend-design`](https://github.com/anthropics/skills/tree/main/skills/frontend-design) skill,
licensed under the [Apache License 2.0](https://www.apache.org/licenses/LICENSE-2.0), to Camox's
websites: its Theme, its editors' content, and its agent's tools.
